// SPDX-License-Identifier: Apache-2.0
import type { NodeDefinition } from "../compiler/node-definition.js";
import type { NodeDescriptor } from "../compiler/node-descriptor.js";
import { descriptor as debugCoreDescriptor, python as debugCorePython } from "./core-packages/debug.js";
import { descriptor as displayI2cCoreDescriptor, python as displayI2cCorePython } from "./core-packages/display-i2c.js";
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
import { descriptor as encoderCoreDescriptor, python as encoderCorePython } from "./core-packages/encoder.js";
import { descriptor as neopixelCoreDescriptor, python as neopixelCorePython } from "./core-packages/neopixel.js";
import { functionNode } from "./function-node.js";
import { descriptor as gpioOutCoreDescriptor, python as gpioOutCorePython } from "./core-packages/gpio-out.js";
import { descriptor as httpInCoreDescriptor, python as httpInCorePython, compileHook as httpInCompileHook } from "./core-packages/http-in.js";
import { descriptor as httpRequestCoreDescriptor, python as httpRequestCorePython, compileHook as httpRequestCompileHook } from "./core-packages/http-request.js";
import { descriptor as httpResponseCoreDescriptor, python as httpResponseCorePython } from "./core-packages/http-response.js";
import { descriptor as injectCoreDescriptor, python as injectCorePython } from "./core-packages/inject.js";
import { descriptor as interruptCoreDescriptor, python as interruptCorePython } from "./core-packages/interrupt.js";
import { descriptor as mqttPublishCoreDescriptor, python as mqttPublishCorePython, compileHook as mqttPublishCompileHook } from "./core-packages/mqtt-publish.js";
import { descriptor as mqttSubscribeCoreDescriptor, python as mqttSubscribeCorePython, compileHook as mqttSubscribeCompileHook } from "./core-packages/mqtt-subscribe.js";
import { descriptor as pwmOutCoreDescriptor, python as pwmOutCorePython } from "./core-packages/pwm-out.js";
import { descriptor as startupCoreDescriptor, python as startupCorePython } from "./core-packages/startup.js";
import { descriptor as timerCoreDescriptor, python as timerCorePython } from "./core-packages/timer.js";
import { descriptor as udpReceiveCoreDescriptor, python as udpReceiveCorePython, compileHook as udpReceiveCompileHook } from "./core-packages/udp-receive.js";
import { descriptor as udpSendCoreDescriptor, python as udpSendCorePython, compileHook as udpSendCompileHook } from "./core-packages/udp-send.js";
import { descriptor as ntpCoreDescriptor, python as ntpCorePython, compileHook as ntpCompileHook } from "./core-packages/ntp.js";
import { descriptor as variableGetCoreDescriptor, python as variableGetCorePython, compileHook as variableGetCompileHook } from "./core-packages/variable-get.js";
import { variableSetNode } from "./variable-set.js";
import { descriptor as wifiGateCoreDescriptor, python as wifiGateCorePython, compileHook as wifiGateCompileHook } from "./core-packages/wifi-gate.js";
import { descriptor as wifiStatusCoreDescriptor, python as wifiStatusCorePython, compileHook as wifiStatusCompileHook } from "./core-packages/wifi-status.js";
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
/** A core package that also ships a compile hook (interfaces/node-compile-context/). */
function corePackage(descriptor: NodeDescriptor, python: string, compileHook?: string): NodeDefinition {
  return buildCoreNodeDefinition(descriptor, python, compileHook);
}

export function buildRegistry(): Map<string, NodeDefinition> {
  const registry = new Map<string, NodeDefinition>();
  for (const def of [
    buildCoreNodeDefinition(injectCoreDescriptor, injectCorePython),
    buildCoreNodeDefinition(startupCoreDescriptor, startupCorePython),
    functionNode,
    buildCoreNodeDefinition(gpioOutCoreDescriptor, gpioOutCorePython),
    corePackage(variableGetCoreDescriptor, variableGetCorePython, variableGetCompileHook),
    variableSetNode,
    buildCoreNodeDefinition(debugCoreDescriptor, debugCorePython),
    buildCoreNodeDefinition(interruptCoreDescriptor, interruptCorePython),
    buildCoreNodeDefinition(eswitchCoreDescriptor, eswitchCorePython),
    buildCoreNodeDefinition(ebuttonCoreDescriptor, ebuttonCorePython),
    adcNode,
    buildCoreNodeDefinition(encoderCoreDescriptor, encoderCorePython),
    buildCoreNodeDefinition(neopixelCoreDescriptor, neopixelCorePython),
    displaySpiNode,
    buildCoreNodeDefinition(displayI2cCoreDescriptor, displayI2cCorePython),
    buildCoreNodeDefinition(pwmOutCoreDescriptor, pwmOutCorePython),
    buildCoreNodeDefinition(timerCoreDescriptor, timerCorePython),
    corePackage(wifiStatusCoreDescriptor, wifiStatusCorePython, wifiStatusCompileHook),
    corePackage(wifiGateCoreDescriptor, wifiGateCorePython, wifiGateCompileHook),
    corePackage(httpRequestCoreDescriptor, httpRequestCorePython, httpRequestCompileHook),
    corePackage(httpInCoreDescriptor, httpInCorePython, httpInCompileHook),
    buildCoreNodeDefinition(httpResponseCoreDescriptor, httpResponseCorePython),
    corePackage(mqttPublishCoreDescriptor, mqttPublishCorePython, mqttPublishCompileHook),
    corePackage(mqttSubscribeCoreDescriptor, mqttSubscribeCorePython, mqttSubscribeCompileHook),
    corePackage(udpSendCoreDescriptor, udpSendCorePython, udpSendCompileHook),
    corePackage(udpReceiveCoreDescriptor, udpReceiveCorePython, udpReceiveCompileHook),
    corePackage(ntpCoreDescriptor, ntpCorePython, ntpCompileHook),
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
