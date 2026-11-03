# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_ble/ts_ble.py
#
# Thingstudio's shared Bluetooth LE radio, a flow dependency (a flow with no BLE node never carries it), written on
# MicroPython's own `bluetooth` module. Scoping and decisions: docs/working-notes/ble-nodes-scoping.md,
# decisions/ble-nodes.md.
#
# The board has one radio and one IRQ handler, so every BLE node -- built-in or custom -- goes through radio():
#   - the radio is a keyed singleton (runtime.shared('ble', 0)), so a redeploy, which clears singletons, starts
#     from a fresh one; its cleanup stops scanning and advertising and turns the radio off;
#   - this module keeps no state of its own between deploys: everything lives on the _Radio object;
#   - scanning is shared: every scanner sees every advertisement, through its own filters and queue. The scan
#     settings are a second singleton ('ble_scan'), so two nodes asking for different settings is a loud error
#     naming both, not a silent first-wins;
#   - advertising is one payload at a time ('ble_adv'), for the same reason.
#
# IRQ data (addresses, advertising bytes) is only valid during the callback, so it is copied there. The callback
# runs scheduled, not as a hard interrupt, on the ports this targets, so it may allocate; it still does the least it
# can: filter, copy, queue, set a flag.
#
# Failure lines follow AGENTS.md: what happened, the figure, what to do.

import bluetooth
import runtime
import struct
import time
from micropython import const

_IRQ_SCAN_RESULT = const(5)
_IRQ_SCAN_DONE = const(6)

# Advertising event types in a scan result: 0 ADV_IND and 1 ADV_DIRECT_IND accept connections, 2 ADV_SCAN_IND and
# 3 ADV_NONCONN_IND don't, 4 SCAN_RSP is a reply to an active scan's request.
_SCAN_RSP = const(4)

# Advertising data types (Bluetooth Core Spec Supplement, part A).
_ADV_FLAGS = const(0x01)
_ADV_UUID16_SOME = const(0x02)
_ADV_UUID16_ALL = const(0x03)
_ADV_UUID128_SOME = const(0x06)
_ADV_UUID128_ALL = const(0x07)
_ADV_NAME_SHORT = const(0x08)
_ADV_NAME = const(0x09)
_ADV_SVC_DATA16 = const(0x16)
_ADV_SVC_DATA128 = const(0x21)
_ADV_MFR = const(0xFF)

# A legacy advertisement carries at most 31 bytes.
ADV_LIMIT = 31
QUEUE_LIMIT = 20
_DEDUPE_LIMIT = 64


def _ticks():
    try:
        return time.ticks_ms()
    except AttributeError:  # CPython, in the editor's tests
        return int(time.monotonic() * 1000)


def _since(start):
    try:
        return time.ticks_diff(time.ticks_ms(), start)
    except AttributeError:
        return _ticks() - start


# -- advertising data: build and read -------------------------------------------------------------------------------


def addr_str(addr):
    return ":".join("%02x" % b for b in bytes(addr))


def norm_addr(text):
    """'AA-BB-CC-DD-EE-FF' / 'aabbccddeeff' -> 'aa:bb:cc:dd:ee:ff'. Raises ValueError for anything else."""
    hexs = "".join(c for c in str(text).lower() if c not in ":-. ")
    if len(hexs) != 12 or any(c not in "0123456789abcdef" for c in hexs):
        raise ValueError("%r is not a Bluetooth address (six bytes, like aa:bb:cc:dd:ee:ff)" % (text,))
    return ":".join(hexs[i : i + 2] for i in range(0, 12, 2))


def norm_uuid(text):
    """A 16-bit ('fcd2', '0xFCD2') or 128-bit UUID as lower-case hex: 'fcd2' or the dashed 36-character form."""
    t = str(text).strip().lower()
    if t.startswith("0x"):
        t = t[2:]
    hexs = t.replace("-", "")
    if any(c not in "0123456789abcdef" for c in hexs) or len(hexs) not in (4, 32):
        raise ValueError("%r is not a 16-bit (fcd2) or 128-bit UUID" % (text,))
    if len(hexs) == 4:
        return hexs
    return "%s-%s-%s-%s-%s" % (hexs[0:8], hexs[8:12], hexs[12:16], hexs[16:20], hexs[20:32])


def _uuid_from_le(b):
    """UUID bytes as advertised (little-endian) -> norm_uuid form."""
    return norm_uuid("".join("%02x" % x for x in reversed(bytes(b))))


