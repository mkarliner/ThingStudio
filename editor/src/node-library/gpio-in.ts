// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/gpio-in.ts
//
// Tier 1 GPIO/timer batch (mvp-feature-priorities.md item 2) -- real I/O,
// on the same polling-coroutine mechanism POC-A already proved reliable
// on hardware (design doc §15.1: "a second loop polling a GPIO input...
// and printing its value"). Not interrupt-driven (machine.Pin.irq()) for
// v1 -- polling on a configurable interval is simpler, matches the
// already-proven mechanism, and is enough for the witness rig's own
// gpio_in validation story (mvp-validation-plan.md: "the witness driving
// a known stimulus into a gpio_in-class node").
//
// Uses its own pin-claim key/variable name (`pin-N-in` / `_pin_N_in`),
// distinct from gpio_out's (`pin-N-out` / `_pin_N`), so a flow that
// (incorrectly) wires the same physical pin number as both an input and
// an output still gets two correctly-configured Pin objects instead of
// one silently misconfigured one -- not a substitute for real
// pin-conflict detection (still not built, see node-definition-model.md's
// "No resource-conflict checking"), just cheap insurance against the
// worse failure mode of silently wrong generated code.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";

export const gpioInNode: NodeDefinition = {
  type: "thingstudio/gpio_in",
  kind: "source",
  codegenSource(node: GraphNode, _ctx: CodegenContext): SourceCodegenResult {
    const pin = Math.round(Number(node.properties.pin));
    if (!Number.isFinite(pin) || pin < 0 || pin > 39) {
      throw new CompileError(`gpio_in pin ${String(node.properties.pin)} is out of range (0-39)`);
    }
    const pollMs = Math.round(Number(node.properties.pollMs ?? 100));
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new CompileError(`gpio_in pollMs "${String(node.properties.pollMs)}" must be a positive number`);
    }
    const pinVar = `_pin_${pin}_in`;

    return {
      imports: ["import machine"],
      statements: [{ key: `pin-${pin}-in`, code: `${pinVar} = machine.Pin(${pin}, machine.Pin.IN)` }],
      buildMsg: `msg = {'payload': bool(${pinVar}.value()), 'topic': ''}`,
      repeatMs: pollMs,
    };
  },
};
