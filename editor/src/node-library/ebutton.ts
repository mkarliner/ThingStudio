// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/ebutton.ts
//
// outstanding-items.md's "[P4] eswitch/ebutton nodes" item, 2026-09-08 --
// wraps EButton (v3/primitives/events.py, DRIVERS.md §4.1), eswitch.ts's
// sibling. See eswitch.ts's own header for the shared design decisions
// (single output, payload = the event name for ebutton / the state for
// eswitch, WaitAny for the "wait on
// several named Events, tell me which fired" multiplex, fixed-name pin
// dedup for the shared driver instance with a per-node-instance WaitAny)
// -- not re-explained here.
//
// Four possible firing events instead of ESwitch's two: press, release,
// long, double. The event name IS the payload ('press'/'release'/'long'/
// 'double') and `topic` is '' -- moved into `payload` 2026-10-11, matching
// Node-RED's "payload is the default property most nodes work with" (so
// `debug` shows the event) and this project's own "payload is the node's
// main value" convention (docs/node-conventions.md). The output port is
// therefore typed `string`, not `bool`; a consumer that wants the held state
// tracks it from the events.
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

import { claimResource, pinVarSegment, sharedPin, type Pull } from "./hardware-shared.js";
import { CompileError } from "../compiler/errors.js";
import { pinLabel } from "../definitions/definitions.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

export const ebuttonNode: NodeDefinition = {
  type: "thingstudio/ebutton",
  kind: "source",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "ebutton",
  label: "ebutton",
  group: "hardware",
  priority: 12,
  color: "#a6633f",
  bgcolor: "#4a2e1f",
  icon: "⏺",
  width: 104,
  description:
    "Sends a message on each press, release, long press and double click. msg.payload is \"press\", \"release\", " +
    "\"long\" or \"double\". Set pull to use the pin's own pull resistor, or leave it at none if the button has " +
    "one. Double click must be shorter than long press.",
  ports: {
    outputs: [{ name: "msg", type: "string" }],
  },
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 5 },
    {
      name: "pull",
      label: "pull",
      kind: "select",
      default: "none",
      options: [
        { value: "none", label: "none -- external pull or self-pulling button (default)" },
        { value: "up", label: "up -- enable the pin's internal pull-up" },
        { value: "down", label: "down -- enable the pin's internal pull-down" },
      ],
    },
    {
      name: "senseMode",
      label: "sense",
      kind: "select",
      default: "auto",
      options: [
        { value: "auto", label: "auto -- assume not pressed at boot (default)" },
        { value: "0", label: "0 -- unpressed reads as gnd" },
        { value: "1", label: "1 -- unpressed reads as 3V3" },
      ],
    },
    { name: "suppress", label: "suppress (delay/suppress release in favor of double/long)", kind: "boolean", default: false },
    { name: "debounceMs", label: "debounce (ms)", kind: "number", default: 50, min: 1 },
    { name: "longPressMs", label: "long press (ms)", kind: "number", default: 1000, min: 1 },
    { name: "doubleClickMs", label: "double click (ms)", kind: "number", default: 400, min: 1 },
  ],
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
    // The pin and the EButton on it are keyed singletons (hardware-shared.ts, decisions/hardware-singletons.md):
    // a second ebutton on this pin with different settings is a compile error, not silently the first's.
    const shared = sharedPin(ctx, node, pin, "in", pull as Pull);
    claimResource(
      ctx,
      `${pinLabel(pin)} ebutton`,
      `sense ${senseMode}, suppress ${suppress ? "on" : "off"}, debounce ${debounceMs} ms, long press ${longPressMs} ms, double click ${doubleClickMs} ms`,
      node,
    );
    const pinVar = shared.varName;
    const btnVar = `_ebutton_${pinVarSegment(pin)}`;
    const waitVar = ctx.uniqueName("ebutton_wait");
    const senseArg = senseMode === "auto" ? "" : `, sense=${senseMode}`;

    const setupLines = [
      `EButton.debounce_ms = ${debounceMs}`,
      `EButton.long_press_ms = ${longPressMs}`,
      `EButton.double_click_ms = ${doubleClickMs}`,
      `${btnVar} = EButton(${pinVar}, suppress=${suppress ? "True" : "False"}${senseArg})`,
    ];

    return {
      imports: ["import machine", "from events import EButton, WaitAny"],
      statements: [
        shared.statement,
        { key: `ebutton-${pin}`, code: setupLines.join("\n") },
        { key: waitVar, code: `${waitVar} = WaitAny([${btnVar}.press, ${btnVar}.release, ${btnVar}.long, ${btnVar}.double])` },
      ],
      waitStatement: `_trig = await ${waitVar}.wait()`,
      buildMsg: [
        `if _trig is ${btnVar}.press:`,
        `    _event = 'press'`,
        `elif _trig is ${btnVar}.release:`,
        `    _event = 'release'`,
        `elif _trig is ${btnVar}.long:`,
        `    _event = 'long'`,
        `else:`,
        `    _event = 'double'`,
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
        `msg = {'payload': _event, 'topic': ''}`,
      ].join("\n"),
    };
  },
};