def _uuid_to_le(u):
    hexs = norm_uuid(u).replace("-", "")
    return bytes(reversed(bytes(int(hexs[i : i + 2], 16) for i in range(0, len(hexs), 2))))


def fields(adv):
    """Advertising data -> {type: [value bytes, ...]}. A malformed length ends the walk (the rest is dropped), so a
    corrupt or hostile advertisement can't raise here."""
    out = {}
    adv = bytes(adv)
    i = 0
    while i + 1 < len(adv):
        n = adv[i]
        if n == 0 or i + 1 + n > len(adv):
            break
        out.setdefault(adv[i + 1], []).append(adv[i + 2 : i + 1 + n])
        i += 1 + n
    return out


def decode(adv):
    """The parts of an advertisement a flow usually wants: name, manufacturer id and data, service data by UUID,
    and the service UUIDs it lists."""
    f = fields(adv)
    name = ""
    for t in (_ADV_NAME, _ADV_NAME_SHORT):
        if t in f:
            try:
                name = f[t][0].decode()
            except Exception:  # noqa: BLE001 -- not UTF-8: leave the name empty rather than fail the message
                name = ""
            break
    mfr_id = None
    mfr = b""
    if _ADV_MFR in f and len(f[_ADV_MFR][0]) >= 2:
        v = f[_ADV_MFR][0]
        mfr_id = v[0] | (v[1] << 8)
        mfr = v[2:]
    svc_data = {}
    for v in f.get(_ADV_SVC_DATA16, []):
        if len(v) >= 2:
            svc_data[_uuid_from_le(v[:2])] = v[2:]
    for v in f.get(_ADV_SVC_DATA128, []):
        if len(v) >= 16:
            svc_data[_uuid_from_le(v[:16])] = v[16:]
    services = []
    for t, size in ((_ADV_UUID16_SOME, 2), (_ADV_UUID16_ALL, 2), (_ADV_UUID128_SOME, 16), (_ADV_UUID128_ALL, 16)):
        for v in f.get(t, []):
            for j in range(0, len(v) - size + 1, size):
                services.append(_uuid_from_le(v[j : j + size]))
    return {"name": name, "mfrId": mfr_id, "mfr": mfr, "svcData": svc_data, "services": services}


def _field(t, value):
    return bytes((len(value) + 1, t)) + value


def build_adv(name="", mfr_id=None, mfr=b"", svc_uuid=None, svc=b""):
    """Advertising data: flags, the name, then manufacturer or service data. Raises ValueError naming the sizes when
    it's over the 31-byte limit, so the node can say what to shorten."""
    out = _field(_ADV_FLAGS, b"\x06")  # LE general discoverable, no BR/EDR
    name_b = name.encode() if name else b""
    if name_b:
        out += _field(_ADV_NAME, name_b)
    data = b""
    if mfr_id is not None:
        data = bytes((mfr_id & 0xFF, (mfr_id >> 8) & 0xFF)) + bytes(mfr)
        out += _field(_ADV_MFR, data)
    elif svc_uuid is not None:
        uuid_b = _uuid_to_le(svc_uuid)
        t = _ADV_SVC_DATA16 if len(uuid_b) == 2 else _ADV_SVC_DATA128
        data = uuid_b + bytes(svc)
        out += _field(t, data)
    if len(out) > ADV_LIMIT:
        raise ValueError(
            "advertising data is %d bytes, the limit is %d: shorten the name (%d bytes) or the payload (%d bytes)"
            % (len(out), ADV_LIMIT, len(name_b), len(mfr) if mfr_id is not None else len(svc))
        )
    return out


# -- the radio ------------------------------------------------------------------------------------------------------


