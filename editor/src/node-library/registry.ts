// SPDX-License-Identifier: Apache-2.0
import type { NodeDefinition } from "../compiler/node-definition.js";
import { debugNode } from "./debug.js";
import { displayI2cNode } from "./display-i2c.js";
import { displaySpiNode } from "./display-spi.js";
import { delayNode } from "./delay.js";
import { ebuttonNode } from "./ebutton.js";
import { eswitchNode } from "./eswitch.js";
import { functionNode } from "./function-node.js";
import { gpioOutNode } from "./gpio-out.js";
import { httpInNode } from "./http-in.js";
import { httpRequestNode } from "./http-request.js";
import { httpResponseNode } from "./http-response.js";
import { injectNode } from "./inject.js";
import { interruptNode } from "./interrupt.js";
import { mqttPublishNode } from "./mqtt-publish.js";
import { mqttSubscribeNode } from "./mqtt-subscribe.js";
import { pwmOutNode } from "./pwm-out.js";
import { startupNode } from "./startup.js";
import { timerNode } from "./timer.js";
import { udpReceiveNode } from "./udp-receive.js";
import { udpSendNode } from "./udp-send.js";
import { variableGetNode } from "./variable-get.js";
import { variableSetNode } from "./variable-set.js";
import { wifiGateNode } from "./wifi-gate.js";
import { wifiStatusNode } from "./wifi-status.js";

/**
 * The full v1 node type registry. The POC-D set (inject, function,
 * gpio_out) plus Tier 1's software-only batch
 * (docs/working-notes/mvp-feature-priorities.md): variable get/set, debug
 * -- boolean/arithmetic logic and comparators/thresholds were also part of
 * that original batch but were removed 2026-08-21 as redundant with the
 * function node (single-input transforms against a configured constant,
 * never wired onto the canvas, no stronger typing than `function`'s `any`
 * ports in the actual implementation -- same reasoning that already
 * rejected ADC and file-ops as dedicated node types; see decisions.md's
 * "Config nodes / Tier 1 scope" section) -- plus the
 * GPIO/timer batch: pwm_out, timer, plus interrupt (Tier 1 item 5,
 * 2026-08-17 -- replaces the poll-driven gpio_in node, deprecated and
 * removed the same session; see mvp-feature-priorities.md item 2's
 * superseded note and item 5) -- plus the network batch: wifi_status,
 * http_request, mqtt_publish, mqtt_subscribe, plus http_in/http_response
 * (2026-09-08, exact-path-match v1 -- see http-server-shared.ts's own
 * header for scope), plus the raw UDP/TCP batch
 * (item 5 point 3, 2026-08-18): udp_send, udp_receive so far (tcp_send/
 * tcp_listen_receive are this same batch's harder pair, tracked
 * separately -- see mvp-feature-priorities.md item 5 point 3's own
 * scope-split note). I2C/SPI sensor nodes are the one Tier 1 batch not
 * yet added. Like http_request/mqtt_publish/mqtt_subscribe, udp_send/
 * udp_receive are registry-only for now -- no `ports`/canvas wiring yet
 * (see node-definition.ts's `ports` field comment for what that means).
 * eswitch/ebutton (2026-09-17, outstanding-items.md's "[P4] eswitch/ebutton
 * nodes") wrap Peter Hinch's ESwitch/EButton asyncio drivers -- given
 * canvas presence from the day they were built, see eswitch.ts/ebutton.ts's
 * own headers for the full design story.
 * display_spi/display_i2c (2026-09-17, outstanding-items.md's "[P4] SSD1306
 * display node") round out the display side: two node families split by
 * bus (SPI color TFTs / I2C mono OLEDs), each pushing an already-rendered
 * framebuf-format frame to a vendored driver -- see display-spi.ts/
 * display-i2c.ts's own headers for the full design story, including the
 * tracked (not yet solved) VENDOR_FILES scaling concern.
 * startup (2026-09-24): fires once at flow start, after a DEPLOY and after
 * a reset that resumes the saved flow -- see startup.ts's header. Its
 * source file landed 2026-09-17 but was never registered until now.
 */
export function buildRegistry(): Map<string, NodeDefinition> {
  const registry = new Map<string, NodeDefinition>();
  for (const def of [
    injectNode,
    startupNode,
    functionNode,
    gpioOutNode,
    variableGetNode,
    variableSetNode,
    debugNode,
    interruptNode,
    eswitchNode,
    ebuttonNode,
    displaySpiNode,
    displayI2cNode,
    pwmOutNode,
    timerNode,
    wifiStatusNode,
    wifiGateNode,
    httpRequestNode,
    httpInNode,
    httpResponseNode,
    mqttPublishNode,
    mqttSubscribeNode,
    udpSendNode,
    udpReceiveNode,
    delayNode,
  ]) {
    registry.set(def.type, def);
  }
  return registry;
}
