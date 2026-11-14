# SPDX-License-Identifier: Apache-2.0
# bench/device/viper_bench.py
#
# Plain Python vs @micropython.native vs @micropython.viper, on the board.
#
# This is the "what does the escape hatch buy?" measurement. It is separate
# from bench.py because viper/native availability differs by port and build:
# a build without the native emitter should report that as a skipped variant,
# not fail the whole suite.
#
# The sources are compiled at runtime with exec() so a port that rejects
# viper gets an error string in the result instead of a module that will not
# import. The bodies are deliberately simple and allocation-free so the
# comparison is about bytecode vs native code, not about the harness.
#
# It does not measure I/O or scheduler determinism. Viper makes a CPU loop
# faster; it does not make a blocking I2C transaction interruptible.
#
# Usage:
#   import viper_bench
#   viper_bench.main([])
#
# Or: python3 bench/host/run_bench.py --port /dev/ttyACM0 --suite viper

import gc
import sys
import time

try:
    import json
except ImportError:  # pragma: no cover
    json = None

try:
    from array import array
except ImportError:  # pragma: no cover
    array = None

JSON_BEGIN = "=== VIPER_JSON_BEGIN ==="
JSON_END = "=== VIPER_JSON_END ==="


def _us():
    return time.ticks_us()


def _diff(a, b):
    return time.ticks_diff(a, b)


def _median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def _compile(source, name):
    ns = {"micropython": __import__("micropython")}
    # Viper annotations are looked up as names in the function's globals.
    try:
        from micropython import ptr8, ptr16
        ns["ptr8"] = ptr8
        ns["ptr16"] = ptr16
    except ImportError:
        pass
    try:
        exec(source, ns)
        return ns["f"], None
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, e)


def _time_call(fn, args, reps):
    samples = []
    result = None
    for _ in range(reps):
        gc.collect()
        t0 = _us()
        result = fn(*args)
        samples.append(_diff(_us(), t0))
    return _median(samples), samples, result


# --- integer sum -----------------------------------------------------------

SUM_PLAIN = """
def f(n):
    s = 0
    for i in range(n):
        s += i
    return s
"""

SUM_NATIVE = """
@micropython.native
def f(n):
    s = 0
    for i in range(n):
        s += i
    return s
"""

SUM_VIPER = """
@micropython.viper
def f(n: int) -> int:
    s: int = 0
    for i in range(n):
        s += i
    return s
"""

# --- byte checksum / CRC-style loop ---------------------------------------

CRC_PLAIN = """
def f(data, n):
    crc = 0xFFFFFFFF
    for i in range(n):
        crc ^= data[i]
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xEDB88320
            else:
                crc >>= 1
    return crc & 0xFFFFFFFF
"""

CRC_NATIVE = """
@micropython.native
def f(data, n):
    crc = 0xFFFFFFFF
    for i in range(n):
        crc ^= data[i]
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xEDB88320
            else:
                crc >>= 1
    return crc & 0xFFFFFFFF
"""

CRC_VIPER = """
@micropython.viper
def f(data: ptr8, n: int) -> int:
    crc: int = 0xFFFFFFFF
    for i in range(n):
        crc ^= int(data[i])
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xEDB88320
            else:
                crc >>= 1
    return crc & 0xFFFFFFFF
"""

# --- 16-bit scaling (a typical sensor node's per-sample work) -------------

SCALE_PLAIN = """
def f(src, dst, n):
    for i in range(n):
        dst[i] = src[i] * 1000 // 65535
"""

SCALE_NATIVE = """
@micropython.native
def f(src, dst, n):
    for i in range(n):
        dst[i] = src[i] * 1000 // 65535
"""

SCALE_VIPER = """
@micropython.viper
def f(src: ptr16, dst: ptr16, n: int):
    for i in range(n):
        dst[i] = int(src[i]) * 1000 // 65535
"""

# --- GS4 pixel expansion (the shape display-spi already ships) ------------

PIXEL_PLAIN = """
def f(src, dst, n, pal):
    for i in range(n):
        b = src[i]
        hi = b >> 4
        lo = b & 0x0F
        c0 = pal[hi]
        c1 = pal[lo]
        j = i * 4
        dst[j] = c0 >> 8
        dst[j + 1] = c0 & 0xFF
        dst[j + 2] = c1 >> 8
        dst[j + 3] = c1 & 0xFF
"""

PIXEL_NATIVE = """
@micropython.native
def f(src, dst, n, pal):
    for i in range(n):
        b = src[i]
        hi = b >> 4
        lo = b & 0x0F
        c0 = pal[hi]
        c1 = pal[lo]
        j = i * 4
        dst[j] = c0 >> 8
        dst[j + 1] = c0 & 0xFF
        dst[j + 2] = c1 >> 8
        dst[j + 3] = c1 & 0xFF
"""

PIXEL_VIPER = """
@micropython.viper
def f(src: ptr8, dst: ptr8, n: int, pal: ptr16):
    for i in range(n):
        b = int(src[i])
        hi = b >> 4
        lo = b & 0x0F
        c0 = int(pal[hi])
        c1 = int(pal[lo])
        j = i * 4
        dst[j] = c0 >> 8
        dst[j + 1] = c0 & 0xFF
        dst[j + 2] = c1 >> 8
        dst[j + 3] = c1 & 0xFF
"""