class Scanner:
    """One node's view of the shared scan: its filters, its queue, and a flag its wait() blocks on."""

    def __init__(self, node_id, name_prefix, addr, mfr_id, svc_uuid, repeat_ms):
        self.node_id = node_id
        self.name_prefix = name_prefix or ""
        self.addr = norm_addr(addr) if addr else ""
        self.mfr_id = mfr_id
        self.svc_uuid = norm_uuid(svc_uuid) if svc_uuid else ""
        self.repeat_ms = int(repeat_ms)
        self.queue = []
        self.dropped = 0
        self._last = {}  # addr -> (adv bytes, ticks) for the repeat window
        self.flag = runtime.asyncio.ThreadSafeFlag()

    def offer(self, addr_type, addr, adv_type, rssi, adv):
        # An empty scan response carries nothing a flow can use; many devices send one to every active scan
        # (seen on the ESP32-C5, 2026-11-03: one after each connectable advertisement, ~17 ms later).
        if adv_type == _SCAN_RSP and not adv:
            return
        a = addr_str(addr)
        if self.addr and a != self.addr:
            return
        d = decode(adv)
        if self.name_prefix and not d["name"].startswith(self.name_prefix):
            return
        if self.mfr_id is not None and d["mfrId"] != self.mfr_id:
            return
        if self.svc_uuid and self.svc_uuid not in d["svcData"] and self.svc_uuid not in d["services"]:
            return
        if self.repeat_ms > 0:
            seen = self._last.get(a)
            if seen is not None and seen[0] == adv and _since(seen[1]) < self.repeat_ms:
                return
            if len(self._last) >= _DEDUPE_LIMIT:
                self._last = {}
            self._last[a] = (adv, _ticks())
        msg = {
            "payload": adv,
            "topic": "",
            "addr": a,
            "addrType": "public" if addr_type == 0 else "random",
            "rssi": rssi,
            # A scan response doesn't say whether the device accepts connections; its advertisement did.
            "connectable": None if adv_type == _SCAN_RSP else adv_type in (0, 1),
            "scanResponse": adv_type == _SCAN_RSP,
            "name": d["name"],
            "mfrId": d["mfrId"],
            "mfr": d["mfr"],
            "svcData": d["svcData"],
            "services": d["services"],
        }
        if len(self.queue) >= QUEUE_LIMIT:
            self.queue.pop(0)
            self.dropped += 1
        self.queue.append(msg)
        self.flag.set()

    async def next(self):
        while not self.queue:
            await self.flag.wait()
        return self.queue.pop(0)


# -- the GATT server (BLE phase 2) ---------------------------------------------------------------------------------

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_IRQ_MTU_EXCHANGED = const(21)

FLAG_READ = const(0x0002)
FLAG_WRITE_NO_RESPONSE = const(0x0004)
FLAG_WRITE = const(0x0008)
FLAG_NOTIFY = const(0x0010)

# The Nordic UART Service: what phone terminal apps (nRF Connect, Serial Bluetooth Terminal, Bluefruit) look for.
NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # the phone writes here
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # the board notifies here

_WRITE_BUFFER = 244  # the largest write a phone can make in one go at MTU 247
_DEFAULT_MTU = 23
_ADV_DEFAULT_MS = 500


class Writes:
    """One node's queue of writes to one characteristic, as (data, conn) pairs."""

    def __init__(self, node_id):
        self.node_id = node_id
        self.queue = []
        self.dropped = 0
        self.flag = runtime.asyncio.ThreadSafeFlag()

    def offer(self, data, conn):
        if len(self.queue) >= QUEUE_LIMIT:
            self.queue.pop(0)
            self.dropped += 1
        self.queue.append((data, conn))
        self.flag.set()

    async def next(self):
        while not self.queue:
            await self.flag.wait()
        return self.queue.pop(0)


