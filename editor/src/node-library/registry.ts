// SPDX-License-Identifier: Apache-2.0
import type { NodeDefinition } from "../compiler/node-definition.js";
import { descriptor as debugCoreDescriptor, python as debugCorePython } from "./core-packages/debug.js";
import { displayI2cNode } from "./display-i2c.js";
import { displaySpiNode } from "./display-spi.js";
import { descriptor as delayCoreDescriptor, python as delayCorePython } from "./core-packages/delay.js";
import { descriptor as filterCoreDescriptor, python as filterCorePython } from "./core-packages/filter.js";
import { descriptor as journalCoreDescriptor, python as journalCorePython } from "./core-packages/journal.js";
import { descriptor as bme280CoreDescriptor, python as bme280CorePython } from "./core-packages/bme280.js";
import { touchI2cNode } from "./touch-i2c.js";
import { buildCoreNodeDefinition } from "./custom-node.js";
import { descriptor as i2cCoreDescriptor, python as i2cCorePython } from "./core-packages/i2c.js";
import { descriptor as eswitchCoreDescriptor, python as eswitchCorePython } from "./core-packages/eswitch.js";
import { descriptor as ebuttonCoreDescriptor, python as ebuttonCorePython } from "./core-packages/ebutton.js";
import { adcNode } from "./adc.js";
import { encoderNode } from "./encoder.js";
import { descriptor as neopixelCoreDescriptor, python as neopixelCorePython } from "./core-packages/neopixel.js";
import { functionNode } from "./function-node.js";
import { descriptor as gpioOutCoreDescriptor, python as gpioOutCorePython } from "./core-packages/gpio-out.js";
import { httpInNode } from "./http-in.js";
import { httpRequestNode } from "./http-request.js";
import { descriptor as httpResponseCoreDescriptor, python as httpResponseCorePython } from "./core-packages/http-response.js";
import { injectNode } from "./inject.js";
import { descriptor as interruptCoreDescriptor, python as interruptCorePython } from "./core-packages/interrupt.js";
import { mqttPublishNode } from "./mqtt-publish.js";
import { mqttSubscribeNode } from "./mqtt-subscribe.js";
import { descriptor as pwmOutCoreDescriptor, python as pwmOutCorePython } from "./core-packages/pwm-out.js";
import { startupNode } from "./startup.js";
import { timerNode } from "./timer.js";
import { udpReceiveNode } from "./udp-receive.js";
import { udpSendNode } from "./udp-send.js";
import { ntpNode } from "./ntp.js";
import { variableGetNode } from "./variable-get.js";
import { variableSetNode } from "./variable-set.js";
import { wifiGateNode } from "./wifi-gate.js";
import { wifiStatusNode } from "./wifi-status.js";
import { GUI_NODES } from "./gui.js";

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
    buildCoreNodeDefinition(gpioOutCoreDescriptor, gpioOutCorePython),
    variableGetNode,
    variableSetNode,
    buildCoreNodeDefinition(debugCoreDescriptor, debugCorePython),
    buildCoreNodeDefinition(interruptCoreDescriptor, interruptCorePython),
    buildCoreNodeDefinition(eswitchCoreDescriptor, eswitchCorePython),
    buildCoreNodeDefinition(ebuttonCoreDescriptor, ebuttonCorePython),
    adcNode,
    encoderNode,
    buildCoreNodeDefinition(neopixelCoreDescriptor, neopixelCorePython),
    displaySpiNode,
    displayI2cNode,
    buildCoreNodeDefinition(pwmOutCoreDescriptor, pwmOutCorePython),
    timerNode,
    wifiStatusNode,
    wifiGateNode,
    httpRequestNode,
    httpInNode,
    buildCoreNodeDefinition(httpResponseCoreDescriptor, httpResponseCorePython),
    mqttPublishNode,
    mqttSubscribeNode,
    udpSendNode,
    udpReceiveNode,
    ntpNode,
    // A core package (phase 4): descriptor + .node.py, no TypeScript hook. See core-packages/delay.ts.
    buildCoreNodeDefinition(delayCoreDescriptor, delayCorePython),
    buildCoreNodeDefinition(filterCoreDescriptor, filterCorePython),
    buildCoreNodeDefinition(journalCoreDescriptor, journalCorePython),
    buildCoreNodeDefinition(bme280CoreDescriptor, bme280CorePython),
    touchI2cNode,
    // i2c is a core package now (node-format-parity phase 4, option A) -- built from its descriptor + .node.py,
    // not a TypeScript codegen hook. See node-library/core-packages/i2c.ts.
    buildCoreNodeDefinition(i2cCoreDescriptor, i2cCorePython),
    ...GUI_NODES,
  ]) {
    registry.set(def.type, def);
  }
  return registry;
}
