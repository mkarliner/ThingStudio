# Minimal stand-in for MicroPython's `network` module, used only to run
# compiler output through real CPython in tests (this sandbox has no
# MicroPython -- see docs/working-notes/validation/mvp-validation-plan.md).
# Not a substitute for the real headless-unix-port check; closest thing
# achievable without real MicroPython or hardware.
#
# Only what wifi-status.ts's/http-request.ts's/mqtt_as's codegen actually
# touches: WLAN(STA_IF), .active(), .connect(), .isconnected(), .ifconfig(),
# .status(), .disconnect(). No real radio/socket behavior -- state is
# entirely test-controlled via the module-level CONNECTED/IFCONFIG values,
# same pattern as machine.py's Pin.INPUT_VALUES.
#
# RSSI (added 2026-09-09, wifi-status-completeness.md): real MicroPython's
# `status('rssi')` is ESP-IDF-specific, not implemented on every port
# (RP2040's cyw43 driver, for one). Two test-controlled knobs simulate
# both real outcomes: RSSI (an int, when the board supports the call) and
# RSSI_UNSUPPORTED (True to make status('rssi') raise OSError instead,
# simulating a board where it's not available -- wifi-status.ts's own
# buildMsg is required to degrade to `rssi: None` in that case, not
# crash).

STA_IF = "STA_IF"
AP_IF = "AP_IF"

STAT_IDLE = 1000
STAT_CONNECTING = 1001
STAT_GOT_IP = 1010


class WLAN:
    # Test-controlled: set network.WLAN.CONNECTED = True/False before
    # running generated code to simulate a real link state. Defaults to
    # False -- a test that never touches this sees "not connected," same
    # as a fresh, unconfigured board.
    CONNECTED = False
    IFCONFIG = ("0.0.0.0", "255.255.255.0", "0.0.0.0", "0.0.0.0")
    RSSI = -50
    RSSI_UNSUPPORTED = False

    def __init__(self, if_id):
        self._if_id = if_id
        self._active = False
        print("WLAN_INIT %s" % if_id)

    def active(self, value=None):
        if value is None:
            return self._active
        self._active = bool(value)
        print("WLAN_ACTIVE %s %s" % (self._if_id, self._active))

    def connect(self, ssid=None, password=None):
        print("WLAN_CONNECT %s %s" % (self._if_id, ssid))

    def disconnect(self):
        print("WLAN_DISCONNECT %s" % self._if_id)

    def isconnected(self):
        return WLAN.CONNECTED

    def ifconfig(self):
        return WLAN.IFCONFIG

    def status(self, *args):
        if args and args[0] == "rssi":
            if WLAN.RSSI_UNSUPPORTED:
                raise OSError("rssi status not supported")
            return WLAN.RSSI
        return STAT_GOT_IP if WLAN.CONNECTED else STAT_IDLE

    def config(self, **_kwargs):
        pass
