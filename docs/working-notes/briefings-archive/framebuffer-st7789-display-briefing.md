# Briefing: framebuffer / ST7789 display node — scoping, not started

For the next chat. Read `CLAUDE.md` in full first, as always. **Repo-state caveat, unusual for this
doc type:** this was written from a cloud-session clone (Mike's mac mini is down, he's working from a
different machine for now — see `decisions/node-authoring.md`'s 2026-09-17 entries). That clone's `git
log` doesn't reflect Mike's own subsequent commits/pushes on his `eswitch-ebutton` branch, so there's no
trustworthy commit SHA to cite here the way every prior briefing does. Treat this as a starting point,
not a synced snapshot — check `git log`/`git branch` yourself before assuming anything below about repo
state.

## Where things stand

`thingstudio/eswitch`/`thingstudio/ebutton` just landed and got a real-hardware pass on an EMF 2022
TiDAL badge (ESP32-S3, stock MicroPython) — `outstanding-items.md`'s eswitch/ebutton entry (now
Resolved) and `decisions/node-authoring.md`'s 2026-09-17 entries have the full story, including the new
`pull` property that real hardware forced. Mike wants to drive the same badge's screen next — a new node
type, not yet started, not yet even fully scoped. This doc is that scoping pass.

## Hardware facts (confirmed via `emfcamp/tidal-docs`/`emfcamp/TiDAL-Firmware`)

- Controller: **ST7789**, per `tidal-docs/boarddescription.md` ("ST7789 controller").
- Panel: 135×240, 24-bit color, portrait orientation.
- Interface: SPI (implied by the chip; `tidal-docs` didn't spell out the specific SPI bus pins on the
  page fetched this session — see "Open questions" below).
- Two pins already confirmed from `TiDAL-Firmware/gpio.md`: LCD power enable (`Pin(39, Pin.OUT)`) and
  backlight enable (`Pin(0, Pin.OUT)`), independent of each other — "the backlight can be enabled
  without powering the LCD module on."
- **Not yet confirmed:** the panel's own SPI bus assignment (MOSI/SCK), and its CS/DC/RST pins. Fetching
  `TiDAL-Firmware`'s own display driver source directly failed this session (`github.com/.../tree/...`
  is blocked by `robots.txt` for this session's fetch tool) — try `raw.githubusercontent.com` file paths
  directly next time, or just ask Mike to grep his own board notes/schematic.

## Recommended architecture: two-layer split, not a from-scratch driver

Same "wrap an existing, well-tested driver rather than re-derive" principle `eswitch`/`ebutton` already
established for Peter Hinch's primitives. Two layers, not one:

1. **`framebuf.FrameBuffer`** — a MicroPython **built-in** module, already on every board, zero
   vendoring needed. This is the in-RAM drawing surface (pixel/line/rect/text/blit into a plain
   `bytearray`) — the "framebuffer" half of this doc's title.
