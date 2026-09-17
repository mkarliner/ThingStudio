// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/eswitch.ts
//
// outstanding-items.md's "[P4] eswitch/ebutton nodes (Peter Hinch's asyncio
// drivers)" item, 2026-09-08 -- wraps his ESwitch class (v3/primitives/
// events.py, DRIVERS.md §3.1) rather than re-deriving debounce from
// scratch, resolving design doc §11's open "whether to adopt
// micropython-async" question for switches/buttons specifically (ADC/
// encoders still open -- outstanding-items.md's own follow-up note).
// Vendoring detail, SHA-256s, and the two local import-flattening patches:
// device-runtime/src/vendor/primitives_events/README.md.
//
// Debounced digital-input source, same "event-source" codegen pattern as
// interrupt.ts, but polling-based (ESwitch's own `_poll` coroutine,
// asyncio.sleep_ms(debounce_ms)) rather than hard-IRQ-driven -- a
// deliberate difference from interrupt.ts, not an oversight: ESwitch has no
// IRQ path at all upstream, and re-deriving one would be exactly the
// "re-derive instead of using his specs directly" the outstanding item
// explicitly says not to do. Use interrupt.ts instead when hard-IRQ
// wake-latency actually matters for a given pin; use eswitch when it
// doesn't and the simpler polling driver (plus its double/long-press
// sibling, ebutton.ts) is the better fit.
//
// One output port carries BOTH of ESwitch's events (open and close) --
// Mike's own call, 2026-09-17, over extending EventSourceCodegenResult for
// multi-output sources (no existing precedent; TransformCodegenResult's
// multi-output is transform-only, node-definition.ts's own `outputCount`
// comment). `topic` already exists in this project's msg envelope
// specifically as "a routing/identification string" (CLAUDE.md) -- 'close'
// or 'open' is exactly that, not a repurposing. `payload` carries the same
// state as a bool (true = closed), so a downstream node that only cares
// about current state can read `payload` and ignore `topic` entirely.
//
// Waiting on "either of two named Events, tell me which fired" is exactly
// what the vendored `WaitAny` class does (events.py) -- used here instead
// of two separate coroutines racing each other or a hand-rolled
// poll-and-compare, for the same "don't re-derive a primitive that already
// exists and is small enough to audit in full" reasoning as
// threadsafe_event's own vendoring.
//
// Pin claim key/naming follows gpio-out.ts/interrupt.ts's own fixed-name
// convention (NOT ctx.uniqueName) for the underlying Pin+ESwitch pair, so
// two eswitch nodes on the same pin dedup onto one shared driver instance
// (mergeSetup's documented first-writer-wins) rather than each getting an
// independently-polling ESwitch on the same physical pin. The per-node
// WaitAny wrapper is NOT deduped, though (its own always-unique statement
// key below) -- two coroutines both calling .wait() on the very SAME
// WaitAny instance would race on that instance's own internal `evt`/
// `trig_event` bookkeeping (events.py's WaitAny.wait()), which is a real
// correctness bug, not just wasted work; giving each node instance its own
// WaitAny wrapping the (possibly shared) underlying Events avoids it --
// multiple independent waiters on the same plain asyncio.Event is
// ordinary, supported asyncio, unlike two waiters sharing one WaitAny.
//
// No internal pull configured by default (matching interrupt.ts's own
// convention exactly, and this node's own original 2026-09-08 design) --
// ESwitch's `lopen` property already captures "which level means open,"
// independent of whether the pull is internal or external, so there was no
// correctness reason to diverge from the established project convention.
// A `pull` property (none/up/down, default "none") was added 2026-09-17,
// prompted by real-hardware testing on an EMF 2022 TiDAL badge: its own
// buttons.md documents every button except one relying on the RP2040's
// *internal* pull-up (`Pin.PULL_UP`), not an external resistor or a
// pull built into the switch/button module itself -- the "wire an
// external pull resistor" escape hatch this file's header used to point
// to doesn't cover that case at all. Defaulting to "none" keeps every
// already-generated flow's behavior byte-for-byte unchanged; this is
// purely additive, not a breaking change to the node's own contract.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

export const eswitchNode: NodeDefinition = {
  type: "thingstudio/eswitch",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const pin = Math.round(Number(node.properties.pin));
    if (!Number.isFinite(pin) || pin < 0 || pin > 39) {
      throw new CompileError(`eswitch pin ${String(node.properties.pin)} is out of range (0-39)`);
    }
    const lopen = Math.round(Number(node.properties.lopen ?? 1));
    if (lopen !== 0 && lopen !== 1) {
      throw new CompileError(`eswitch lopen "${String(node.properties.lopen)}" must be 0 or 1`);
    }
    const debounceMs = Math.round(Number(node.properties.debounceMs ?? 50));
    if (!Number.isFinite(debounceMs) || debounceMs <= 0) {
      throw new CompileError(`eswitch debounceMs "${String(node.properties.debounceMs)}" must be a positive number`);
    }
    const pull = String(node.properties.pull ?? "none");
    if (pull !== "none" && pull !== "up" && pull !== "down") {
      throw new CompileError(`eswitch pull "${pull}" must be "none", "up", or "down"`);
    }
    const pullArg = pull === "up" ? ", machine.Pin.PULL_UP" : pull === "down" ? ", machine.Pin.PULL_DOWN" : "";

    // Fixed, pin-derived names for the shared Pin+ESwitch pair -- see this
    // file's header for why (interrupt.ts's own header gives the fuller
    // version of the same reasoning). The WaitAny wrapper below is
    // deliberately NOT fixed-name'd -- its statement key is `ctx.uniqueName`
    // itself, guaranteeing it's never deduped even when the driver it wraps is.
    //
    // ESwitch.debounce_ms is a CLASS attribute (events.py), read once
    // inside __init__ (`asyncio.create_task(self._poll(ESwitch.debounce_ms))`)
    // -- same construction-order technique ebutton.ts's own header explains
    // in full for EButton's three class attributes, applied here to
    // ESwitch's one: set the class attribute immediately before
    // constructing THIS instance, since __init__ never re-reads it later.
    const pinVar = `_eswitch_pin_${pin}`;
    const esVar = `_eswitch_${pin}`;
    const waitVar = ctx.uniqueName("eswitch_wait");

    return {
      imports: ["import machine", "from events import ESwitch, WaitAny"],
      statements: [
        {
          key: `eswitch-${pin}`,
          code: [
            `${pinVar} = machine.Pin(${pin}, machine.Pin.IN${pullArg})`,
            `ESwitch.debounce_ms = ${debounceMs}`,
            `${esVar} = ESwitch(${pinVar}, lopen=${lopen})`,
          ].join("\n"),
        },
        { key: waitVar, code: `${waitVar} = WaitAny([${esVar}.close, ${esVar}.open])` },
      ],
      waitStatement: `_trig = await ${waitVar}.wait()`,
      // Clears ONLY the specific Event that fired (`_trig.clear()`), not
      // every event WaitAny is watching (`${waitVar}.clear()` would do
      // that) -- see ebutton.ts's header for why that distinction is a
      // real correctness fix, not a style choice, even though ESwitch's
      // own open/close pair can never actually fire simultaneously the way
      // EButton's press/double can.
      buildMsg: [`_is_close = _trig is ${esVar}.close`, `_trig.clear()`, `msg = {'payload': _is_close, 'topic': 'close' if _is_close else 'open'}`].join("\n"),
    };
  },
};
