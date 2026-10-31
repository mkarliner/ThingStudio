# Briefing: GUI button rework -- own output, modes, touch panel as a config node

Status: brief, 2026-10-09. Written after the review of the 2026-10-07/08 GUI and touch work
(`gui-touch-spike-review-and-mvp-briefing.md`) and Mike's decisions the same day.

**Who this is for:** one implementation session. Do this piece of work and stop. The last GUI sessions ran on
into the next item without pausing, and the review had to untangle branches and unrecorded decisions
afterwards. When the "Done when" list below is met, hand back to Mike. Don't start the history graph, the
seven-segment font or anything else from the launch list.

Read first: `decisions/gui-layout.md` (the 2026-10-08 and 2026-10-09 entries), `gui-layout-widget-system-scoping.md`
("Controlled and uncontrolled widgets", "Unknown state", "Touch dispatch"), `touch-input-briefing.md`,
`node-definition-model.md`.

## Why

The headliner toggles a Tasmota plug or WLED strip from an on-screen button
(`launch-mvp-scope-briefing.md`). As built, a button has no output: its presses come out of a separate
`gui_touch` node with the button's name as the topic, and `touch_i2c` must be wired into `gui_touch`. Mike's
call (2026-10-09): a button "floating in the air doesn't look right"; GUI-only plumbing shouldn't be on the
canvas; buttons get their own output wire; `touch_i2c` is for non-GUI uses.

## What exists today (main, `a7de5cc` plus the 2026-10-09 decisions commit)

- `device-runtime/src/vendor/thingstudio_gui/gui.py`: `GUI.touch(surface, kind, x, y)` hit-tests touchable
  widgets on the visible page or modal, holds the pressed one (`Surface.held`), keeps a press drawn for at
  least `PRESS_MIN_MS` (150 ms) and returns `(widget_id, "down"|"up")`. States: `UNKNOWN`, `KNOWN`, `STALE`;
  `PRESSED` (3) is passed to draw routines only. No `PENDING`, no `event()` call yet.
- `.../thingstudio_gui/button.py` (`tsgui_button`): draws an outlined box with centred text, inverted while
  pressed. A value replaces the static text.
