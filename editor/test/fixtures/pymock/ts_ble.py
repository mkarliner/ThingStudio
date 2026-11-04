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


# -- the GATT client (BLE phase 3) ---------------------------------------------------------------------------------

_IRQ_PERIPHERAL_CONNECT = const(7)
_IRQ_PERIPHERAL_DISCONNECT = const(8)
_IRQ_GATTC_SERVICE_RESULT = const(9)
_IRQ_GATTC_SERVICE_DONE = const(10)
_IRQ_GATTC_CHARACTERISTIC_RESULT = const(11)
_IRQ_GATTC_CHARACTERISTIC_DONE = const(12)
_IRQ_GATTC_DESCRIPTOR_RESULT = const(13)
_IRQ_GATTC_DESCRIPTOR_DONE = const(14)
_IRQ_GATTC_READ_RESULT = const(15)
_IRQ_GATTC_READ_DONE = const(16)
_IRQ_GATTC_WRITE_DONE = const(17)
_IRQ_GATTC_NOTIFY = const(18)
_IRQ_GATTC_INDICATE = const(19)
_CENTRAL_EVENTS = (7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)

_PROP_NOTIFY = const(0x10)
_PROP_INDICATE = const(0x20)
_CCCD = 0x2902

_STEP_MS = 5000  # each discovery, read or write step
RETRY_MS = 10000  # after a failed step or a lost connection, before finding the peer again


class PeerError(Exception):
    """A step that failed, worded for the console: the peer, the step, what to do."""


