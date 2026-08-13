# payload.py -- POC-A test program (hand-written, not compiler-generated)
#
# This is the thing being tested, per design doc S15.1: two independent
# uasyncio coroutines, confirming the S5 concurrency model holds up on real
# hardware. It is deployed as raw source text over WebSerial and exec()'d by
# device/harness.py -- it never runs standalone as main.py.
#
#   blink()    -- toggles GPIO12 (one of the board's two onboard LEDs) every
#                 400ms. First toggle prints a timestamped marker the browser
#                 uses to measure deploy -> observable-behavior-change latency.
#   poll_btn() -- polls GPIO9 (the onboard BOOT button, safe to read as a
#                 plain input once the device has already booted) every
#                 700ms and prints its value -- stands in for "polling a GPIO
#                 input or ADC and printing its value."
#
# `spawn` and `asyncio` are injected into the exec() globals by the harness.
# To smoke-test this file by hand at a plain MicroPython REPL instead of via
# the browser, replace the two `spawn(...)` calls with
# `asyncio.create_task(...)` and add `asyncio.get_event_loop().run_forever()`
# at the end.

import machine
import utime

led = machine.Pin(12, machine.Pin.OUT)
btn = machine.Pin(9, machine.Pin.IN, machine.Pin.PULL_UP)


async def blink():
    n = 0
    while True:
        led.value(not led.value())
        n += 1
        if n == 1:
            print("TOGGLE t=%d" % utime.ticks_ms())
        await asyncio.sleep_ms(400)


async def poll_btn():
    while True:
        print("BTN value=%d t=%d" % (btn.value(), utime.ticks_ms()))
        await asyncio.sleep_ms(700)


spawn(blink())
spawn(poll_btn())
print("PAYLOAD_STARTED")
