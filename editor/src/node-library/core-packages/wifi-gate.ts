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
  description:
    "Passes the message through unchanged if the WiFi station link is currently up, or drops it (same as a function " +
    "node's own \"return null\") if it isn't. Checks the live link state at message-arrival-time, not wifi_status's " +
    "own emitted messages. One WiFi network per flow: every WiFi node shares this setting.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    // The flow's one WiFi config. Named + singleton so the hook receives it in referencedConfigs (the built-in
    // used an info-only picker and derived the same singleton internally).
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
  ],
};

/** Same derivation as wifi_status's hook, minus the poll interval. */
export const compileHook = `def compile(ctx, properties):
    configs = [c for c in ctx['flow']['configs'] if c['type'] == 'thingstudio/config/wifi']
    if not configs:
        return {'errors': ['needs a WiFi network -- set "WiFi" in its properties (every WiFi node in a flow shares one)']}
    if len(configs) > 1:
        return {'errors': ['this flow has %d WiFi configs, but a flow can only have one -- reopen the flow in the editor to merge them' % len(configs)]}
    wifi = (ctx.get('referencedConfigs') or {}).get(configs[0]['id'])
    if wifi is None:
        return {'errors': ['could not resolve the WiFi config -- reopen the flow in the editor']}

    security = wifi.get('security')
    if security not in ('open', 'unmanaged'):
        security = 'password'
    ssid = str(wifi.get('ssid') or '').strip()
    password = str(wifi.get('password') or '')
    if security != 'unmanaged' and not ssid:
        return {'errors': ['the WiFi config has no network name (SSID) -- pick a saved WiFi credential, or set security to "unmanaged"']}
    if security == 'password' and not password:
        return {'errors': ['WiFi config for ssid "' + ssid + '" has no password but security is "password"']}

    mqtt = any(n['type'] in ('thingstudio/mqtt_publish', 'thingstudio/mqtt_subscribe') for n in ctx['flow']['nodes'])
    return {
        'properties': {
            'ssid': ssid,
            'password': password,
            'security': security,
            'deferToMqtt': mqtt,
        },
    }
`;

export const python = `import ts_wifi

_sta = ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])


async def run(msg, properties):
    return msg if _sta.isconnected() else None
`;
