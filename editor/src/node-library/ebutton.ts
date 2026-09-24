// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/ebutton.ts
//
// outstanding-items.md's "[P4] eswitch/ebutton nodes" item, 2026-09-08 --
// wraps EButton (v3/primitives/events.py, DRIVERS.md §4.1), eswitch.ts's
// sibling. See eswitch.ts's own header for the shared design decisions
// (topic-carries-event-identity single output, WaitAny for the "wait on
// several named Events, tell me which fired" multiplex, fixed-name pin
// dedup for the shared driver instance with a per-node-instance WaitAny)
// -- not re-explained here.
//
// Four possible firing events instead of ESwitch's two: press, release,
// long, double. `topic` is 'press'/'release'/'long'/'double';
// `payload` is the button's current debounced logical state (true =
// pressed, EButton.__call__()) at the moment the event fired -- for
// 'press' this is always true and for 'release' always false, but for
// 'long'/'double' it tells a downstream node whether the button is still
// held at the moment the event fired, matching what EButton itself reports
// via call syntax.
//
// suppress/sense/debounce/long-press/double-click are all real EButton
// constructor args / class attributes (DRIVERS.md §4.1/§4.1.1) exposed
// close to their upstream names and defaults, per this item's own
// "using his specs directly rather than re-deriving" framing -- not
// renamed or reduced to a smaller set.
//
// `pull` (none/up/down, default "none") is NOT one of EButton's own
// constructor args -- it configures the underlying machine.Pin itself, one
// layer below EButton. Added 2026-09-17, same real-hardware finding as
// eswitch.ts's own header: an EMF 2022 TiDAL badge's buttons (buttons.md)
// rely on the RP2040's *internal* pull-up for every button but one, which
// this node had no way to configure at all before now. Default "none"
// keeps every already-generated flow byte-for-byte unchanged.
//
// *** Class-attribute timing config: read this before touching the
// construction-order codegen below. *** EButton.debounce_ms/long_press_ms/
// double_click_ms are CLASS attributes, read via the class name (not
// `self.`) exactly once, inside `__init__`, to size that instance's own
// Delay_ms timers and debounce-poll interval -- there is no per-instance
// constructor arg for any of the three. This codegen works around that by
// setting the class attributes immediately before constructing THIS
// instance, so its own Delay_ms timers bake in the right values before the
// next ebutton node's own setup block (if any) changes the class
// attributes again for ITS instance. This is correct only because
// EButton.__init__ never re-reads the class attribute after construction
// -- see device-runtime/src/vendor/primitives_events/README.md's own
// section on this for the fuller trace and why it's worth being explicit
// about rather than left to be rediscovered while debugging a flow with
// more than one ebutton node.

import { CompileError } from "../compiler/errors.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

export const ebuttonNode: NodeDefinition = {
  type: "thingstudio/ebutton",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const pin = checkPin(ctx, "ebutton pin", node.properties.pin, "input", { pull: String(node.properties.pull ?? "none") !== "none" });
    const suppress = Boolean(node.properties.suppress ?? false);
    const senseMode = String(node.properties.senseMode ?? "auto");
    if (senseMode !== "auto" && senseMode !== "0" && senseMode !== "1") {
      throw new CompileError(`ebutton senseMode "${senseMode}" must be "auto", "0", or "1"`);
    }
    const debounceMs = Math.round(Number(node.properties.debounceMs ?? 50));
    if (!Number.isFinite(debounceMs) || debounceMs <= 0) {
      throw new CompileError(`ebutton debounceMs "${String(node.properties.debounceMs)}" must be a positive number`);
    }
    const longPressMs = Math.round(Number(node.properties.longPressMs ?? 1000));
    if (!Number.isFinite(longPressMs) || longPressMs <= 0) {
      throw new CompileError(`ebutton longPressMs "${String(node.properties.longPressMs)}" must be a positive number`);
    }
    const doubleClickMs = Math.round(Number(node.properties.doubleClickMs ?? 400));
    if (!Number.isFinite(doubleClickMs) || doubleClickMs <= 0) {
      throw new CompileError(`ebutton doubleClickMs "${String(node.properties.doubleClickMs)}" must be a positive number`);
    }
    if (doubleClickMs >= longPressMs) {
      // DRIVERS.md §4.2, class variables note: "The double click time must
      // be less than the long press time." Stated as a Pushbutton
      // constraint but applies identically to EButton -- both read the same
      // two class attributes the same way.
      throw new CompileError(`ebutton doubleClickMs (${doubleClickMs}) must be less than longPressMs (${longPressMs})`);
    }
    const pull = String(node.properties.pull ?? "none");
    if (pull !== "none" && pull !== "up" && pull !== "down") {
      throw new CompileError(`ebutton pull "${pull}" must be "none", "up", or "down"`);
    }
    const pullArg = pull === "up" ? ", machine.Pin.PULL_UP" : pull === "down" ? ", machine.Pin.PULL_DOWN" : "";

    const pinVar = `_ebutton_pin_${pin}`;
    const btnVar = `_ebutton_${pin}`;
    const waitVar = ctx.uniqueName("ebutton_wait");
    const senseArg = senseMode === "auto" ? "" : `, sense=${senseMode}`;

    const setupLines = [
      `${pinVar} = machine.Pin(${pin}, machine.Pin.IN${pullArg})`,
      `EButton.debounce_ms = ${debounceMs}`,
      `EButton.long_press_ms = ${longPressMs}`,
      `EButton.double_click_ms = ${doubleClickMs}`,
      `${btnVar} = EButton(${pinVar}, suppress=${suppress ? "True" : "False"}${senseArg})`,
    ];

    return {
      imports: ["import machine", "from events import EButton, WaitAny"],
      statements: [
        { key: `ebutton-${pin}`, code: setupLines.join("\n") },
        { key: waitVar, code: `${waitVar} = WaitAny([${btnVar}.press, ${btnVar}.release, ${btnVar}.long, ${btnVar}.double])` },
      ],
      waitStatement: `_trig = await ${waitVar}.wait()`,
      buildMsg: [
        `if _trig is ${btnVar}.press:`,
        `    _topic = 'press'`,
        `elif _trig is ${btnVar}.release:`,
        `    _topic = 'release'`,
        `elif _trig is ${btnVar}.long:`,
        `    _topic = 'long'`,
        `else:`,
        `    _topic = 'double'`,
        // Clears ONLY the Event that actually fired (`_trig`), not every
        // event WaitAny is watching. Real correctness fix, not a style
        // choice: EButton's own `_pf()` can set BOTH `press` and `double`
        // in the same synchronous call (a rapid second click, suppress
        // disabled -- press always fires, and dtim-still-running also
        // fires double). WaitAny.wait() only ever reports ONE winner per
        // call and cancels its other watcher tasks, but the LOSING
        // event's own `.set()` state is untouched by that cancellation --
        // clearing every event here (`${waitVar}.clear()`) would silently
        // discard that second, genuinely-real notification; clearing only
        // `_trig` leaves it set, so the very next `await ${waitVar}.wait()`
        // (a fresh WaitAny watcher task per call, events.py's own `wait()`)
        // picks it up immediately instead of losing it.
        `_trig.clear()`,
        `msg = {'payload': ${btnVar}(), 'topic': _topic}`,
      ].join("\n"),
    };
  },
};
