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
  in the examples, is the one that failed. Round 3 should use tasks nobody has written an example for.
- Nothing here ran on a board. A flow that passes the check is not a flow that works; the board runs are Mike's.
- Not asked: the AI-authoring doc used with a non-Claude assistant.
- The checker can't check custom nodes; a loader check (`--check-node`) would close that.