# --- float loop (native only; viper is integer) ---------------------------

FLOAT_PLAIN = """
def f(n):
    s = 0.0
    for i in range(n):
        s += 0.5 * i
    return s
"""

FLOAT_NATIVE = """
@micropython.native
def f(n):
    s = 0.0
    for i in range(n):
        s += 0.5 * i
    return s
"""


def _make_buffer(kind, n):
    if kind == "bytes":
        return bytearray((i * 37) & 0xFF for i in range(n))
    # viper's ptr16 needs a real buffer protocol object, not a list.
    if kind == "u16":
        if array is None:
            raise RuntimeError("array module is not available")
        return array("H", [i & 0xFFFF for i in range(n)])
    if kind == "pal":
        if array is None:
            raise RuntimeError("array module is not available")
        return array("H", [((i * 977) & 0xFFFF) for i in range(16)])
    raise ValueError(kind)


def _run_variants(label, sources, maker, reps, setup):
    out = {"unit": label, "variants": {}}
    for variant, source in sources:
        fn, error = _compile(source, "%s_%s" % (label, variant))
        if error:
            out["variants"][variant] = {"skipped": error}
            continue
        try:
            args = maker()
            # Warm up once so code-page faults don't land in the first timed run.
            fn(*args)
            med, samples, result = _time_call(fn, args, reps)
            out["variants"][variant] = {
                "us_median": med,
                "us": samples,
                "result": result if isinstance(result, (int, float)) else None,
                "setup": setup,
            }
        except Exception as e:
            out["variants"][variant] = {"error": "%s: %s" % (type(e).__name__, e)}
    plain = out["variants"].get("plain", {}).get("us_median")
    for variant, row in out["variants"].items():
        if row.get("us_median") and plain:
            row["speedup_vs_plain"] = round(float(plain) / row["us_median"], 2)
    return out


def main(argv=None):
    argv = list(argv or [])
    reps = 3
    if "--reps" in argv:
        reps = int(argv[argv.index("--reps") + 1])
    no_json = "--no-json" in argv

    n_sum = 200000
    n_crc = 4096
    n_scale = 8192
    width, height = 240, 320
    n_pixel = (width * height) // 2

    result = {
        "meta": {
            "platform": getattr(sys, "platform", ""),
            "version": getattr(sys, "version", ""),
            "implementation": str(getattr(sys, "implementation", "")),
        },
        "tests": {},
    }

    result["tests"]["int_sum"] = _run_variants(
        "ops",
        [("plain", SUM_PLAIN), ("native", SUM_NATIVE), ("viper", SUM_VIPER)],
        lambda: (n_sum,),
        reps,
        {"n": n_sum},
    )

    def crc_args():
        return (bytearray((i * 31) & 0xFF for i in range(n_crc)), n_crc)

    result["tests"]["crc32_style"] = _run_variants(
        "bytes",
        [("plain", CRC_PLAIN), ("native", CRC_NATIVE), ("viper", CRC_VIPER)],
        crc_args,
        reps,
        {"bytes": n_crc},
    )

    def scale_args():
        if array is None:
            return (_make_buffer("u16", n_scale), [0] * n_scale, n_scale)
        return (_make_buffer("u16", n_scale), array("H", [0] * n_scale), n_scale)

    result["tests"]["scale_u16"] = _run_variants(
        "samples",
        [("plain", SCALE_PLAIN), ("native", SCALE_NATIVE), ("viper", SCALE_VIPER)],
        scale_args,
        reps,
        {"samples": n_scale},
    )

    def pixel_args():
        return (_make_buffer("bytes", n_pixel), bytearray(n_pixel * 4), n_pixel,
                _make_buffer("pal", 16))

    result["tests"]["pixel_gs4"] = _run_variants(
        "pixels",
        [("plain", PIXEL_PLAIN), ("native", PIXEL_NATIVE), ("viper", PIXEL_VIPER)],
        pixel_args,
        reps,
        {"source_bytes": n_pixel, "pixels": n_pixel * 4},
    )

    result["tests"]["float_mix"] = _run_variants(
        "ops",
        [("plain", FLOAT_PLAIN), ("native", FLOAT_NATIVE)],
        lambda: (n_sum,),
        reps,
        {"n": n_sum, "note": "viper is integer-only; not a viper test"},
    )

    for name, row in result["tests"].items():
        print("VIPER_TEST %s" % name)
        for variant in ("plain", "native", "viper"):
            v = row["variants"].get(variant)
            if not v:
                continue
            if v.get("skipped") or v.get("error"):
                print("  %-6s %s" % (variant, v.get("skipped") or v.get("error")))
            else:
                print("  %-6s %8d us  %5.2fx" %
                      (variant, v["us_median"], v.get("speedup_vs_plain", 1.0)))

    if not no_json and json is not None:
        print(JSON_BEGIN)
        print(json.dumps(result))
        print(JSON_END)
    return result


if __name__ == "__main__":
    main(sys.argv[1:] if getattr(sys, "argv", None) else [])
