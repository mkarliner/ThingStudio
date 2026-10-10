# Stand-in for MicroPython's ntptime, for running generated clock code in CPython (node-clock.test.ts).
# settime() either sets time_mock's wall clock (CLOCK.epoch, UTC seconds) to NTP.EPOCH, as the real one sets the
# RTC, or raises OSError when NTP.FAIL is set, as a timed-out request does. NTP.CALLS counts attempts and
# NTP.HOSTS records the server each attempt used.

import time_mock


class _Ntp:
    EPOCH = 0
    FAIL = False
    CALLS = 0
    HOSTS = []


NTP = _Ntp()
host = "pool.ntp.org"


def settime():
    NTP.CALLS += 1
    NTP.HOSTS.append(host)
    if NTP.FAIL:
        raise OSError(110)
    time_mock.CLOCK.epoch = NTP.EPOCH
