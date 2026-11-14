# SPDX-License-Identifier: Apache-2.0
# bench/device/bench.py
#
# Device-side MicroPython performance bench. One file, no dependencies beyond
# what a stock MicroPython build ships, so it can be pasted into Thonny or run
# with `mpremote run`.
#
# It measures the MicroPython baseline, not ThingStudio: interpreter ops, GC,
# asyncio scheduling, machine.Timer callbacks, ADC read rates, external pin
# IRQ servicing, and _thread scaling. The ThingStudio-overhead comparisons are
# separate flows (bench/flows/) because they need the runtime and a deploy.
#
# What this is not
# ----------------
# - Not a real-time guarantee. Timer callbacks are port-specific: on some
#   ports they run in a hard ISR, on others in a soft IRQ or an esp_timer task.
#   The result records what the port did, not an abstract "MicroPython" figure.
# - Not comparable across boards without the metadata. Always publish
#   board/port/firmware/frequency with the numbers.
# - Not a substitute for a scope/logic analyser for IRQ latency. The IRQ test
#   only counts edges roughly in software, because a real ISR cannot allocate
#   and therefore cannot timestamp safely. Use the marker pin and the Pico LA
#   for edge-to-edge latency.
#
# Output
# ------
# Human-readable lines as tests run, then one JSON object between
# BENCH_JSON_BEGIN / BENCH_JSON_END markers. bench/host/run_bench.py parses
# that block and writes a results file.
#
# Usage on a board (defaults: safe, no wiring except ADC if a default pin
# exists; the IRQ test is skipped unless --irq-pin is given):
#
#   import bench
#   bench.main([])
#
# Or from the host:
#
#   python3 bench/host/run_bench.py --port /dev/ttyACM0
#
# The module stays importable so the host runner can copy it once and call
# main() with a test list, and so the unix port can validate the logic.

import gc
import os
import sys
import time

try:
    import json
except ImportError:  # pragma: no cover - every supported build has json
    json = None

try:
    import machine
except ImportError:  # unix port and a few constrained builds
    machine = None

try:
    import asyncio
except ImportError:  # pragma: no cover - MicroPython >= 1.13 has asyncio
    try:
        import uasyncio as asyncio
    except ImportError:
        asyncio = None

try:
    import _thread
except ImportError:
    _thread = None


JSON_BEGIN = "=== BENCH_JSON_BEGIN ==="
JSON_END = "=== BENCH_JSON_END ==="

# Histogram width for callback/IRQ intervals, in microseconds. Anything longer
# is clamped into the last bucket; the max is tracked separately, so clamping
# never hides an outlier from the summary.
HIST_US = 2000


# ---------------------------------------------------------------------------
# small helpers (MicroPython has no statistics module on every port)
# ---------------------------------------------------------------------------


def _ticks_us():
    return time.ticks_us()


def _ticks_ms():
    return time.ticks_ms()


def _diff(a, b):
    return time.ticks_diff(a, b)


def _split_ints(text):
    out = []
    for part in str(text).split(","):
        part = part.strip()
        if part:
            out.append(int(part, 0))
    return out


def _hist_new(n=HIST_US):
    # A plain list, not array: MicroPython's array has no sequence-repeat
    # support, and 2000 small ints is affordable on every target here.
    return [0] * n


def _hist_add(hist, value):
    if value < 0:
        value = 0
    if value >= len(hist):
        value = len(hist) - 1
    hist[value] += 1


