# MicroPython

[MicroPython](https://micropython.org/) is a version of Python 3 made to run on microcontrollers. It fits in
hundreds of kilobytes and runs directly on the chip, with no operating system underneath.

## How it works

You flash MicroPython onto the board once, like any firmware. After that the board runs Python files from its own
filesystem, and gives you a Python prompt, the REPL, over USB. You can type Python at the board and see the
result at once.

MicroPython keeps most of the Python language and part of its standard library. It adds modules for
hardware: `machine` for pins, I2C, SPI and PWM, `network` for WiFi, and `asyncio` for running several tasks at once.

```python
from machine import Pin
led = Pin(15, Pin.OUT)
led.on()
```

## The limits

Microcontrollers are limited. A board typically has hundreds of kilobytes of RAM, and MicroPython itself uses some
of it. Python is also much slower than C, though fast enough for most sensing, switching and networking jobs.

## Where Thingstudio fits

Thingstudio runs on top of MicroPython. It installs a runtime onto the board, and turns each flow you deploy
into MicroPython code. The function node runs your own MicroPython. See
[installing MicroPython](../installing-micropython.md) to get it onto your board.

If you already use MicroPython, see [if you know MicroPython](../coming-from/micropython.md) for how Thingstudio
uses your board.

## More

Further reading:

- [MicroPython documentation](https://docs.micropython.org/en/latest/)
- [MicroPython quick reference for ESP32](https://docs.micropython.org/en/latest/esp32/quickref.html) and
  [for RP2](https://docs.micropython.org/en/latest/rp2/quickref.html)
