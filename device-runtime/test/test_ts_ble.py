# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_ts_ble.py
#
# ts_ble (device-runtime/src/vendor/thingstudio_ble/ts_ble.py, BLE phase 1, 2026-11-03) under the real MicroPython
# unix port, with the real runtime.py. The unix port has no `bluetooth` module, so a small stand-in is put in
# sys.modules first; what this file proves is that ts_ble's own code (bytes handling, the advertising-data walk,
# ThreadSafeFlag, ticks, the singleton and cleanup path) runs on MicroPython, not just CPython. The editor's
# test/ts-ble.test.ts covers the same library in more depth against pymock; the radio itself needs a board.

import sys

import minitest

minitest.add_src_to_path()
_vendor = __file__.rsplit("/", 1)[0] + "/../src/vendor/thingstudio_ble" if "/" in __file__ else "../src/vendor/thingstudio_ble"
sys.path.insert(0, _vendor)


class _FakeBLE:
    """Just enough of bluetooth.BLE: records calls, plays advertisements through the IRQ handler with memoryviews
    over a buffer it then overwrites (as the stack reuses its buffers)."""

    def __init__(self):
        self.calls = []
        self.handler = None
        self.on = False

    def active(self, flag=None):
        if flag is None:
            return self.on
        self.on = bool(flag)
        self.calls.append(("active", self.on))

    def irq(self, handler):
        self.handler = handler

    def gap_scan(self, duration, interval_us=1280000, window_us=11250, active=False):
        self.calls.append(("gap_scan", duration, interval_us, window_us, active))
        if duration is None and self.handler is not None:
            self.handler(6, ())  # as the real stack does when a scan is stopped

    def gap_advertise(self, interval_us, adv_data=None, connectable=True):
        self.calls.append(("gap_advertise", interval_us, adv_data, connectable))

    def gatts_register_services(self, services):
        self.calls.append(("register", services))
        self.values = {}
        out = []
        h = 1
        for _svc, chars in services:
            hs = []
            for _c in chars:
                h += 2
                hs.append(h)
                self.values[h] = b""
            out.append(tuple(hs))
        return tuple(out)

    def gatts_set_buffer(self, handle, size, append=False):
        pass

    def gatts_write(self, handle, data):
        self.values[handle] = bytes(data)

    def gatts_read(self, handle):
        return self.values[handle]

    def gatts_notify(self, conn, handle, data=None):
        self.calls.append(("notify", conn, handle, self.values[handle] if data is None else bytes(data)))

    def config(self, *args, **kwargs):
        return None

    def deliver(self, addr, adv, rssi=-50, adv_type=0):
        a = bytearray(addr)
        d = bytearray(adv)
        self.handler(5, (0, memoryview(a), adv_type, rssi, memoryview(d)))
        for i in range(len(a)):
            a[i] = 0xEE
        for i in range(len(d)):
            d[i] = 0xEE


_BLE = _FakeBLE()


class _UUID:
    def __init__(self, value):
        self.value = value


class _BluetoothModule:
    UUID = _UUID

    @staticmethod
    def BLE():
        return _BLE


sys.modules["bluetooth"] = _BluetoothModule()

import uasyncio as asyncio  # noqa: E402
import runtime  # noqa: E402
import ts_ble  # noqa: E402

MAC = b"\xd0\xcf\x13\xf9\xb7\xb2"


def _redeploy():
    asyncio.run(runtime.cancel_running())


def test_build_and_decode_round_trip():
    a = ts_ble.build_adv("ts-c5", mfr_id=0xFFFF, mfr=b"\x01\x02")
    assert a == b"\x02\x01\x06\x06\x09ts-c5\x05\xff\xff\xff\x01\x02", a
    d = ts_ble.decode(a)
    assert d["name"] == "ts-c5" and d["mfrId"] == 0xFFFF and d["mfr"] == b"\x01\x02", d
    s = ts_ble.decode(ts_ble.build_adv("", svc_uuid="fcd2", svc=b"\x40"))
    assert s["svcData"] == {"fcd2": b"\x40"}, s


def test_128_bit_uuid_round_trip():
    u = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
    d = ts_ble.decode(ts_ble.build_adv("", svc_uuid=u, svc=b"\x01"))
    assert d["svcData"] == {u: b"\x01"}, d


def test_over_limit_names_the_sizes():
    try:
        ts_ble.build_adv("a-long-name", mfr_id=1, mfr=b"x" * 20)
    except ValueError as e:
        assert "40 bytes, the limit is 31" in str(e), e
        return
    assert False, "no error"


def test_malformed_advertising_data_never_raises():
    for bad in (b"", b"\x00", b"\xff\x09abc", b"\x05\x09ab", b"\x02\xff\x01", b"\x03\x09\xff\xfe"):
        assert ts_ble.decode(bad)["name"] == ""


def test_scan_copies_filters_and_queues():
    r = ts_ble.radio()
    s = r.scan("n1", 320, 30, False, name_prefix="ts", addr="", mfr_id=None, svc_uuid="", repeat_ms=0)
    assert ("gap_scan", 0, 320000, 30000, False) in _BLE.calls, _BLE.calls
    _BLE.deliver(MAC, ts_ble.build_adv("ts-1"))
    _BLE.deliver(MAC, ts_ble.build_adv("other"))

    async def scenario():
        m = await s.next()
        assert m["addr"] == "d0:cf:13:f9:b7:b2", m["addr"]
        assert ts_ble.decode(m["payload"])["name"] == "ts-1"
        assert len(s.queue) == 0

    asyncio.run(scenario())
    _redeploy()


