// SPDX-License-Identifier: Apache-2.0
import type { NodeDefinition } from "../compiler/node-definition.js";
import { arithmeticNode } from "./arithmetic.js";
import { booleanNode } from "./boolean.js";
import { comparatorNode } from "./comparator.js";
import { debugNode } from "./debug.js";
import { functionNode } from "./function-node.js";
import { gpioOutNode } from "./gpio-out.js";
import { injectNode } from "./inject.js";
import { variableGetNode } from "./variable-get.js";
import { variableSetNode } from "./variable-set.js";

/**
 * The full v1 node type registry. The POC-D set (inject, function,
 * gpio_out) plus Tier 1's software-only batch
 * (docs/working-notes/mvp-feature-priorities.md): boolean/arithmetic
 * logic, comparators/thresholds, variable get/set, debug. GPIO in/PWM/
 * timers, I2C/SPI sensors, and network nodes are later Tier 1 batches,
 * not yet added.
 */
export function buildRegistry(): Map<string, NodeDefinition> {
  const registry = new Map<string, NodeDefinition>();
  for (const def of [
    injectNode,
    functionNode,
    gpioOutNode,
    booleanNode,
    arithmeticNode,
    comparatorNode,
    variableGetNode,
    variableSetNode,
    debugNode,
  ]) {
    registry.set(def.type, def);
  }
  return registry;
}