2. **A vendored ST7789 push driver** — the "video controller" half: takes a rendered buffer and blits it
   to the physical panel over SPI. Two real candidates, checked this session:
   - **[devbis/st7789py_mpy](https://github.com/devbis/st7789py_mpy)** — pure Python, MIT license,
     works on stock MicroPython with no firmware rebuild, explicitly supports 135×240 (this exact
     panel). Doesn't wrap `framebuf` itself (own pixel/text primitives), but that's fine — a node can
     still accept a pre-rendered `framebuf`-built buffer and blit it directly, or call this driver's own
     primitives instead. **Candidate to vendor.**
   - **[russhughes/st7789_mpy](https://github.com/russhughes/st7789_mpy)** — faster, but a **native C
     module requiring a custom-compiled/frozen MicroPython firmware build**. Confirmed this session,
     not assumed: its own README says "written in C" with CMake build instructions and prebuilt
     firmware images. This is a hard incompatibility with this project's whole deployment model (stock
     MicroPython + `mpremote cp` of plain `.py` files onto an already-flashed board, no custom firmware
     builds anywhere in the pipeline) — **do not use this one**, regardless of speed, unless that
     deployment model itself is being reconsidered (it isn't, as far as this doc knows).

## Relationship to already-tracked items — don't re-derive, don't conflate

- **`outstanding-items.md`'s "[P4] SSD1306 display node"** — a different, still-unscoped item
  (monochrome OLED, almost certainly I2C not SPI, different driver family entirely). Open question for
  next session: one shared "display" node abstraction across chips, or two independent node types? Given
  this project's own no-premature-generalization convention, the recommendation is **keep them
  separate** until a second real chip actually exists and a shared shape becomes obvious — same reasoning
  `eswitch`/`ebutton` used to defer AADC rather than guess at a shared driver-wrapper abstraction
  up front.
- **`outstanding-items.md`'s "[POST-MVP] Templating UI nodes for displays"** — stays exactly where it
  is, POST-MVP, untouched. This task is scoped to "push an already-rendered frame to the panel," not
  layout/drawing tooling — same kind of scope-narrowing call the eswitch/ebutton single-output-port
  decision made (confirm with Mike via `AskUserQuestion` before building, don't just assume).

## Wire-type note — no compiler work needed here

`bytes` is already one of the six fixed payload types (design doc §6, `editor/src/app/rete/sockets.ts`),
with a real working precedent: `udp_receive`'s payload is already `bytes`. A display sink node's input
port can just be typed `bytes` — zero new wire-type-system work required, confirmed by reading
`sockets.ts` this session rather than assumed.

## Proposed node shape — a starting point, confirm scope with Mike before building

Not a final decision. Suggested for discussion at the start of next session, `AskUserQuestion`-gated the
same way eswitch/ebutton's own scope was:

A sink node, `thingstudio/display_st7789` (or similar), one input port typed `bytes` — `msg.payload` is
an already-rendered frame (built upstream, e.g. by a `function` node using `framebuf.FrameBuffer`
directly), pushed to the panel on every message received. Properties: SPI bus id, CS/DC/RST pins (once
confirmed), resolution/rotation. This mirrors `gpio_out`/`pwm_out`'s existing minimal-sink precedent —
no new codegen machinery for drawing primitives, that's exactly what the deferred "templating UI" item
above is for.

## Open questions for next session (not resolved here)

- Exact SPI pin assignments for the TiDAL panel (see "Hardware facts" above).
- Whether `st7789py_mpy`'s "no CS pin" behavior matches TiDAL's actual wiring, or needs a documented
  local patch (same vendoring-with-patches convention as `primitives_events/README.md`) if TiDAL does
  use a real CS line.
- Confirm `st7789py_mpy`'s exact upstream commit SHA + SHA-256 hashes before vendoring — this session
  only read its README via a fetch tool, the same "verify by independent clone diff, not by trusting one
  fetch" bar `primitives_events/README.md` sets should still apply.
- Whether pymock needs a new SPI fixture for off-device testing (nothing in `editor/test/fixtures/
  pymock/` mocks `machine.SPI` today — checked this session, confirmed absent) — likely yes, scoped
  narrowly to whatever this driver actually calls.

## Conventions to keep following (all established, don't relitigate)

- Vendor, don't re-derive — `device-runtime/src/vendor/primitives_events/README.md` is the template:
  pinned commit SHA, before/after SHA-256 hashes, "why vendored," local patches section.
- `docs/third-party-licenses.md` gets a new row in the same change as vendoring lands.
- Off-device test first (pymock, extended as needed), then a real-hardware pass — non-negotiable for a
  genuinely new hardware node type, same bar the validation plan sets for I2C/sensor/network nodes.
- Full canvas wiring from day one (registry, Rete class, palette entry, property panel, flow-file
  verifier) — eswitch/ebutton's own precedent, not registry-only-then-retrofit.
- User-guide page, same "concise, not exhaustive" style as `docs/user-guide/nodes/ebutton.md`.

## Not in scope for this chat

- Resolving the SSD1306 item — stays open, separate, untouched.
- The templating/layout UI system — stays POST-MVP, untouched.
- A generic multi-chip "video controller" abstraction (ILI9341, GC9A01, etc.) — chip-specific for now,
  generalize later only if a second real chip actually shows up, matching eswitch/ebutton's own
  scope-narrowing precedent.

## Git

Standing note, but flagged as possibly stale for how Mike is actually working right now: `CLAUDE.md`'s
"Git writes from the agent sandbox" section assumes a live device-bridge mount shared with Mike's Mac —
that's not today's setup (mac mini down, Mike working a normal `git branch`/`git apply`/`git commit`
workflow on his own machine against a cloud-session-generated patch). Worth a quick check next session
on whether that CLAUDE.md section needs a caveat for "when the repo isn't a shared live mount" — not
done here, just flagged.
