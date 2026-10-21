// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/wifi-status.ts
//
// wifi_status as a core package (node-format-parity phase 4 + the package compile hook, the first "no loss"
// target from package-compile-hooks-scoping.md §8). The hook derives the flow's WiFi config and the
// defer-to-mqtt decision from the context; the Python does what the built-in's codegen did, in the package
// shape: bring the station interface up (or defer to mqtt_as), poll state, emit only on change, report status.
//
// The hook returns `intervalMs` because the package source format's poll interval is named `intervalMs`;
// wifi_status's own field stays `pollMs` (a saved-flow and user-facing name), and the generic source codegen
// reads the merged properties.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/wifi_status",
  kind: "source",
  paletteId: "wifi_status",
  label: "wifi status",
  group: "network",
  priority: 10,
  color: "#1f6e6e",
  bgcolor: "#123f3f",
  icon: "◉",
  width: 120,
  description:
    "Reports the board's WiFi connection state. With no other WiFi node in the flow, it also brings the " +
    "connection up.",
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  properties: [
    { name: "pollMs", label: "poll interval (ms)", kind: "number", default: 5000, min: 1 },
    // The flow's one WiFi config; the hook resolves it from referencedConfigs (the built-in always used the
    // flow singleton, ignoring the stored id).
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "", help: "One WiFi network per flow: every WiFi node shares this setting. Pick \"unmanaged\" if the board joins WiFi some other way (e.g. its setup AP)." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

/** Derives ssid/password/security/deferToMqtt from the flow, with the same compile-time refusals the
 * built-in had (missing config, missing SSID, missing password). */
export const compileHook = `${WIFI_DERIVATION}
def compile(ctx, properties):
    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}

    poll = properties.get('pollMs', 5000)
    try:
        poll = int(poll)
    except (TypeError, ValueError):
        return {'errors': ['pollMs must be a positive number']}
    if poll <= 0:
        return {'errors': ['pollMs must be a positive number']}

    wifi['intervalMs'] = poll
    return {'properties': wifi}
`;

export const python = `import ts_wifi

_node_id = properties['nodeId']

# Shared, idempotent bring-up: the same call the built-in network nodes emit, so wifi_status plus mqtt_as (or
# any other WiFi node) bring the station interface up exactly once.
_sta = ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])

_last = None


async def emit(properties):
    nonlocal _last
    connected = bool(_sta.isconnected())
    if connected:
        ifcfg = _sta.ifconfig()
        ip = ifcfg[0]
        subnet = ifcfg[1]
        gateway = ifcfg[2]
        dns = ifcfg[3]
        try:
            rssi = _sta.status('rssi')
        except (OSError, AttributeError):
            rssi = None
    else:
        ip = ''
        subnet = ''
        gateway = ''
        dns = ''
        rssi = None

    state = (connected, ip, subnet, gateway, dns)
    if state == _last:
        return None
    _last = state
    runtime.report_status(_node_id, 'connected' if connected else 'disconnected', ip if connected else None)
    return {'payload': connected, 'topic': '', 'ip': ip, 'subnet': subnet, 'gateway': gateway, 'dns': dns, 'rssi': rssi}
`;
