# nano-gui spike

Throwaway code for `docs/working-notes/nano-gui-spike-briefing.md`. Lives on the `spike/nano-gui` branch
only; findings go back to main, this folder doesn't.

nano-gui itself is not copied in. Scripts fetch it at the pinned commit
`ff2aad51c3aa3d264f16efa324d935206171693a` (peterhinch/micropython-nano-gui, MIT).

## What's here

| File | What it is |
|---|---|
| `color_setup.py` | The module nano-gui insists on. Its `SSD` is our own `Surface`: a `FrameBuffer` over a `display_spi`-format buffer (gs4/gs2/mono), not a nano-gui driver. |
| `band.py` | A strip framebuffer that looks like the full screen (Q4). |
| `state_widgets.py` | Readout, bound text, bar, status LED, page dots and trend, each drawing unknown/known/stale (Q3). |
| `journal.py` | Stand-in for a `journal` node's storage: a clocked `array('f')` ring; `None` in becomes a gap. |
| `page.py` | The hero page from a rect table, as the layout compiler would emit it. |
| `band_test.py`, `place_test.py` | Banding and placement checks (Q4, Q1). |
| `bench_cyd.py` (+ `_gs2`, `_mono`) | On-board RAM and timing for the CYD (Q6, Q7). |
| `bench_pico_oled.py` | Small-GUI check: Pico W + 128x64 SSD1306 over I2C. |
| `host_bench.py`, `host_pico.py` | Run the two benches on the unix port with stand-in hardware; rebuild what the panel would show. |
| `fonts/` | DejaVu (stand-in font) converted by `font_to_py`, as `.mpy`. `make_fonts.sh` regenerates them. |

## On a board

Needs `mpremote` on the Mac and stock MicroPython on the board (1.20 or later).

```sh
cd pocs/nano-gui-spike
./copy_to_board.sh /dev/tty.usbserial-XXXX cyd
mpremote connect /dev/tty.usbserial-XXXX soft-reset run bench_cyd.py
mpremote connect /dev/tty.usbserial-XXXX soft-reset run bench_cyd_gs2.py
mpremote connect /dev/tty.usbserial-XXXX soft-reset run bench_cyd_mono.py
```

Each run prints RAM per stage and timings, and shows the page known, unknown, then stale for two seconds each.
Paste the output back. The page is drawn landscape (320x240); landscape MADCTL isn't confirmed on our CYD, so
if it shows mirrored or upside down, try the other values in `MADCTL_CANDIDATES`. The numbers are valid either way.

Pico W with an SSD1306 (I2C0, SDA GP4, SCL GP5 by default; edit the top of the script to match). Set
`WIFI_SSID`/`WIFI_PASS` there to measure with networking up:

```sh
./copy_to_board.sh /dev/tty.usbmodemXXXX pico
mpremote connect /dev/tty.usbmodemXXXX soft-reset run bench_pico_oled.py
```

`copy_to_board.sh` overwrites files of the same name on the board and deletes nothing.

## On the host

```sh
MICROPYTHON=/path/to/unix-port/micropython NANO_GUI=/path/to/nano-gui ./run_host.sh
```

Writes frames and a contact sheet to `out/`. Needs CPython with Pillow for the PNGs.
