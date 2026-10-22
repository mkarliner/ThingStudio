# "Thingstudio firmware" tier -- a decision-ready note

Status: note, 2026-10-14. Input to the architecture review's concern 1 (built-in/custom node unification,
`outstanding-items/node-descriptor-unification.md`). Sources: `frozen-firmware-spike-briefing.md` (closed
2026-10-08), `learnings/micropython-device-runtime.md`, `decisions/flow-dependencies.md`.

## The question this answers

Should a custom "Thingstudio firmware" tier gate the node-descriptor work -- or anything else about nodes?

No. The two are independent, and the node work is editor-side only. The rest of this note says why, and what the
tier would be if it is built.

## What reaches a board (why node work is editor-side)

A Deploy puts three things on a board, and nothing else:

- the compiled flow (one `.mpy`; a custom node's `.node.py` text is spliced in at compile time);
- the libraries that flow imports, installed into `/lib` (`decisions/flow-dependencies.md`);
- the runtime, installed once and reused across deploys.

Node descriptors, palette rows, property-panel fields, the catalog and the docs all live in the editor. Unifying
built-in and custom node handling -- moving a built-in's descriptor to data, exposing its property fields, letting
a built-in be cloned into a package -- changes only editor files. It adds no bytes to a board and frees none.

The one device lever a node has is *what it imports*, and that is already scoped: a flow carries only the
libraries it imports, and nothing else. So a node work item stands or falls on editor concerns alone, and must
never wait on a firmware tier.

## What a firmware tier would contain (if built)

An optional, supported-boards-only image that freezes modules so they never sit in the heap:

- the runtime and listener (always);
- per board, the libraries its flows use most -- `mqtt_as`, the display drivers, the GUI library;
- the prebuilt fonts, which dominate the saving.

The spike measured roughly **75% less heap** across a sample of those modules (over the `.mpy` route already used
today); fonts saved almost all of theirs, their glyph `bytes` staying in flash. Frozen code also needs no large
contiguous block at import time, which is the failure the CYD hit.

Kept updateable without a reflash: build with `/lib` before `.frozen` on `sys.path`, report the frozen modules and
their hashes in `HELLO`, and have Deploy skip a library the firmware already carries at the same hash. A pushed
copy then overrides a frozen one, so a runtime or library change is a push, not a rebuild. Build once rather than
per change: ROMFS (`mpremote romfs deploy`) gives the same RAM benefit with files pushed into a read-only flash
partition -- but it is off in stock builds, so it still needs one image per board, built once.

## The decision

Worth building, **post-MVP**, for the boards where it pays: the classic ESP32 without PSRAM, the C3 and the Pico
(fonts and `mqtt_as` dominate there). Not for PSRAM boards -- the Freenove ESP32-S3 shows 7-8 MB free with the
right firmware. The stock install stays the default route. A cheaper alternative to weigh first, not built: keep
font glyph data in a flash file read on demand instead of importing it.

This is a device-packaging decision. It does not gate the node-descriptor work, and nothing about nodes gates it.

**Superseded in part, 2026-10-22:** after the CYD gate failure it is MVP work, not post-MVP, and it is
one **generic classic-ESP32** image (CYD first verified) rather than a per-class set -- see
`../decisions/classic-esp32-firmware.md` and `../classic-esp32-firmware-briefing.md`. The C3 and Pico
are out of the first image. The "report the frozen modules and their hashes in `HELLO`" idea above
was dropped in favour of a shipped `/lib/_deps.json`; the reasoning is in that decision.