class _Gatt:
    """The registered service table: a handle per (service, characteristic), the nodes listening for writes, the
    connected centrals and their MTUs. Built once per deploy, by whichever GATT node starts first."""

    def __init__(self, radio, table):
        self.radio = radio
        self.handles = {}
        self.writers = {}  # handle -> [Writes]
        self.conns = {}  # conn handle -> MTU
        self.nodes = []  # node ids, for connection status
        ble = radio.ble
        services = tuple(
            (bluetooth.UUID(norm_uuid_for_ble(svc)), tuple((bluetooth.UUID(norm_uuid_for_ble(c)), int(f)) for c, f in chars))
            for svc, chars in table
        )
        try:
            ble.gap_advertise(None)  # registering resets the GATT database; nothing may be connectable meanwhile
            registered = ble.gatts_register_services(services)
        except OSError as e:
            raise OSError("Bluetooth services could not be registered (%r): %d services; hard-reset the board" % (e, len(services)))
        for (svc, chars), handles in zip(table, registered):
            for (char, flags), h in zip(chars, handles):
                self.handles[(norm_uuid(svc), norm_uuid(char))] = h
                if flags & (FLAG_WRITE | FLAG_WRITE_NO_RESPONSE):
                    ble.gatts_set_buffer(h, _WRITE_BUFFER)
        try:
            ble.config(mtu=_WRITE_BUFFER + 3)  # the size the board asks for; the phone may agree to less
        except (OSError, ValueError, TypeError):
            pass

    def handle(self, svc, char):
        try:
            return self.handles[(norm_uuid(svc), norm_uuid(char))]
        except KeyError:
            raise OSError("characteristic %s in service %s isn't in the registered table" % (char, svc))

    def on_writes(self, node_id, svc, char):
        w = Writes(node_id)
        self.writers.setdefault(self.handle(svc, char), []).append(w)
        self.attach(node_id)
        return w

    def attach(self, node_id):
        """Adds a node to the ones whose status follows the connections."""
        self._node(node_id)

    def _node(self, node_id):
        if node_id not in self.nodes:
            self.nodes.append(node_id)
        self._status(node_id)

    def _status(self, node_id):
        if self.conns:
            runtime.report_status(node_id, "connected", "%d connected" % len(self.conns))
        else:
            runtime.report_status(node_id, "disconnected", "advertising, no one connected")

    def payload_room(self):
        """What one notification carries at the smallest connected MTU."""
        return (min(self.conns.values()) if self.conns else _DEFAULT_MTU) - 3

    def write(self, node_id, svc, char, data, notify):
        """Sets the value a phone reads, and notifies every connected phone. Returns how many were notified."""
        h = self.handle(svc, char)
        ble = self.radio.ble
        ble.gatts_write(h, data)
        self._node(node_id)
        sent = 0
        if notify:
            for conn in list(self.conns):
                try:
                    ble.gatts_notify(conn, h)
                    sent += 1
                except OSError:
                    pass  # it disconnected meanwhile; the disconnect event follows
        return sent

    def send_chunks(self, node_id, svc, char, data):
        """Notifies `data` to every connected phone in pieces that fit each one's MTU (UART). Returns pieces sent."""
        h = self.handle(svc, char)
        ble = self.radio.ble
        self._node(node_id)
        sent = 0
        for conn, mtu in list(self.conns.items()):
            step = mtu - 3
            for i in range(0, len(data), step):
                try:
                    ble.gatts_notify(conn, h, data[i : i + step])
                    sent += 1
                except OSError:
                    break
        return sent

    def irq(self, event, data):
        if event == _IRQ_CENTRAL_CONNECT:
            conn = data[0]
            self.conns[conn] = _DEFAULT_MTU
            for n in self.nodes:
                self._status(n)
        elif event == _IRQ_CENTRAL_DISCONNECT:
            self.conns.pop(data[0], None)
            for n in self.nodes:
                self._status(n)
            self.radio.readvertise()  # the stack stops advertising on a connection
        elif event == _IRQ_GATTS_WRITE:
            conn, h = data[0], data[1]
            writers = self.writers.get(h)
            if writers:
                value = bytes(self.radio.ble.gatts_read(h))
                for w in writers:
                    w.offer(value, conn)
        elif event == _IRQ_MTU_EXCHANGED:
            if data[0] in self.conns:
                self.conns[data[0]] = data[1]


def norm_uuid_for_ble(u):
    """norm_uuid form -> what bluetooth.UUID() takes: an int for 16-bit, the dashed string for 128-bit."""
    n = norm_uuid(u)
    return int(n, 16) if len(n) == 4 else n


