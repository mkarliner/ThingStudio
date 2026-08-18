// SPDX-License-Identifier: Apache-2.0
import type { NodeDefinition } from "../compiler/node-definition.js";
import { arithmeticNode } from "./arithmetic.js";
import { booleanNode } from "./boolean.js";
import { comparatorNode } from "./comparator.js";
import { debugNode } from "./debug.js";
import { functionNode } from "./function-node.js";
import { gpioOutNode } from "./gpio-out.js";
import { httpRequestNode } from "./http-request.js";
import { injectNode } from "./inject.js";
import { interruptNode } from "./interrupt.js";
import { mqttPublishNode } from "./mqtt-publish.js";
import { mqttSubscribeNode } from "./mqtt-subscribe.js";
import { pwmOutNode } from "./pwm-out.js";
import { timerNode } from "./timer.js";
import { udpReceiveNode } from "./udp-receive.js";
import { udpSendNode } from "./udp-send.js";
import { variableGetNode } from "./variable-get.js";
import { variableSetNode } from "./variable-set.js";
import { wifiStatusNode } from "./wifi-status.js";

/**
 * The full v1 node type registry. The POC-D set (inject, function,
 * gpio_out) plus Tier 1's software-only batch
 * (docs/working-notes/mvp-feature-priorities.md): boolean/arithmetic
 * logic, comparators/thresholds, variable get/set, debug -- plus the
 * GPIO/timer batch: pwm_out, timer, plus interrupt (Tier 1 item 5,
 * 2026-08-17 -- replaces the poll-driven gpio_in node, deprecated and
 * removed the same session; see mvp-feature-priorities.md item 2's
 * superseded note and item 5) -- plus the network batch: wifi_status,
 * http_request, mqtt_publish, mqtt_subscribe, plus the raw UDP/TCP batch
 * (item 5 point 3, 2026-08-18): udp_send, udp_receive so far (tcp_send/
 * tcp_listen_receive are this same batch's harder pair, tracked
 * separately -- see mvp-feature-priorities.md item 5 point 3's own
 * scope-split note). I2C/SPI sensor nodes are the one Tier 1 batch not
 * yet added. Like http_request/mqtt_publish/mqtt_subscribe, udp_send/
 * udp_receive are registry-only for now -- no `ports`/canvas wiring yet
 * (see node-definition.ts's `ports` field comment for what that means).
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
    interruptNode,
    pwmOutNode,
    timerNode,
    wifiStatusNode,
    httpRequestNode,
    mqttPublishNode,
    mqttSubscribeNode,
    udpSendNode,
    udpReceiveNode,
  ]) {
    registry.set(def.type, def);
  }
  return registry;
}
