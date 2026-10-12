// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/interrupt.ts
//
// Tier 1 item 5's real GPIO input (mvp-feature-priorities.md, item 5 /
// design doc §6's 2026-08-17 addendum) -- replaces gpio-in.ts's poll loop.
// Genuinely event-driven: machine.Pin.irq() fires in hard-IRQ context,
// which is bridged into uasyncio via the vendored ThreadSafeEvent
// (device-runtime/src/vendor/threadsafe_event/ -- see its README for the
// hard-IRQ-safety trace this node's codegen depends on). Uses the new
// "event-source" codegen pattern (node-definition.ts's
// EventSourceCodegenResult / NodeDefinition.codegenEventSource) rather than
// codegenSource/repeatMs, which has no way to express "block until an
// external event fires."
//
// Debounce is a property on this node (bool + ms), not a separate node --
// the cooldown algorithm (ignore transitions within N ms of the last
// *accepted* one), chosen deliberately over the heavier settle-and-confirm
// alternative per CLAUDE.md's "no premature optimization, but don't paint
// into a dead end" principle. Deliberately decided in the coroutine (soft
// context), not the IRQ handler: the handler's only job is to signal the
// ThreadSafeEvent -- the single non-allocating call its own vendored
// README traces as hard-IRQ-safe -- so nothing about the debounce decision
// (which needs to compare timestamps and, for "both" trigger mode, compare
// pin levels) ever runs in hard-IRQ context at all. The tradeoff: a burst
// of bounces that all land before the coroutine gets scheduled collapses
// into one wake (ThreadSafeEvent is a flag, not a queue) with only the
// pin's level at wake time visible, not each individual bounce's level or
// exact timing -- fine for this node's actual job (report the settled
// state, not every intermediate wiggle), but worth being explicit about
// since it's a real, deliberate information loss, not an oversight.
//
// "both" edge-trigger mode needs more than a pure time-based cooldown: a
// cooldown that only checks elapsed time would happily accept a late
// bounce landing back on the *same* level as the last accepted edge once
// the cooldown window closes, and report a transition that never really
// happened. So "both" mode additionally tracks the last *accepted* pin
// level and requires a real level change, not just elapsed time -- this is
// the "both-edges debounce needs to reason about which edge was last
// accepted, not just whether there was any edge recently" gap the
// scoping note flagged rather than left to be rediscovered mid-build.

import { claimResource, sharedPin } from "./hardware-shared.js";
import { CompileError } from "../compiler/errors.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

const VALID_EDGES = new Set(["rising", "falling", "both"]);

export const interruptNode: NodeDefinition = {
  type: "thingstudio/interrupt",
  kind: "source",
  // Added when this node was wired into the Rete canvas (app/rete/nodes.ts's
  // InterruptNode) -- not present when this file was first built, matching
  // gpio_in's own precedent of shipping registry-only with no canvas
  // presence. `msg`'s payload is always bool (buildMsg's
  // `{'payload': bool(_level), ...}` below), regardless of edge mode.
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const pin = checkPin(ctx, "interrupt pin", node.properties.pin, "input");
    const edge = String(node.properties.edge ?? "rising");
    if (!VALID_EDGES.has(edge)) {
      throw new CompileError(`interrupt edge "${edge}" must be one of "rising", "falling", or "both"`);
    }
    const debounce = Boolean(node.properties.debounce ?? true);
    const debounceMs = Math.round(Number(node.properties.debounceMs ?? 50));
    if (debounce && (!Number.isFinite(debounceMs) || debounceMs <= 0)) {
      throw new CompileError(`interrupt debounceMs "${String(node.properties.debounceMs)}" must be a positive number when debounce is enabled`);
    }

    // Fixed, pin-derived names -- NOT ctx.uniqueName -- so a second interrupt node on the same pin, which the
    // claim below guarantees has the same settings, dedups onto the first's setup (mergeSetup keeps the first
    // statement per key) and its buildMsg names variables that exist.
    // The pin is a keyed singleton shared with any other node on it (hardware-shared.ts,
    // decisions/hardware-singletons.md); the irq handler is claimed too, so two interrupt nodes on one pin
    // with different settings are a compile error instead of the second silently taking the first's.
    const shared = sharedPin(ctx, node, pin, "in");
    claimResource(ctx, `GPIO ${pin} interrupt`, `${edge} edge, ${debounce ? `debounce ${debounceMs} ms` : "no debounce"}`, node);
    const pinVar = shared.varName;
    const evtVar = `_irq_evt_${pin}`;
    const handlerName = `_irq_handler_${pin}`;
    const tsVar = debounce ? `_irq_debounce_ts_${pin}` : null;
    const levelVar = debounce && edge === "both" ? `_irq_debounce_level_${pin}` : null;

    const triggerExpr =
      edge === "rising"
        ? "machine.Pin.IRQ_RISING"
        : edge === "falling"
          ? "machine.Pin.IRQ_FALLING"
          : "machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING";

    // Setup: pin init, the ThreadSafeEvent instance, the hard-IRQ handler
    // (the minimum safe thing -- signal the event, nothing else), and the
    // irq() registration. tsVar is seeded from the current clock at setup
    // time (module import, before any coroutine runs) rather than 0 --
    // deliberate: it means "the very first real edge within debounceMs of
    // flow start gets swallowed" is the honest, documented edge-case
    // behavior, not an accidental one arising from ticks_ms()'s wraparound
    // arithmetic being asked to compare against a bogus zero baseline.
    const setupLines = [
      `${evtVar} = ThreadSafeEvent()`,
      `def ${handlerName}(pin):`,
      `    ${evtVar}.set()`,
      `${pinVar}.irq(trigger=${triggerExpr}, handler=${handlerName})`,
    ];
    if (tsVar) setupLines.push(`${tsVar} = time.ticks_ms()`);
    if (levelVar) setupLines.push(`${levelVar} = -1`); // sentinel: pin.value() is always 0 or 1, so -1 never collides -- the first accepted edge always passes the level check.

    // buildMsg runs in the coroutine (soft context, not the IRQ handler) --
    // see this file's header for why the debounce decision belongs here.
    const bodyLines: string[] = [];
    if (debounce) {
      bodyLines.push(`global ${tsVar}${levelVar ? `, ${levelVar}` : ""}`);
    }
    bodyLines.push(`_level = ${pinVar}.value()`);
    if (debounce) {
      bodyLines.push(`_now = time.ticks_ms()`);
      bodyLines.push(`if time.ticks_diff(_now, ${tsVar}) < ${debounceMs}:`);
      bodyLines.push(`    continue`); // still cooling down from the last accepted edge -- drop this wake, go straight back to waitStatement.
      if (levelVar) {
        bodyLines.push(`if _level == ${levelVar}:`);
        bodyLines.push(`    continue`); // enough time has passed, but the level didn't actually change from the last accepted edge -- not a real transition, see header.
      }
      bodyLines.push(`${tsVar} = _now`);
      if (levelVar) bodyLines.push(`${levelVar} = _level`);
    }
    bodyLines.push(`msg = {'payload': bool(_level), 'topic': ''}`);

    return {
      imports: ["import machine", "import time", "from threadsafe_event import ThreadSafeEvent"],
      statements: [shared.statement, { key: `interrupt-${pin}`, code: setupLines.join("\n") }],
      waitStatement: `await ${evtVar}.wait()\n${evtVar}.clear()`,
      buildMsg: bodyLines.join("\n"),
    };
  },
};