class _Radio:
    def __init__(self):
        self.ble = bluetooth.BLE()
        try:
            self.ble.active(True)
        except OSError as e:
            raise OSError("Bluetooth radio failed to start (%r): the board may be short of memory; hard-reset it" % (e,))
        self.scanners = []
        self.scan_params = None
        self.scanning = False
        self.gatt_server = None
        self.adv = None  # (interval_ms, data) the board advertises, kept to restart it
        self.ble.irq(self._irq)

    def _irq(self, event, data):
        if event == _IRQ_SCAN_RESULT:
            addr_type, addr, adv_type, rssi, adv = data
            addr = bytes(addr)
            adv = bytes(adv)
            for s in self.scanners:
                s.offer(addr_type, addr, adv_type, rssi, adv)
        elif event == _IRQ_SCAN_DONE:
            if self.scanning:
                self.scanning = False
                for s in self.scanners:
                    runtime.report_status(s.node_id, "error", "scan stopped by the radio")
        elif self.gatt_server is not None:
            self.gatt_server.irq(event, data)

    def scan(self, node_id, interval_ms, window_ms, active, **filters):
        """Adds a scanner and starts the one shared scan with these settings (the first scanner's; a second with
        different settings raises)."""
        params = (int(interval_ms * 1000), int(window_ms * 1000), bool(active))
        runtime.shared("ble_scan", 0, params, lambda: params)
        s = Scanner(node_id, **filters)
        self.scanners.append(s)
        if not self.scanning:
            self.scan_params = params
            self.ble.gap_scan(0, params[0], params[1], params[2])
            self.scanning = True
        runtime.report_status(node_id, "connected", "scanning")
        return s

    def advertise(self, node_id, interval_ms, adv):
        """Sends `adv`, connectable when the flow has a GATT server, until the next call."""
        self.adv = (interval_ms, adv)
        self.readvertise()
        if node_id is not None:
            runtime.report_status(node_id, "connected", "advertising %d bytes" % len(adv))

    def readvertise(self):
        if self.adv is None:
            return
        interval_ms, adv = self.adv
        self.ble.gap_advertise(int(interval_ms * 1000), adv_data=adv, connectable=self.gatt_server is not None)

    def gatt(self, table, name):
        """The flow's GATT server, registering `table` on first use. Every GATT node passes the same table (the
        compiler builds it from the whole flow); a different one is a loud error, as for any shared hardware.
        Without a ble advertise node, the board advertises `name` so phones can find it."""

        def make():
            g = _Gatt(self, table)
            self.gatt_server = g
            if self.adv is None:
                self.adv = (_ADV_DEFAULT_MS, build_adv(name))
            self.readvertise()
            return g

        return runtime.shared("ble_gatt", 0, table, make)

    def stop(self):
        try:
            # Cleared before stopping: the radio answers gap_scan(None) with a scan-done event, which must not be
            # reported as the radio stopping the scan by itself (seen on the ESP32-C5 at every redeploy).
            was_scanning = self.scanning
            self.scanning = False
            self.gatt_server = None
            self.adv = None
            if was_scanning:
                self.ble.gap_scan(None)
            self.ble.gap_advertise(None)
        finally:
            self.ble.active(False)


def radio():
    """The board's one radio for this deploy, started on first use."""

    def make():
        r = _Radio()
        runtime.register_cleanup("ble", r.stop)
        return r

    return runtime.shared("ble", 0, (), make)


# -- characteristic values ------------------------------------------------------------------------------------------

_FORMATS = {"int8": "<b", "uint8": "<B", "int16": "<h", "uint16": "<H", "int32": "<i", "uint32": "<I", "float32": "<f"}
# Checked here, not left to struct: CPython raises struct.error, and MicroPython's struct may just truncate.
_RANGES = {
    "int8": (-128, 127),
    "uint8": (0, 255),
    "int16": (-32768, 32767),
    "uint16": (0, 65535),
    "int32": (-2147483648, 2147483647),
    "uint32": (0, 4294967295),
}


def encode(encoding, value):
    """A payload as characteristic bytes. Raises ValueError naming the encoding and the value."""
    if encoding == "bytes":
        if isinstance(value, (bytes, bytearray)):
            return bytes(value)
        if isinstance(value, str):
            return value.encode()
        raise ValueError("payload is %s, not bytes or text" % type(value).__name__)
    if encoding == "text":
        return (value if isinstance(value, str) else str(value)).encode()
    fmt = _FORMATS.get(encoding)
    if fmt is None:
        raise ValueError("unknown encoding %r" % (encoding,))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("%r doesn't fit %s: it isn't a number" % (value, encoding))
    if encoding == "float32":
        return struct.pack(fmt, float(value))
    v = int(value)
    lo, hi = _RANGES[encoding]
    if v < lo or v > hi:
        raise ValueError("%r doesn't fit %s: the range is %d to %d" % (value, encoding, lo, hi))
    return struct.pack(fmt, v)


def decode_value(encoding, data):
    """Characteristic bytes as a payload. Raises ValueError naming the encoding and the length."""
    if encoding == "bytes":
        return bytes(data)
    if encoding == "text":
        try:
            return bytes(data).decode()
        except UnicodeError:
            raise ValueError("%d bytes that aren't UTF-8 text" % len(data))
    fmt = _FORMATS.get(encoding)
    if fmt is None:
        raise ValueError("unknown encoding %r" % (encoding,))
    size = struct.calcsize(fmt)
    if len(data) != size:
        raise ValueError("%d bytes, but %s is %d" % (len(data), encoding, size))
    return struct.unpack(fmt, bytes(data))[0]
