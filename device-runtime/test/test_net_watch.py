# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_net_watch.py
#
# net_transport's WiFi watcher under the real MicroPython unix port, with a stand-in `network` module that
# counts how often the station is created. On an ESP32, creating network.WLAN(STA_IF) starts the WiFi driver,
# so the watcher must leave it alone unless WiFi is wanted -- a board password, or a flow that imports
# `network` -- and must back off, not retry every 2 s, when the driver fails to start (CYD, 2026-10-08: a
# display flow had used the memory WiFi needs and ESP-IDF logged errors every 2 s).

import sys

import minitest

minitest.add_src_to_path()

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio


class _FakeWLAN:
    made = 0
    fail = False

    def __init__(self, _iface):
        _FakeWLAN.made += 1
        if _FakeWLAN.fail:
            raise OSError(-1, "wifi init failed")

    def active(self):
        return False

    def isconnected(self):
        return False


class _FakeNetwork:
    STA_IF = 0
    WLAN = _FakeWLAN

    @staticmethod
    def hostname(_name=None):
        return "test"


sys.modules["network"] = _FakeNetwork
import board_settings  # noqa: E402
import net_transport  # noqa: E402

net_transport._TEST_IP = None
net_transport._WATCH_TICK_MS = 1
_password = [False]
board_settings.password_set = lambda: _password[0]


def _run(ms):
    async def main():
        t = asyncio.create_task(net_transport.watch({}))
        await asyncio.sleep_ms(ms)
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    asyncio.run(main())


def _reset():
    _FakeWLAN.made = 0
    _FakeWLAN.fail = False
    _password[0] = False
    sys.modules.pop("_flow", None)


def test_leaves_wifi_alone_when_nothing_wants_it():
    _reset()
    _run(200)
    assert _FakeWLAN.made == 0, _FakeWLAN.made


def test_looks_when_a_password_is_set():
    _reset()
    _password[0] = True
    _run(200)
    assert _FakeWLAN.made > 0


def test_looks_when_the_flow_uses_the_network():
    _reset()

    class _Flow:
        network = _FakeNetwork

    sys.modules["_flow"] = _Flow
    _run(200)
    assert _FakeWLAN.made > 0


def test_a_flow_without_network_doesnt_count():
    _reset()

    class _Flow:
        pass

    sys.modules["_flow"] = _Flow
    _run(200)
    assert _FakeWLAN.made == 0, _FakeWLAN.made


def test_backs_off_when_wifi_fails_to_start():
    _reset()
    _password[0] = True
    _FakeWLAN.fail = True
    _run(300)  # ~300 ticks: without backoff that's ~37 attempts (one per 8 ticks)
    assert _FakeWLAN.made == 1, _FakeWLAN.made


minitest.run(
    [
        test_leaves_wifi_alone_when_nothing_wants_it,
        test_looks_when_a_password_is_set,
        test_looks_when_the_flow_uses_the_network,
        test_a_flow_without_network_doesnt_count,
        test_backs_off_when_wifi_fails_to_start,
    ]
)
