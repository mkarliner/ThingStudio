# `st7796py`

ST7796 / ST7796S SPI colour TFT driver (320x480), a small subclass of `st7789py`'s `ST77xx` base class.

Written for Thingstudio, not vendored from upstream. The start-up register values are the ones the widely used
TFT_eSPI (`ST7796_Init.h`) and Arduino_GFX ST7796 drivers send; the Freenove ESP32-S3 Display 4.0" (FNK0104S)
uses the same sequence. Only the sequence is shared, no code is copied.

- Depends on `st7789py` (the `ST77xx` base: SPI writes, windows, `blit_buffer`, `fill`).
- No hard reset when the board has no reset pin; a software reset runs either way.
- Offsets are 0: this controller has no hidden margin, unlike ST7789 panels smaller than 240x320.

Not yet confirmed on real hardware: the Freenove board is the first one it has been written for.
