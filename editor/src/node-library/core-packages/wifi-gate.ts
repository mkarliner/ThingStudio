// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/wifi-gate.ts
//
// wifi_gate as a core package (2026-10-19, the second network node after wifi_status). The hook derives the
// flow's WiFi config and the defer-to-mqtt decision from the context; the Python brings the link up through the
// shared ts_wifi dependency and passes a message only while the station is connected.
//
// A transform: msg in, the same msg out when connected, None (stop propagation) when not. It checks the live
// link at message-arrival time, not wifi_status's emitted messages (which only change on an identity change).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/wifi_gate",
  kind: "transform",
  paletteId: "wifi_gate",
  label: "wifi gate",
  group: "network",
  priority: 11,
  color: "#1f8a5a",
  bgcolor: "#123f2a",
  icon: "⊘",
  width: 110,
  description: "Passes a message on unchanged if WiFi is connected when it arrives, and drops it if not.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    // The flow's one WiFi config. Named + singleton so the hook receives it in referencedConfigs (the built-in
    // used an info-only picker and derived the same singleton internally).
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "", help: "One WiFi network per flow: every WiFi node shares this setting." },
  ],
};

/** Same derivation as wifi_status's hook, minus the poll interval. */
export const compileHook = `${WIFI_DERIVATION}
def compile(ctx, properties):
    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}
    return {'properties': wifi}
`;

export const python = `import ts_wifi

_sta = ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])


async def run(msg, properties):
    return msg if _sta.isconnected() else None
`;
