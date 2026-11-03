# Minimal stand-in for MicroPython's `bluetooth` module, for ts_ble (device-runtime/src/vendor/thingstudio_ble/
# ts_ble.py) and the ble_* packages (2026-11-03). One BLE object, as on a board. It records every call so a test can
# assert on what the radio was told, and `deliver()` plays an advertisement through the registered IRQ handler the
# way the stack does: with memoryviews over a buffer the stack reuses, so code that keeps the view instead of
# copying it is caught (deliver() overwrites the buffer straight after the callback).

FAIL_ACTIVE = None  # set to an OSError to make active(True) fail, as a board out of memory does


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
        if args == ("mac",):
            return (0, b"\xd0\xcf\x13\xf9\xb7\xb2")
        return None

    def gap_scan(self, duration_ms, interval_us=1280000, window_us=11250, active=False):
        if not self.is_active:
            raise OSError(19)  # ENODEV: the radio is off
        self.calls.append(("gap_scan", duration_ms, interval_us, window_us, active))
        self.scanning = duration_ms is not None

    def gap_advertise(self, interval_us, adv_data=None, resp_data=None, connectable=True):
        if not self.is_active:
            raise OSError(19)
        self.calls.append(("gap_advertise", interval_us, None if adv_data is None else bytes(adv_data), connectable))
        self.advertising = None if interval_us is None else bytes(adv_data or b"")

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

    def scan_done(self):
        if self.handler is not None:
            self.handler(6, ())


def reset():
    """A fresh radio, as after a power cycle (tests call this between cases)."""
    global FAIL_ACTIVE
    FAIL_ACTIVE = None
    if BLE._instance is not None:
        BLE._instance._reset()