def _hist_pct(hist, total, pct):
    if total <= 0:
        return None
    if pct <= 0:
        for i in range(len(hist)):
            if hist[i]:
                return i
        return None
    target = max(1, (total * pct + 99) // 100)
    seen = 0
    for i in range(len(hist)):
        seen += hist[i]
        if seen >= target:
            return i
    return len(hist) - 1


def _hist_sparse(hist):
    out = []
    for i in range(len(hist)):
        if hist[i]:
            out.append([i, hist[i]])
    return out


def _summary(values):
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    return {
        "n": n,
        "min": ordered[0],
        "median": ordered[n // 2],
        "p95": ordered[min(n - 1, (n * 95) // 100)],
        "max": ordered[-1],
    }


def _mem_free():
    try:
        return gc.mem_free()
    except Exception:
        return None


def _mem_alloc():
    try:
        return gc.mem_alloc()
    except Exception:
        return None


def _machine_freq():
    if machine is None:
        return None
    try:
        return machine.freq()
    except Exception:
        return None


def _uname():
    try:
        u = os.uname()
        return {
            "sysname": u[0],
            "nodename": u[1],
            "release": u[2],
            "version": u[3],
            "machine": u[4],
        }
    except Exception:
        return {}


def _meta():
    return {
        "platform": getattr(sys, "platform", ""),
        "version": getattr(sys, "version", ""),
        "implementation": str(getattr(sys, "implementation", "")),
        "uname": _uname(),
        "freq_hz": _machine_freq(),
        "mem_free": _mem_free(),
        "mem_alloc": _mem_alloc(),
    }


# ---------------------------------------------------------------------------
# interpreter baseline
# ---------------------------------------------------------------------------


def _op_pass(n):
    for _ in range(n):
        pass


def _op_int_add(n):
    s = 0
    for i in range(n):
        s += i
    return s


def _op_func_call(n):
    f = _tiny
    for i in range(n):
        f(i)


def _tiny(x):
    return x + 1


class _Holder:
    pass


def _op_attr(n):
    o = _Holder()
    o.x = 1
    for _ in range(n):
        o.x


def _op_dict(n):
    d = {"a": 1}
    for _ in range(n):
        d["a"]


def _op_float(n):
    s = 0.0
    for _ in range(n):
        s += 1.5
    return s


def _op_list_append(n):
    out = []
    for _ in range(n):
        out.append(1)
    return out


def _op_str_format(n):
    for i in range(n):
        "%d" % i


INTERP_OPS = (
    ("pass", _op_pass),
    ("int_add", _op_int_add),
    ("func_call", _op_func_call),
    ("attr_read", _op_attr),
    ("dict_get", _op_dict),
    ("float_add", _op_float),
    ("list_append", _op_list_append),
    ("str_format", _op_str_format),
)


def _calibrate(fn, target_us, max_n):
    n = 100
    dt = 0
    while True:
        if n > max_n:
            n = max_n
        gc.collect()
        t0 = _ticks_us()
        fn(n)
        dt = _diff(_ticks_us(), t0)
        if dt >= target_us or n >= max_n:
            return n, dt
        n *= 4


# Some operations allocate n objects; cap them so the bench itself doesn't
# turn a memory figure into a MemoryError on a small board.
INTERP_CAPS = {
    "list_append": 50000,
    "str_format": 200000,
}


def _test_interp(cfg):
    out = {}
    target_us = cfg["interp_ms"] * 1000
    reps = cfg["reps"]
    for name, fn in INTERP_OPS:
        try:
            n, _ = _calibrate(fn, target_us, INTERP_CAPS.get(name, 2000000))
        except MemoryError:
            n = min(INTERP_CAPS.get(name, 200000), 10000)
            gc.collect()
        samples = []
        try:
            for _ in range(reps):
                gc.collect()
                t0 = _ticks_us()
                fn(n)
                samples.append(_diff(_ticks_us(), t0))
            med = sorted(samples)[len(samples) // 2]
            out[name] = {
                "n": n,
                "us": samples,
                "us_median": med,
                "ops_per_s": round(n * 1000000.0 / med, 1) if med else None,
                "ns_per_op": round(med * 1000.0 / n, 1) if n else None,
            }
            print("  interp %-12s n=%-8d median=%6d us  %8.1f ops/s" %
                  (name, n, med, out[name]["ops_per_s"] or 0))
        except Exception as e:
            out[name] = {"n": n, "error": "%s: %s" % (type(e).__name__, e)}
            print("  interp %-12s error: %s" % (name, out[name]["error"]))
        gc.collect()
    return out


# ---------------------------------------------------------------------------
# GC
# ---------------------------------------------------------------------------


def _test_gc(cfg):
    gc.collect()
    free0 = _mem_free()
    alloc0 = _mem_alloc()
    times = []
    for _ in range(10):
        t0 = _ticks_us()
        gc.collect()
        times.append(_diff(_ticks_us(), t0))
    free1 = _mem_free()
    alloc1 = _mem_alloc()

    churn_times = []
    for _ in range(20):
        t0 = _ticks_us()
        buf = bytearray(1024)
        buf[0] = 1
        del buf
        gc.collect()
        churn_times.append(_diff(_ticks_us(), t0))

    return {
        "collect_us": times,
        "collect_summary": _summary(times),
        "churn_1k_us": churn_times,
        "churn_summary": _summary(churn_times),
        "mem_free_before": free0,
        "mem_free_after": free1,
        "mem_alloc_before": alloc0,
        "mem_alloc_after": alloc1,
    }


# ---------------------------------------------------------------------------
# asyncio
# ---------------------------------------------------------------------------


async def _async_spin(n):
    for _ in range(n):
        await asyncio.sleep_ms(0)


async def _async_sleep(n, ms, hist):
    for _ in range(n):
        t0 = _ticks_us()
        await asyncio.sleep_ms(ms)
        _hist_add(hist, _diff(_ticks_us(), t0))


async def _async_pingpong(n):
    a_ready = asyncio.Event()
    b_ready = asyncio.Event()

    async def a():
        for _ in range(n):
            await a_ready.wait()
            a_ready.clear()
            b_ready.set()

    async def b():
        for _ in range(n):
            await b_ready.wait()
            b_ready.clear()
            a_ready.set()

    ta = asyncio.create_task(a())
    tb = asyncio.create_task(b())
    a_ready.set()
    await ta
    await tb


def _run_async(coro):
    if asyncio is None:
        raise RuntimeError("asyncio is not available")
    try:
        asyncio.run(coro)
    except AttributeError:  # very old MicroPython without asyncio.run
        loop = asyncio.get_event_loop()
        loop.run_until_complete(coro)


def _test_async(cfg):
    if asyncio is None:
        return {"error": "asyncio not available"}

    switches = 2000
    t0 = _ticks_us()
    _run_async(_async_spin(switches))
    spin_us = _diff(_ticks_us(), t0)

    hist = _hist_new()
    sleep_n = 200
    t0 = _ticks_us()
    _run_async(_async_sleep(sleep_n, 1, hist))
    sleep_us = _diff(_ticks_us(), t0)

    t0 = _ticks_us()
    _run_async(_async_pingpong(1000))
    pingpong_us = _diff(_ticks_us(), t0)

    total = sleep_n
    return {
        "switch_n": switches,
        "switch_us": spin_us,
        "switch_per_s": round(switches * 1000000.0 / spin_us, 1) if spin_us else None,
        "us_per_switch": round(spin_us / switches, 1) if switches else None,
        "sleep_n": sleep_n,
        "sleep_total_us": sleep_us,
        "sleep_expected_us": sleep_n * 1000,
        "sleep_drift_us": sleep_us - sleep_n * 1000,
        "sleep_latency": {
            "min": _hist_pct(hist, total, 0),
            "p50": _hist_pct(hist, total, 50),
            "p95": _hist_pct(hist, total, 95),
            "p99": _hist_pct(hist, total, 99),
            "max": _hist_pct(hist, total, 100),
            "hist": _hist_sparse(hist),
        },
        "pingpong_n": 1000,
        "pingpong_us": pingpong_us,
        "pingpong_per_s": round(1000 * 1000000.0 / pingpong_us, 1) if pingpong_us else None,
    }


# ---------------------------------------------------------------------------
# machine.Timer callbacks
# ---------------------------------------------------------------------------

_t_count = 0
_t_last = 0
_t_min = 0
_t_max = 0
_t_hist = None


def _timer_cb(_t):
    # Deliberately minimal: a dictionary lookup and a helper call per
    # callback would measure the bench, not the port. This is still a real
    # Python callback, so it is an upper bound on what a user callback can do.
    global _t_count, _t_last, _t_min, _t_max
    now = _ticks_us()
    if _t_count:
        d = _diff(now, _t_last)
        _t_last = now
        if d < _t_min:
            _t_min = d
        if d > _t_max:
            _t_max = d
        bucket = d
        if bucket < 0:
            bucket = 0
        if bucket >= HIST_US:
            bucket = HIST_US - 1
        _t_hist[bucket] += 1
    else:
        _t_last = now
    _t_count += 1


def _make_timer(timer_id):
    if machine is None:
        raise RuntimeError("machine module is not available")
    try:
        return machine.Timer(timer_id)
    except (TypeError, ValueError):
        # Ports without virtual timers reject id=-1; try the no-argument form.
        return machine.Timer()


def _timer_one(freq, timer_id, duration_ms, want_hard):
    global _t_count, _t_last, _t_min, _t_max, _t_hist
    _t_count = 0
    _t_last = 0
    _t_min = 1 << 30
    _t_max = 0
    _t_hist = _hist_new()

    tim = _make_timer(timer_id)
    init = {"mode": machine.Timer.PERIODIC, "freq": freq, "callback": _timer_cb}
    used_hard = None
    try:
        init["hard"] = bool(want_hard)
        tim.init(**init)
        used_hard = bool(want_hard)
    except Exception:
        # Virtual timers, and some ports/builds, reject `hard`; a hard ISR
        # also cannot safely run this callback (it records timestamps and
        # increments histogram buckets). Fall back to the soft path.
        init.pop("hard", None)
        try:
            tim.init(**init)
            used_hard = None
        except Exception:
            try:
                tim.deinit()
            except Exception:
                pass
            raise

    try:
        start = _ticks_us()
        time.sleep_ms(duration_ms)
        elapsed = _diff(_ticks_us(), start)
    finally:
        try:
            tim.deinit()
        except Exception:
            pass

    count = _t_count
    intervals = count - 1
    expected = int(freq * elapsed / 1000000.0)
    hist = _t_hist
    return {
        "freq_hz": freq,
        "hard": used_hard,
        "duration_us": elapsed,
        "callback_count": count,
        "expected_callbacks": expected,
        "missed": max(0, expected - count),
        "achieved_hz": round(intervals * 1000000.0 / elapsed, 1) if elapsed else None,
        "interval_us": {
            "min": None if _t_min == (1 << 30) else _t_min,
            "p50": _hist_pct(hist, intervals, 50),
            "p95": _hist_pct(hist, intervals, 95),
            "p99": _hist_pct(hist, intervals, 99),
            "max": _t_max,
            "hist": _hist_sparse(hist),
        },
    }


def _test_timer(cfg):
    if machine is None:
        return {"error": "machine module is not available"}
    out = {}
    for freq in cfg["timer_freqs"]:
        key = str(freq)
        try:
            out[key] = _timer_one(freq, cfg["timer_id"], cfg["duration_ms"], cfg["timer_hard"])
            row = out[key]
            print("  timer %-8s achieved=%8.1f Hz  p99=%s us  missed=%d" %
                  (key, row["achieved_hz"] or 0,
                   row["interval_us"]["p99"], row["missed"]))
        except Exception as e:
            out[key] = {"freq_hz": freq, "error": "%s: %s" % (type(e).__name__, e)}
            print("  timer %-8s error: %s" % (key, out[key]["error"]))
    return out


# ---------------------------------------------------------------------------
# ADC
# ---------------------------------------------------------------------------


def _adc_pins_default():
    platform = getattr(sys, "platform", "")
    if platform == "rp2":
        return [26]  # ADC0 on Pico / Pico W
    return []


def _adc_open(pin_no):
    if machine is None:
        raise RuntimeError("machine module is not available")
    adc = machine.ADC(machine.Pin(pin_no))
    try:
        adc.atten(machine.ADC.ATTN_11DB)
    except AttributeError:
        pass
    return adc


def _test_adc(cfg):
    pins = cfg["adc_pins"] if cfg["adc_pins"] is not None else _adc_pins_default()
    if not pins:
        return {"skipped": "no ADC pins given; pass --adc-pins (e.g. 26 on RP2040)"}

    try:
        adcs = [_adc_open(p) for p in pins]
    except Exception as e:
        return {"error": "%s: %s" % (type(e).__name__, e), "pins": pins}

    duration_us = cfg["duration_ms"] * 1000
    t0 = _ticks_us()
    n = 0
    while _diff(_ticks_us(), t0) < duration_us:
        for adc in adcs:
            adc.read_u16()
        n += 1
    elapsed = _diff(_ticks_us(), t0)
    samples = n * len(adcs)

    uv = None
    try:
        t0 = _ticks_us()
        n_uv = 0
        while _diff(_ticks_us(), t0) < duration_us // 2 and n_uv < 10000:
            adcs[0].read_uv()
            n_uv += 1
        elapsed_uv = _diff(_ticks_us(), t0)
        uv = {
            "n": n_uv,
            "us": elapsed_uv,
            "per_s": round(n_uv * 1000000.0 / elapsed_uv, 1) if elapsed_uv else None,
        }
    except AttributeError:
        uv = {"skipped": "read_uv not available"}
    except Exception as e:
        uv = {"error": "%s: %s" % (type(e).__name__, e)}

    return {
        "pins": pins,
        "rounds": n,
        "samples": samples,
        "elapsed_us": elapsed,
        "samples_per_s": round(samples * 1000000.0 / elapsed, 1) if elapsed else None,
        "per_channel_per_s": round(n * 1000000.0 / elapsed, 1) if elapsed else None,
        "read_uv": uv,
    }


# ---------------------------------------------------------------------------
# external pin IRQ (needs a signal generator; software timing is biased)
# ---------------------------------------------------------------------------

# ISR context cannot allocate. A Python int counter is an allocation once it
# grows past the cached small ints, so the handler keeps a wrapping byte in a
# bytearray (small ints only) and toggles a marker pin. The main loop samples
# the byte; a wrap between samples is lost, which is why this test reports a
# rough rate and the logic analyser is the authority on latency/count.
_i_small = None
_i_out = None
_i_level = 0


def _irq_cb(_p):
    global _i_level
    v = _i_small[0]
    # Keep every intermediate a cached small int: no allocation in the ISR.
    if v == 255:
        _i_small[0] = 0
    else:
        _i_small[0] = v + 1
    if _i_out is not None:
        _i_level ^= 1
        _i_out.value(_i_level)


def _test_irq(cfg):
    if machine is None:
        return {"error": "machine module is not available"}
    if cfg["irq_pin"] is None:
        return {"skipped": "pass --irq-pin (and drive it from a generator)"}

    global _i_small, _i_out, _i_level
    _i_small = bytearray(1)
    _i_level = 0
    _i_out = None
    if cfg["irq_out_pin"] is not None:
        _i_out = machine.Pin(cfg["irq_out_pin"], machine.Pin.OUT)
        _i_out.value(0)

    pin = machine.Pin(cfg["irq_pin"], machine.Pin.IN)
    trigger = machine.Pin.IRQ_RISING
    if cfg["irq_edge"] == "falling":
        trigger = machine.Pin.IRQ_FALLING
    elif cfg["irq_edge"] == "both":
        trigger = machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING

    pin.irq(trigger=trigger, handler=_irq_cb)
    count = 0
    last = 0
    start = _ticks_us()
    try:
        while _diff(_ticks_us(), start) < cfg["duration_ms"] * 1000:
            time.sleep_ms(1)
            now = _i_small[0]
            count += (now - last) & 0xFF
            last = now
    finally:
        try:
            pin.irq(handler=None)
        except Exception:
            pass
    elapsed = _diff(_ticks_us(), start)

    expected = None
    missed = None
    if cfg["irq_hz"]:
        expected = int(cfg["irq_hz"] * elapsed / 1000000.0)
        missed = max(0, expected - count)
    return {
        "pin": cfg["irq_pin"],
        "out_pin": cfg["irq_out_pin"],
        "edge": cfg["irq_edge"],
        "duration_us": elapsed,
        "count": count,
        "expected": expected,
        "missed": missed,
        "achieved_hz": round(count * 1000000.0 / elapsed, 1) if elapsed else None,
        "note": "rough software count; a wrap between 1 ms samples is lost; "
                "use the LA on --irq-out-pin for latency and exact counts",
    }


# ---------------------------------------------------------------------------
# _thread scaling (answers "does threading help?" with a measurement)
# ---------------------------------------------------------------------------


def _thread_test(cfg):
    if _thread is None:
        return {"skipped": "_thread is not available on this port"}
    duration_ms = cfg["duration_ms"]
    counters = [0, 0]
    stop = [0]

    def worker(idx):
        n = 0
        while not stop[0]:
            n += 1
        counters[idx] = n

    def run(count):
        counters[0] = 0
        counters[1] = 0
        stop[0] = 0
        t0 = _ticks_ms()
        for i in range(count):
            _thread.start_new_thread(worker, (i,))
        time.sleep_ms(duration_ms)
        stop[0] = 1
        time.sleep_ms(30)  # let the workers observe stop and write their counters
        return _diff(_ticks_ms(), t0), counters[0] + counters[1]

    single_us, single = run(1)
    double_us, double = run(2)
    return {
        "duration_ms": duration_ms,
        "single_count": single,
        "single_us": single_us,
        "double_count": double,
        "double_us": double_us,
        "scaling": round(float(double) / single, 3) if single else None,
        "note": "MCU ports are GIL-bound, so scaling should be near 1; the unix port may exceed 1",
    }


# ---------------------------------------------------------------------------
# config + dispatch
# ---------------------------------------------------------------------------


def _default_config():
    return {
        "tests": None,
        "reps": 5,
        "duration_ms": 500,
        "interp_ms": 250,
        "adc_pins": None,
        "irq_pin": None,
        "irq_out_pin": None,
        "irq_hz": None,
        "irq_edge": "rising",
        "timer_freqs": [100, 1000, 5000, 10000, 20000],
        "timer_id": -1,
        "timer_hard": False,
        "json": True,
    }


def _parse_args(argv):
    cfg = _default_config()
    i = 0
    while i < len(argv):
        arg = argv[i]
        key = arg
        value = None
        if "=" in arg and arg.startswith("--"):
            key, value = arg.split("=", 1)
        elif arg.startswith("--") and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            value = argv[i + 1]
            i += 1

        if key == "--tests":
            cfg["tests"] = [t for t in str(value).split(",") if t]
        elif key == "--reps":
            cfg["reps"] = int(value)
        elif key == "--duration-ms":
            cfg["duration_ms"] = int(value)
        elif key == "--interp-ms":
            cfg["interp_ms"] = int(value)
        elif key == "--adc-pins":
            cfg["adc_pins"] = _split_ints(value)
        elif key == "--irq-pin":
            cfg["irq_pin"] = int(value, 0)
        elif key == "--irq-out-pin":
            cfg["irq_out_pin"] = int(value, 0)
        elif key == "--irq-hz":
            cfg["irq_hz"] = int(value, 0)
        elif key == "--irq-edge":
            cfg["irq_edge"] = str(value)
        elif key == "--timer-freqs":
            cfg["timer_freqs"] = _split_ints(value)
        elif key == "--timer-id":
            cfg["timer_id"] = int(value, 0)
        elif key == "--timer-hard":
            cfg["timer_hard"] = True
        elif key == "--no-json":
            cfg["json"] = False
        elif key in ("--help", "-h"):
            print("bench.py: --tests interp,gc,async,timer,adc,irq,thread "
                  "--reps N --duration-ms N --interp-ms N --adc-pins 26,27 "
                  "--irq-pin N --irq-out-pin N --irq-hz N --irq-edge rising|falling|both "
                  "--timer-freqs 100,1000,5000,10000,20000 --timer-id N --timer-hard --no-json")
            return None
        else:
            print("bench.py: ignoring unknown argument %r" % (arg,))
        i += 1
    return cfg


ALL_TESTS = ("interp", "gc", "async", "timer", "adc", "irq", "thread")


def _run_one(name, cfg):
    if name == "interp":
        return _test_interp(cfg)
    if name == "gc":
        return _test_gc(cfg)
    if name == "async":
        return _test_async(cfg)
    if name == "timer":
        return _test_timer(cfg)
    if name == "adc":
        return _test_adc(cfg)
    if name == "irq":
        return _test_irq(cfg)
    if name == "thread":
        return _thread_test(cfg)
    raise ValueError("unknown test %r" % (name,))


def _emit_json(result):
    if json is None:
        print("BENCH_JSON_ERROR json module is not available")
        return
    print(JSON_BEGIN)
    print(json.dumps(result))
    print(JSON_END)


def main(argv=None):
    if argv is None:
        argv = getattr(sys, "argv", [])
        if argv and argv[0].endswith(".py"):
            argv = argv[1:]
    cfg = _parse_args(argv)
    if cfg is None:
        return

    tests = cfg["tests"]
    if tests is None:
        tests = ["interp", "gc", "async", "timer", "adc", "thread"]
        if cfg["irq_pin"] is not None:
            tests.append("irq")

    result = {"meta": _meta(), "config": {
        "tests": tests,
        "reps": cfg["reps"],
        "duration_ms": cfg["duration_ms"],
        "timer_freqs": cfg["timer_freqs"],
        "timer_id": cfg["timer_id"],
        "timer_hard": cfg["timer_hard"],
        "adc_pins": cfg["adc_pins"],
        "irq_pin": cfg["irq_pin"],
        "irq_out_pin": cfg["irq_out_pin"],
        "irq_hz": cfg["irq_hz"],
    }, "tests": {}}

    print("BENCH_START %s" % (result["meta"].get("version") or "",))
    for name in tests:
        if name not in ALL_TESTS:
            result["tests"][name] = {"error": "unknown test"}
            continue
        print("BENCH_TEST %s" % name)
        gc.collect()
        try:
            result["tests"][name] = _run_one(name, cfg)
        except Exception as e:
            result["tests"][name] = {"error": "%s: %s" % (type(e).__name__, e)}
            print("  %s error: %s" % (name, result["tests"][name]["error"]))
        gc.collect()

    result["meta"]["mem_free_after"] = _mem_free()
    print("BENCH_DONE")
    if cfg["json"]:
        _emit_json(result)
    return result


if __name__ == "__main__":
    main()
