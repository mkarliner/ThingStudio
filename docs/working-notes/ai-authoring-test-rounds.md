# AI-authoring doc: test rounds

Protocol in `ai-authoring-doc-scoping.md`. Run 2026-10-10 by fresh subagents given only `docs/user-guide/` (without
`sensor-display.md`), the `test-flows/` examples (without the headliner flow) and the `thingstudio-compile` command; no
source. Each reported the checker runs it needed, the files it read and what the docs left it guessing. The flows
they wrote are in `test-flows/ai-authoring/` for hardware runs (Mike, on the board each names).

## Results

| Round | Task | Board | Passed first run | Notes |
| --- | --- | --- | --- | --- |
| 1 | Blink | LOLIN S2 Mini | yes | The doc's own blink example answered it: a weak test. |
| 1 | BME280 to MQTT | Freenove | yes | `mqtt-bme280-freenove.flow.json` |
| 1 | Temperature, big number + 30-minute trend | Freenove | yes | `display-trend-freenove.flow.json`; used gs4, not colour |
| 1 | Add a page and nav buttons to an existing flow | Freenove | yes | `orientation-test-plus-temp-page-freenove.flow.json` |
| 2 | Button held lights LED, publishes "pressed" | Pico W | yes | `door-button-pico-w.flow.json` |
| 2 | Temperature and humidity, colour, landscape | CYD | no: 2 failures | width overflow (digits48 side by side); `xstart`/`ystart` 0 refused with an orientation. `sensor-landscape-cyd.flow.json` |
| 2 | Touch toggle that follows a Tasmota plug, landscape | Freenove | yes | `lamp-toggle-freenove.flow.json` |
| 2 | Custom node, Celsius to Fahrenheit | none | n/a | no checker; files written and the Python body run on sample input |

| 3 | HTTP GET every minute, LED shows up/down | LOLIN S2 Mini | yes, 2nd run | first used `https://` (not supported). `http-health-led-lolin-s2-mini.flow.json` |
| 3 | BME280 and SSD1306 on one bus, text on the OLED | Pico 2 | yes | `bme280-oled-pico2.flow.json` |
| 3 | Two-page climate display, MQTT in, alarm modal | Freenove | yes, 5th run | modal layout format was undocumented. `climate-two-page-modal-freenove.flow.json` |
| 3 | Serve temperature over HTTP GET /temp | ESP32-S3 | yes | needed a cached reading (bme280 has no input). `http-get-temp-esp32s3.flow.json` |
| 3 | Add a fan toggle to an existing lamp flow | Freenove | yes | `lamp-add-fan-freenove.flow.json` |

## Round 3 changes

- `http_request`: no HTTPS, what it sends on any status, and what happens on failure or timeout, now in `http-request.md`
  and the authoring page.
- Modal layout (`screens.<id>.modals`), dismissal and timeout, in `gui.md` and the authoring page.
- OLED text recipe in `display-i2c.md`; the `addr` property is a number (catalog note added).
- Per-request sensor reads (cache with `flow.set`), MQTT payloads as text, imports in function nodes, `http_in` port.
- `-1` for `xstart`/`ystart` means no offset and is allowed with an orientation; usable size at 90/270.
- `function` outputs is `outputCount` in the file.
- Still unverified: that a `FrameBuffer`-based flow and `json` import in a function node work on a board.

## What the agents had to guess, and what changed

- Board ids: the doc gave one example. Now lists all ids. (Three agents guessed wrong first.)
- Landscape: the doc and `boards.md` gave two ways (orientation, raw rotation codes). `boards.md` and `display-spi.md` now
  point to orientation, and say the CYD needs `xstart`/`ystart` -1 with one.
- Property meanings (a navigate button's `target`, the journal's `steps`, the BME280 address as a decimal number): the
  catalog now carries a one-line note for 53 properties, with a test that the notes stay true to real properties.
- Which node for which job: a table added.
- GUI placement keys: a table added.
- `panes`, `paneOf`, the WiFi config being what network nodes use, int into bool: added.
- A stray internal remark in `mqtt-publish.md`, and `boards.md` still saying Freenove touch was unsupported: fixed.

## Not covered or still open

- The agents had the doc's examples, so the first-run pass rate flatters it. The CYD landscape task, the one that was not
  in the examples, is the one that failed. Round 3 used tasks nobody had written an example for: 5 of 5 passed, two needed a retry for undocumented behaviour (HTTPS, modal layout).
- Nothing here ran on a board. A flow that passes the check is not a flow that works; the board runs are Mike's.
- Not asked: the AI-authoring doc used with a non-Claude assistant.
- The checker can't check custom nodes; a loader check (`--check-node`) would close that.