- `editor/src/node-library/gui.ts`: widgets are `kind: "sink"` built by `widgetNode()` (input calls
  `_gui.set_value`). `guiButtonNode` adds `allowUnwired: true`. `guiTouchNode` is a transform taking
  `touch_i2c`'s `{x, y}` down/up messages. `guiModalNode` is a sink, so modals have **no close-reason output**
  either (the handoff's item 5).
- `editor/src/compiler/node-definition.ts`: `NodeKind` is `"source" | "transform" | "sink"`. A source has no
  input; an event source (`codegenEventSource`) waits on an event. No node today has an input and an
  independent event output.
- `editor/src/compiler/compile.ts`: unreachable nodes are an error unless `allowUnwired`.
- `editor/src/node-library/touch-i2c.ts`: polls an FT6336U (`vendor/ft6336u/`) on an I2C bus config; sends
  `down`/`up` with `{x, y}`; an unreachable panel mid-touch still sends its `up`; reports `NODE_STATUS`.
- Config node pattern: `editor/src/app/rete/config-types.ts` (`thingstudio/config/i2c-bus` is the closest
  model), resolved in codegen as `i2c-shared.ts`'s `resolveI2cBus` does.

## The work

### 1. Compiler: a node with an input and an event output -- scope it, agree it with Mike, then build

The button needs an input (what it shows) and an output that fires on a touch, not in reply to its input.
The modal needs the same shape for its close reason. This is the "a widget is both sink and source" question
from 2026-09-18, still open. Recommended: let a node define both `codegenSink` (its input) and
`codegenEventSource` (its output), compiled as two coroutines sharing the node's setup. Check against
`node-definition-model.md` and `compile.ts` first; write the design as a short section in this brief or a
scoping note, and get Mike's OK before changing the compiler. It's a compiler change every later widget will
lean on.

### 2. Touch panel as a config node

- New config type, e.g. `thingstudio/config/touch-panel`: controller (`ft6336u` for now, room for
  GT911/CST820), I2C bus (a reference to the I2C bus config), address, panel width/height, swap XY,
  flip X/Y, reset pin, poll interval.
- The gui screen node names one in its properties. The GUI polls it itself (inside the subsystem's loop or
  the screen's coroutine), turning down/up into presses; no wire.
- `touch_i2c` references the same config for raw `{x, y}` use.
- One panel used both by a gui screen and by a `touch_i2c` node: a compile error naming both nodes (MVP).
- Panel faults: report on the gui screen node's status (`NODE_STATUS`), as `touch_i2c` does today. A lost
  panel mid-press releases the button (no stuck press).
- Migration: test flows only (`test-flows/gui-touch-freenove-s3-4in.flow.json`); no users yet. Remove
  `gui_touch` from the registry, palette and docs.

### 3. Button: output, modes, controlled state

- **Output:** `{'topic': <button name>, 'payload': <value>}`. Fires on release inside the button by default;
  a property allows firing on press. A release outside the button sends nothing.
- **Modes:**
  - *momentary*: sends its configured value.
  - *toggle*: holds on/off, shows its on/off text, sends the opposite of its current state. On/off
    payloads are properties (default `ON`/`OFF`, which is what Tasmota sends and accepts).
  - *navigate*: `next`, `prev`, `back`, `home` or a page name, acting on its own screen; no output needed.
- **Input (what it shows):** unwired, the button keeps its own state (uncontrolled; a toggle starts at its
  initial-state property). Wired, the flow owns the state (controlled): it starts **unknown** (`--`), a tap
  shows **pending** at the requested state until the input confirms it. No confirmation within a timeout:
  revert to the last known state and show the failure visibly (not silently). Add `PENDING` to `gui.py` and a
  hollow/outlined pending look to `button.py`, readable in mono.
- **Unwired rules:** only navigate buttons may be fully unwired. A momentary or toggle button with nothing on
  its output: compile warning. Narrow `allowUnwired` to match (it is set on the node type today; it may need
  to depend on the mode).
- Button `event()` on the board: one awaitable per touchable widget, as the scoping doc's sketch shows
  (`await gui.event('button_3')`), fed by the GUI's own touch handling.

### 4. Modal close reason (only if item 1 makes it a small step)

The same two-faced shape gives `gui_modal` its output: `{'topic': <modal name>, 'payload': 'ack' | 'timeout' |
'closed'}`. `GUI.on_modal_close` already exists. If it's more than wiring, list it in `outstanding-items.md`
and leave it.

### 5. Docs and flows

- User guide: `nodes/gui.md` (button, screen's touch property; remove gui touch), `nodes/touch-i2c.md` (raw use,
  the shared config), the config node where config nodes are documented. Node-RED register, short.
- Test flows: update the touch flow; add a toggle wired as the headliner will be: `mqtt_subscribe` (plug state)
  -> toggle input, toggle output -> `mqtt_publish` (plug command). A navigate button on the same page.
- `decisions/gui-layout.md`: record what was decided in item 1 and any open question Mike settles.
  `outstanding-items.md`: tick off the button rework item.

## Questions to settle with Mike early (ask, don't guess)

1. The compiler design in item 1.
2. Toggle payloads: `ON`/`OFF` default, or `true`/`false`?
3. Pending timeout default (suggest 3 s) and what "visible failure" looks like (suggest a brief error state,
   then the last known value).
4. Where a toggle's on/off text comes from when its input is wired: the incoming payload as is, or mapped
   through the on/off properties?

## Not in this session

The palette recolour and relabel (`decisions/gui-layout.md`, 2026-10-09; its own outstanding item), the CYD
gate (a hardware session with Mike), hardware checks owed from the review (landscape touch, press highlight),
the history graph, fonts, the GUI view, the screen-to-display wire question.

## Working rules

- Branch from `main`, named for this work (e.g. `gui-buttons`). Commit points: after item 1, after items 2-3,
  after docs. Prompt Mike at each; he runs `git add`/`git commit` himself. Give commands without `#` comments:
  his zsh treats them as arguments.
- Read-only git from the sandbox: `GIT_OPTIONAL_LOCKS=0` so it doesn't leave `.git/index.lock`.
- No `npm`, `vitest`, `tsc` or `make` on the shared mount. Copy the tree (without `node_modules`) into the cloud
  workspace and run there, as `CLAUDE.md` says. Delete stray `.js` in `editor/src`/`editor/test` first.
- `device-runtime` changes: run the real MicroPython unix-port suite and `test_listener_integration.py`.
- The `tsgui_*` modules ship as flow dependencies with the flow; evaluate the runtime version rule in
  `CLAUDE.md` anyway if `runtime.py`/`listener.py` change.
- Known: `editor/test/node-eswitch.test.ts`'s close-then-open test fails in the cloud workspace on `main` too
  (timing). Not yours to fix here; don't count it as a regression.
- Don't state a hardware result you haven't seen. Mike checks the toggle on the FNK0104S.

## Done when

- Item 1 agreed with Mike and built, with compiler tests.
- Buttons have outputs and the three modes; the controlled toggle shows unknown, pending and confirmed; the
  pending timeout reverts visibly. Tests for each in `test_gui.py`/`test_gui_widgets.py` and the editor.
- The touch panel is a config node; the gui screen polls it; `gui_touch` is gone; sharing one panel between a
  screen and `touch_i2c` is a compile error.
- `tsc` clean; editor tests pass apart from the known eswitch timing test; MicroPython suites pass.
- Docs and test flows updated; decisions and outstanding items updated.
- Mike has the commit commands and a short list of what to check on the FNK0104S.

## Mike's answers (2026-10-09) and the item 1 design

**Answers.** (1) Compiler design agreed in principle; the section below is the written form, for his OK before
building. (2) Toggle payloads default to `true`/`false`, not `ON`/`OFF`: on-screen buttons aren't Tasmota's
physical buttons and can stand for something else. Both are properties. (3) Pending timeout: at least 5 s
(default 5 s, a property). (4) A wired toggle maps the incoming payload through its on/off properties; anything
matching neither shows unknown.

### Item 1 design: a node with an input face and an event-output face

**Rule.** A node of kind `sink` (sinks only: a transform's output wire already means what it returned) may also
define `codegenEventSource`. That hook is its *output face*: compiled as an ordinary event-source coroutine,
exactly as `gui_screen`'s and `interrupt`'s are today. The node's `kind` keeps describing its input face, so
`emit()` and everything that reads `kind` are unchanged. The existing "a source defines exactly one of the two
hooks" rule stays for `kind: "source"`.

**Changes, all in `compile.ts` / `node-definition.ts`:**

1. *Roots.* The list of coroutine roots becomes the `source`-kind nodes plus every non-source node that defines
   `codegenEventSource`. The existing event-source branch compiles the output face unchanged. The spawn call's
   fallback node id is the node's own id, so a fault in the output face is attributed to it.
2. *Checks.* "Sink has an outgoing connection" is skipped for a sink with an output face. "Source has an incoming
   connection" still applies to `kind: "source"` only.
3. *Cycles and reachability.* A dual node reached as a link target is marked reachable and **not descended into**:
   its input face is terminal, its output face runs in its own coroutine. Walked as a root it descends normally.
   So `button output -> mqtt_publish`, and `mqtt_subscribe -> button input` wired back round to the same button,
   is not a cycle. It is two coroutines meeting at the widget's state, which is the headliner's shape. A dual
   node is always a root, so it is never "disconnected", and `allowUnwired` is no longer needed for the button.
4. *Context.* Add `ctx.isOutputWired?(nodeId)` and `ctx.isInputWired?(nodeId)`, optional like `findNodesOfType`,
   so the button's codegen can warn about a momentary or toggle button with nothing on its output (the brief's
   rule) and pick controlled or uncontrolled by whether its input is wired.
5. *Shared setup.* The two hooks run separately. Anything they share lives in the device-side GUI object, keyed
   by node id (`_gui.event(id)` and `_gui.set_value(id, ...)`), and in setup statements already deduplicated by
   `key` (`coreBlock`). No shared Python names are needed between the two hooks.

**Unchanged:** the single-output transform contract, fan-out cloning, fault boundaries, line ranges (the output
face has none, like any source), every existing node's generated Python byte for byte.

**Tests (`compiler.general.test.ts` or a new file):** dual node compiles to a sink function plus a spawned
coroutine; its output fans out and reaches downstream nodes; a sink without an output face still rejects an
outgoing wire; output wired back to the same node's input compiles; a dual node with nothing wired compiles; a
`kind: "source"` node with an incoming wire still errors.

**Not a runtime change:** the compiled Python uses only `runtime.spawn` and `asyncio` as now, so the
`_RUNTIME_VERSION` rule isn't triggered by item 1. The `gui.event()` device-side call (item 3) lives in a
`tsgui_*` flow dependency.