def test_empty_scan_response_dropped():
    r = ts_ble.radio()
    s = r.scan("n1", 320, 30, True, name_prefix="", addr="", mfr_id=None, svc_uuid="", repeat_ms=0)
    _BLE.deliver(MAC, ts_ble.build_adv("x"), adv_type=0)
    _BLE.deliver(MAC, b"", adv_type=4)
    _BLE.deliver(MAC, ts_ble.build_adv("rsp"), adv_type=4)
    assert len(s.queue) == 2, len(s.queue)
    assert s.queue[1]["scanResponse"] is True and s.queue[1]["connectable"] is None, s.queue[1]
    _redeploy()


def test_repeat_window_uses_ticks():
    r = ts_ble.radio()
    s = r.scan("n1", 320, 30, False, name_prefix="", addr="", mfr_id=None, svc_uuid="", repeat_ms=60000)
    a = ts_ble.build_adv("t", mfr_id=1, mfr=b"\x01")
    _BLE.deliver(MAC, a)
    _BLE.deliver(MAC, a)
    _BLE.deliver(MAC, ts_ble.build_adv("t", mfr_id=1, mfr=b"\x02"))
    assert len(s.queue) == 2, len(s.queue)
    _redeploy()


def test_different_scan_settings_refused():
    r = ts_ble.radio()
    r.scan("n1", 320, 30, False, name_prefix="", addr="", mfr_id=None, svc_uuid="", repeat_ms=0)
    try:
        r.scan("n2", 320, 60, False, name_prefix="", addr="", mfr_id=None, svc_uuid="", repeat_ms=0)
    except ValueError as e:
        assert "already set up" in str(e), e
        _redeploy()
        return
    assert False, "no error"


def test_encode_and_decode_values():
    assert ts_ble.encode("int16", -5) == b"\xfb\xff"
    assert ts_ble.decode_value("int16", b"\xfb\xff") == -5
    assert ts_ble.encode("uint8", 255) == b"\xff"
    assert ts_ble.encode("text", 21.5) == b"21.5"
    assert abs(ts_ble.decode_value("float32", ts_ble.encode("float32", 21.5)) - 21.5) < 1e-6
    assert ts_ble.decode_value("text", b"hi") == "hi"
    for enc, bad in (("int16", 70000), ("uint8", -1), ("int8", "abc"), ("uint32", True)):
        try:
            ts_ble.encode(enc, bad)
        except ValueError:
            continue
        assert False, "no error for %s %r" % (enc, bad)
    for enc, data in (("int16", b"\x01"), ("text", b"\xff\xfe")):
        try:
            ts_ble.decode_value(enc, data)
        except ValueError:
            continue
        assert False, "no error for %s %r" % (enc, data)


def test_gatt_registers_once_and_routes_writes():
    svc = "6e400010-b5a3-f393-e0a9-e50e24dcca9e"
    char = "6e400011-b5a3-f393-e0a9-e50e24dcca9e"
    table = [[svc, [[char, 0x1E]]], [ts_ble.NUS_SERVICE, [[ts_ble.NUS_RX, 0x0C], [ts_ble.NUS_TX, 0x10]]]]
    r = ts_ble.radio()
    g = r.gatt(table, "ts")
    assert r.gatt(table, "ts") is g
    assert len([c for c in _BLE.calls if c[0] == "register"]) == 1
    w = g.on_writes("n1", svc, char)
    h = g.handle(svc, char)
    _BLE.handler(1, (5, 1, memoryview(bytearray(6))))
    _BLE.values[h] = b"\x01\x02"
    _BLE.handler(3, (5, h))
    assert w.queue == [(b"\x01\x02", 5)], w.queue
    assert g.write("n2", svc, char, b"\x09", True) == 1
    assert g.send_chunks("n3", ts_ble.NUS_SERVICE, ts_ble.NUS_TX, b"x" * 45) == 3
    _BLE.handler(2, (5, 1, memoryview(bytearray(6))))
    assert g.conns == {}
    _redeploy()


def test_redeploy_turns_the_radio_off_and_the_next_deploy_starts_fresh():
    r = ts_ble.radio()
    r.scan("n1", 320, 30, False, name_prefix="", addr="", mfr_id=None, svc_uuid="", repeat_ms=0)
    r.advertise("a1", 500, ts_ble.build_adv("ts"))
    reported = []
    saved = runtime.report_status
    runtime.report_status = lambda nid, state, text=None: reported.append((nid, state, text))
    try:
        _redeploy()
    finally:
        runtime.report_status = saved
    assert reported == [], reported
    assert _BLE.on is False
    r2 = ts_ble.radio()
    assert r2 is not r and _BLE.on is True and r2.scanners == []
    _redeploy()


minitest.run(
    [
        test_build_and_decode_round_trip,
        test_128_bit_uuid_round_trip,
        test_over_limit_names_the_sizes,
        test_malformed_advertising_data_never_raises,
        test_scan_copies_filters_and_queues,
        test_empty_scan_response_dropped,
        test_repeat_window_uses_ticks,
        test_different_scan_settings_refused,
        test_encode_and_decode_values,
        test_gatt_registers_once_and_routes_writes,
        test_redeploy_turns_the_radio_off_and_the_next_deploy_starts_fresh,
    ]
)
