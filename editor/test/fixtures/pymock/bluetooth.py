# Minimal stand-in for MicroPython's `bluetooth` module, for ts_ble (device-runtime/src/vendor/thingstudio_ble/
# ts_ble.py) and the ble_* packages (2026-11-03). One BLE object, as on a board. It records every call so a test can
# assert on what the radio was told, and `deliver()` plays an advertisement through the registered IRQ handler the
# way the stack does: with memoryviews over a buffer the stack reuses, so code that keeps the view instead of
# copying it is caught (deliver() overwrites the buffer straight after the callback).

FAIL_ACTIVE = None  # set to an OSError to make active(True) fail, as a board out of memory does


class UUID:
    def __init__(self, value):
        self.value = value.value if isinstance(value, UUID) else value

    def __eq__(self, other):
        return isinstance(other, UUID) and self.value == other.value

    def __hash__(self):
        return hash(self.value)

    def __repr__(self):
        return "UUID(%r)" % (self.value,)


class BLE:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._reset()
        return cls._instance

    def _reset(self):
        self.calls = []
        self.handler = None
        self.is_active = False
        self.scanning = False
        self.advertising = None
        self.adv_connectable = None
        self.services = None
        self.values = {}  # handle -> bytes
        self.buffers = {}  # handle -> size
        self.notified = []  # (conn, handle, bytes)
        self.mtu = None
        self.peripheral = None  # a scripted device this board can connect to (phase 3), see fake_peripheral()
        self.central_conn = None
        self.peer_writes = []  # (handle, bytes, mode) the board wrote to the peripheral

    def active(self, flag=None):
        if flag is None:
            return self.is_active
        if flag and FAIL_ACTIVE is not None:
            raise FAIL_ACTIVE
        self.calls.append(("active", bool(flag)))
        self.is_active = bool(flag)
        if not flag:
            self.scanning = False
            self.advertising = None
            self.handler = None
        return None

    def irq(self, handler):
        self.calls.append(("irq", handler is not None))
        self.handler = handler

    def config(self, *args, **kwargs):
        if "mtu" in kwargs:
            self.mtu = kwargs["mtu"]
            return None
        if args == ("mac",):
            return (0, b"\xd0\xcf\x13\xf9\xb7\xb2")
        return None

    def gap_scan(self, duration_ms, interval_us=1280000, window_us=11250, active=False):
        if not self.is_active:
            raise OSError(19)  # ENODEV: the radio is off
        self.calls.append(("gap_scan", duration_ms, interval_us, window_us, active))
        was = self.scanning
        self.scanning = duration_ms is not None
        if duration_ms is None and was and self.handler is not None:
            self.handler(6, ())  # the real stack reports scan-done when a scan is stopped
        if duration_ms is not None and self.peripheral is not None and self.peripheral["advertising"]:
            p = self.peripheral
            self.deliver(p["addr"], p["adv"], addr_type=p["addr_type"])

    def gap_advertise(self, interval_us, adv_data=None, resp_data=None, connectable=True):
        if not self.is_active:
            raise OSError(19)
        self.calls.append(("gap_advertise", interval_us, None if adv_data is None else bytes(adv_data), connectable))
        self.advertising = None if interval_us is None else bytes(adv_data or b"")
        self.adv_connectable = None if interval_us is None else connectable

    def gatts_register_services(self, services):
        if not self.is_active:
            raise OSError(19)
        self.calls.append(("gatts_register_services", services))
        self.services = services
        out = []
        h = 1
        for _svc, chars in services:
            hs = []
            for _uuid, _flags in chars:
                h += 2  # a value handle, then room for its descriptor, as the stack numbers them
                hs.append(h)
                self.values[h] = b""
            out.append(tuple(hs))
        return tuple(out)

    def gatts_set_buffer(self, handle, size, append=False):
        self.buffers[handle] = size

    def gatts_write(self, handle, data):
        self.values[handle] = bytes(data)

    def gatts_read(self, handle):
        return self.values[handle]

    def gatts_notify(self, conn, handle, data=None):
        self.notified.append((conn, handle, self.values[handle] if data is None else bytes(data)))

    # -- test helpers --

    def deliver(self, addr, adv, rssi=-60, addr_type=0, adv_type=0):
        """Plays one advertisement through the IRQ handler, as event 5 (_IRQ_SCAN_RESULT)."""
        buf_addr = bytearray(addr)
        buf_adv = bytearray(adv)
        if self.handler is not None and self.scanning:
            self.handler(5, (addr_type, memoryview(buf_addr), adv_type, rssi, memoryview(buf_adv)))
        # The stack reuses its buffers: anything that kept a view now sees garbage.
        for i in range(len(buf_addr)):
            buf_addr[i] = 0xEE
        for i in range(len(buf_adv)):
            buf_adv[i] = 0xEE

    def connect(self, conn=1, addr=b"\x11\x22\x33\x44\x55\x66"):
        """A phone connects (event 1); the stack stops advertising."""
        self.advertising = None
        self.handler(1, (conn, 1, memoryview(bytearray(addr))))

    def disconnect(self, conn=1, addr=b"\x11\x22\x33\x44\x55\x66"):
        self.handler(2, (conn, 1, memoryview(bytearray(addr))))

    def phone_write(self, handle, data, conn=1):
        """A phone writes a characteristic (event 3): the stack stores the value, then tells the handler."""
        self.values[handle] = bytes(data)
        self.handler(3, (conn, handle))

    def mtu_exchanged(self, mtu, conn=1):
        self.handler(21, (conn, mtu))

    # -- the central side: a scripted peripheral (phase 3) --

    def fake_peripheral(self, addr, adv, services, addr_type=1, fail=None):
        """services: [(svc UUID value, [(char UUID value, props, value bytes)])]. Handles are numbered as a real
        GATT table: a service's start, then per characteristic its declaration, value and a 0x2902 descriptor.
        `fail`: "connect" (never answers), "read" (status 1), or None."""
        table = []
        h = 1
        for svc, chars in services:
            start = h
            h += 1
            cs = []
            for char, props, value in chars:
                decl = h
                vh = h + 1
                cccd = h + 2
                h += 3
                cs.append({"uuid": char, "props": props, "value": value, "decl": decl, "vh": vh, "cccd": cccd, "end": cccd, "sub": False})
            table.append({"uuid": svc, "start": start, "end": h - 1, "chars": cs})
        self.peripheral = {"addr": bytes(addr), "adv": bytes(adv), "addr_type": addr_type, "advertising": True, "table": table, "fail": fail}

    def _chars(self):
        return [c for svc in self.peripheral["table"] for c in svc["chars"]]

    def gap_connect(self, addr_type, addr=None, scan_duration_ms=2000):
        self.calls.append(("gap_connect", addr_type, None if addr is None else bytes(addr)))
        if addr_type is None:
            return  # cancel
        p = self.peripheral
        if p is None or bytes(addr) != p["addr"] or p["fail"] == "connect":
            return  # nothing answers: the board's connect step times out
        self.central_conn = 64
        self.handler(7, (64, addr_type, memoryview(bytearray(addr))))

    def gap_disconnect(self, conn):
        self.calls.append(("gap_disconnect", conn))
        self.peripheral_disconnect()

    def gattc_exchange_mtu(self, conn):
        self.handler(21, (conn, 100))

    def gattc_discover_services(self, conn, uuid=None):
        for svc in self.peripheral["table"]:
            self.handler(9, (conn, svc["start"], svc["end"], UUID(svc["uuid"])))
        self.handler(10, (conn, 0))

    def gattc_discover_characteristics(self, conn, start, end, uuid=None):
        for c in self._chars():
            if start <= c["decl"] <= end:
                self.handler(11, (conn, c["end"], c["vh"], c["props"], UUID(c["uuid"])))
        self.handler(12, (conn, 0))

    def gattc_discover_descriptors(self, conn, start, end):
        for c in self._chars():
            if start <= c["cccd"] <= end:
                self.handler(13, (conn, c["cccd"], UUID(0x2902)))
        self.handler(14, (conn, 0))

    def gattc_read(self, conn, handle):
        if self.peripheral["fail"] == "read":
            self.handler(16, (conn, handle, 1))
            return
        for c in self._chars():
            if c["vh"] == handle:
                self.handler(15, (conn, handle, memoryview(bytearray(c["value"]))))
        self.handler(16, (conn, handle, 0))

    def gattc_write(self, conn, handle, data, mode=0):
        self.peer_writes.append((handle, bytes(data), mode))
        for c in self._chars():
            if c["cccd"] == handle:
                c["sub"] = bytes(data) in (b"\x01\x00", b"\x02\x00")
            if c["vh"] == handle:
                c["value"] = bytes(data)
        if mode == 1:
            self.handler(17, (conn, handle, 0))

    def peripheral_notify(self, char_uuid, data):
        """The peripheral notifies a characteristic: delivered only if the board turned notifications on."""
        for c in self._chars():
            if c["uuid"] == char_uuid and c["sub"]:
                self.handler(18, (self.central_conn, c["vh"], memoryview(bytearray(data))))

    def peripheral_disconnect(self):
        if self.central_conn is not None:
            conn = self.central_conn
            self.central_conn = None
            self.handler(8, (conn, 1, memoryview(bytearray(self.peripheral["addr"]))))

    def scan_done(self):
        if self.handler is not None:
            self.handler(6, ())


def reset():
    """A fresh radio, as after a power cycle (tests call this between cases)."""
    global FAIL_ACTIVE
    FAIL_ACTIVE = None
    if BLE._instance is not None:
        BLE._instance._reset()