class _Op:
    """One awaited radio event: an IRQ sets `result` (or `status`) and the flag."""

    def __init__(self):
        self.flag = runtime.asyncio.ThreadSafeFlag()
        self.items = []
        self.status = None
        self.done = False

    def finish(self, status=0):
        self.status = status
        self.done = True
        self.flag.set()

    async def wait(self, ms, what):
        try:
            await runtime.asyncio.wait_for(self._wait(), ms / 1000)
        except runtime.asyncio.TimeoutError:
            raise PeerError("%s took over %d s" % (what, ms // 1000))

    async def _wait(self):
        while not self.done:
            await self.flag.wait()


class _Peer:
    """One peripheral this board connects to, and the one path to it: finding -> connecting -> discovering ->
    connected. Each step is bounded and fails with one line naming the peer and the step; a failure or a lost
    connection waits RETRY_MS and starts again from finding. Never a different peer, never a queue of requests."""

    def __init__(self, radio, key, addr, name_prefix, timeout_ms):
        self.radio = radio
        self.key = key
        self.addr = norm_addr(addr) if addr else ""
        self.name_prefix = name_prefix or ""
        self.timeout_ms = int(timeout_ms)
        self.label = self.addr or self.name_prefix
        self.needs = {}  # (svc, char) -> "notify" or "plain"
        self.nodes = []
        self.handles = {}  # (svc, char) -> value handle
        self.notify_queues = {}  # value handle -> [Writes]
        self.wants_notify = {}  # (svc, char) -> [Writes]
        self.state = "finding"
        self.conn = None
        self.mtu = _DEFAULT_MTU
        self.task = None
        self.op = None
        self.connect_op = None
        self.found = None
        self.find_op = None
        self.lost = None
        self.last_error = None
        self.lock = runtime.asyncio.Lock()

    # -- what the nodes ask for --

    def need(self, node_id, svc, char, notify=False):
        key = (norm_uuid(svc), norm_uuid(char))
        if notify:
            self.needs[key] = "notify"
        else:
            self.needs.setdefault(key, "plain")
        if node_id not in self.nodes:
            self.nodes.append(node_id)
        self._status_one(node_id)
        self.start()

    def notifications(self, node_id, svc, char):
        w = Writes(node_id)
        self.wants_notify.setdefault((norm_uuid(svc), norm_uuid(char)), []).append(w)
        self.need(node_id, svc, char, notify=True)
        return w

    def start(self):
        """Starts the connection task, once. Without a running event loop yet (setup runs at import on the board,
        where create_task just queues it), the first async call starts it instead."""
        if self.task is None:
            coro = self._run()
            try:
                self.task = runtime.asyncio.create_task(coro)
            except RuntimeError:  # no event loop yet (the editor's CPython tests): the first async call starts it
                coro.close()
                self.task = None

    def stop(self):
        if self.task is not None:
            self.task.cancel()
            self.task = None

    async def read(self, svc, char):
        self.start()
        async with self.lock:
            h = self._ready(svc, char, "read")
            op = self.op = _Op()
            self.radio.ble.gattc_read(self.conn, h)
            await op.wait(_STEP_MS, "%s: reading %s" % (self.label, char))
            if op.status:
                raise PeerError("%s: reading %s failed (status %d)" % (self.label, char, op.status))
            return b"".join(op.items)

    async def write(self, svc, char, data, response):
        self.start()
        async with self.lock:
            h = self._ready(svc, char, "write")
            if not response:
                self.radio.ble.gattc_write(self.conn, h, data, 0)
                return
            op = self.op = _Op()
            self.radio.ble.gattc_write(self.conn, h, data, 1)
            await op.wait(_STEP_MS, "%s: writing %s" % (self.label, char))
            if op.status:
                raise PeerError("%s: writing %s failed (status %d)" % (self.label, char, op.status))

    def _ready(self, svc, char, verb):
        if self.state != "connected":
            raise PeerError("%s isn't connected (%s): can't %s %s now" % (self.label, self.state, verb, char))
        return self.handles[(norm_uuid(svc), norm_uuid(char))]

    # -- status --

    def _status_one(self, node_id):
        if self.state == "connected":
            runtime.report_status(node_id, "connected", "connected to %s" % self.label)
        elif self.state in ("finding", "connecting", "discovering"):
            runtime.report_status(node_id, "connecting", "%s %s" % (self.state, self.label))
        else:
            runtime.report_status(node_id, "disconnected", "%s: %s" % (self.label, self.state))

    def _set(self, state):
        self.state = state
        for n in self.nodes:
            self._status_one(n)

    def _fail(self, message):
        self.state = "retrying in %d s" % (RETRY_MS // 1000)
        for n in self.nodes:
            runtime.report_status(n, "error", message)
        # The console gets a failure once, not every RETRY_MS while a peer stays off.
        if message != self.last_error:
            self.last_error = message
            runtime._report_error(self.nodes[0] if self.nodes else None, PeerError(message))

    # -- the path --

    async def _run(self):
        asyncio = runtime.asyncio
        while True:
            try:
                self.lost = _Op()
                await self._connect_once()
                self.last_error = None
                self._set("connected")
                await self.lost._wait()
                self._fail("%s disconnected" % self.label)
            except runtime.asyncio.CancelledError:
                raise  # a redeploy: not a failure
            except Exception as e:  # noqa: BLE001 -- the path must keep going; any step's failure is reported, then retried
                self._fail(str(e) if isinstance(e, PeerError) else "%s: %s failed (%r)" % (self.label, self.state, e))
                if self.conn is not None:
                    try:
                        self.radio.ble.gap_disconnect(self.conn)
                    except OSError:
                        pass
                    self.conn = None
            await asyncio.sleep_ms(RETRY_MS)

    async def _connect_once(self):
        self.handles = {}
        self.notify_queues = {}
        self.mtu = _DEFAULT_MTU
        self._set("finding")
        addr_type, addr = await self._find()
        self._set("connecting")
        await self._connect(addr_type, addr)
        self._set("discovering")
        await self._discover()

    async def _find(self):
        self.found = None
        op = self.find_op = _Op()
        s = Scanner(None, self.name_prefix, self.addr, None, "", 0)
        s.offer = self._offer  # match by address or name; keep the address type for connecting
        self.radio.scanners.append(s)
        started_own = False
        if not self.radio.scanning:
            try:
                self.radio.ble.gap_scan(self.timeout_ms, 30000, 30000, True)
            except OSError as e:
                # Seen on the C5 as OSError(-519) (HCI 0x07) just after a link dropped: the controller still busy.
                self.radio.scanners.remove(s)
                self.find_op = None
                raise PeerError("%s: the radio refused to scan for it (%r); trying again" % (self.label, e))
            started_own = True
        try:
            await op.wait(self.timeout_ms + 500, "finding %s" % self.label)
        except PeerError:
            raise PeerError("%s: not found in %d s -- is it on, in range and advertising?" % (self.label, self.timeout_ms // 1000))
        finally:
            self.radio.scanners.remove(s)
            self.find_op = None
            if started_own:
                try:
                    self.radio.ble.gap_scan(None)
                except OSError:
                    pass
        return self.found

    def _offer(self, addr_type, addr, adv_type, rssi, adv):
        if self.find_op is None or self.find_op.done:
            return
        if self.addr and addr_str(addr) != self.addr:
            return
        if self.name_prefix and not decode(adv)["name"].startswith(self.name_prefix):
            return
        self.found = (addr_type, bytes(addr))
        self.find_op.finish()

    def scan_done(self):
        pass  # a peer search's own scan ending is expected; finding times out on its own

    async def _connect(self, addr_type, addr):
        paused = self.radio.pause_scan()
        op = self.connect_op = _Op()
        try:
            self.radio.ble.gap_connect(addr_type, addr, self.timeout_ms)
            await op.wait(self.timeout_ms + 1000, "connecting to %s" % self.label)
        except OSError as e:
            raise PeerError("%s: the radio refused to connect (%r)" % (self.label, e))
        except PeerError:
            try:
                self.radio.ble.gap_connect(None)  # cancel the attempt still pending in the stack
            except OSError:
                pass
            raise
        finally:
            self.connect_op = None
            if paused:
                self.radio.resume_scan()
        try:
            self.radio.ble.gattc_exchange_mtu(self.conn)
        except (OSError, AttributeError):
            pass

    async def _step(self, start, what):
        op = self.op = _Op()
        start()
        await op.wait(_STEP_MS, "%s: %s" % (self.label, what))
        return op

    async def _discover(self):
        ble = self.radio.ble
        conn = self.conn
        services = (await self._step(lambda: ble.gattc_discover_services(conn), "finding services")).items
        for svc in sorted({k[0] for k in self.needs}):
            want = bluetooth.UUID(norm_uuid_for_ble(svc))
            rng = [(s, e) for s, e, u in services if u == want]
            if not rng:
                raise PeerError("%s: no service %s -- check the service UUID" % (self.label, svc))
            start, end = rng[0]
            chars = (await self._step(lambda: ble.gattc_discover_characteristics(conn, start, end), "finding characteristics of " + svc)).items
            for (s2, char), mode in sorted(self.needs.items()):
                if s2 != svc:
                    continue
                cwant = bluetooth.UUID(norm_uuid_for_ble(char))
                found = [c for c in chars if c[3] == cwant]
                if not found:
                    raise PeerError("%s: no characteristic %s in service %s -- check the UUID" % (self.label, char, svc))
                end_handle, value_handle, props, _u = found[0]
                self.handles[(svc, char)] = value_handle
                if mode == "notify":
                    await self._subscribe(svc, char, value_handle, end_handle, props)

    async def _subscribe(self, svc, char, value_handle, end_handle, props):
        if props & _PROP_NOTIFY:
            value = b"\x01\x00"
        elif props & _PROP_INDICATE:
            value = b"\x02\x00"
        else:
            raise PeerError("%s: characteristic %s doesn't notify or indicate" % (self.label, char))
        ble = self.radio.ble
        conn = self.conn
        # The start is the value handle itself: NimBLE (ble_gattc_disc_all_dscs) treats it as the characteristic's value
        # and searches after it. value_handle + 1 skipped the 0x2902 right after the value (found on the C5,
        # 2026-11-04: "has no notify switch" against a peer that has one).
        descs = (await self._step(lambda: ble.gattc_discover_descriptors(conn, value_handle, end_handle), "finding the notify switch of " + char)).items
        cccd = [h for h, u in descs if u == bluetooth.UUID(_CCCD)]
        if not cccd:
            raise PeerError("%s: characteristic %s has no notify switch (0x2902)" % (self.label, char))
        op = await self._step(lambda: ble.gattc_write(conn, cccd[0], value, 1), "turning on notifications for " + char)
        if op.status:
            raise PeerError("%s: turning on notifications for %s failed (status %d)" % (self.label, char, op.status))
        self.notify_queues[value_handle] = self.wants_notify.get((svc, char), [])

    # -- radio events --

    def irq(self, event, data):
        if event == _IRQ_PERIPHERAL_CONNECT:
            conn, _t, addr = data
            if self.connect_op is not None and self.found is not None and bytes(addr) == self.found[1]:
                self.conn = conn
                self.connect_op.finish()
            return
        if not data or data[0] != self.conn:
            return
        if event == _IRQ_PERIPHERAL_DISCONNECT:
            self.conn = None
            if self.op is not None and not self.op.done:
                self.op.finish(-1)
            if self.lost is not None:
                self.lost.finish()
        elif event == _IRQ_GATTC_SERVICE_RESULT and self.op is not None:
            _c, start, end, uuid = data
            self.op.items.append((start, end, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_CHARACTERISTIC_RESULT and self.op is not None:
            _c, end_handle, value_handle, props, uuid = data
            self.op.items.append((end_handle, value_handle, props, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_DESCRIPTOR_RESULT and self.op is not None:
            _c, handle, uuid = data
            self.op.items.append((handle, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_READ_RESULT and self.op is not None:
            self.op.items.append(bytes(data[2]))
        elif event in (_IRQ_GATTC_SERVICE_DONE, _IRQ_GATTC_CHARACTERISTIC_DONE, _IRQ_GATTC_DESCRIPTOR_DONE):
            if self.op is not None:
                self.op.finish(data[1])
        elif event in (_IRQ_GATTC_READ_DONE, _IRQ_GATTC_WRITE_DONE):
            if self.op is not None:
                self.op.finish(data[2])
        elif event in (_IRQ_GATTC_NOTIFY, _IRQ_GATTC_INDICATE):
            _c, h, value = data
            for w in self.notify_queues.get(h, ()):
                w.offer(bytes(value), self.conn)
        elif event == _IRQ_MTU_EXCHANGED:
            self.mtu = data[1]


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
        self.peers = []  # _Peer, one per ble peer config (phase 3)
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
            for p in self.peers:
                p.scan_done()
        elif event in _CENTRAL_EVENTS:
            for p in self.peers:
                p.irq(event, data)
        else:
            if self.gatt_server is not None:
                self.gatt_server.irq(event, data)
            if event == _IRQ_MTU_EXCHANGED:
                for p in self.peers:
                    p.irq(event, data)

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

    def pause_scan(self):
        """Stops the shared scan for a moment (a connection attempt can't run beside it); resume_scan restarts it.
        Cleared first, so the scan-done event isn't reported as the radio stopping the scan."""
        if not self.scanning:
            return False
        self.scanning = False
        self.ble.gap_scan(None)
        return True

    def resume_scan(self):
        if self.scan_params is not None and self.scanners and not self.scanning:
            p = self.scan_params
            self.ble.gap_scan(0, p[0], p[1], p[2])
            self.scanning = True

    def peer(self, key, addr, name_prefix, timeout_ms):
        """The connection to one peer (a ble peer config, keyed by its id), shared by every node that names it."""

        def make():
            p = _Peer(self, key, addr, name_prefix, timeout_ms)
            self.peers.append(p)
            return p

        return runtime.shared("ble_peer", key, (addr, name_prefix, int(timeout_ms)), make)

    def stop(self):
        for p in self.peers:
            p.stop()
        self.peers = []
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
