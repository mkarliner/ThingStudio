// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/mqtt-publish.ts
//
// mqtt_publish as a core package (2026-10-19). The hook validates the topic/qos and derives the flow's WiFi and
// referenced broker config; the Python publishes through the shared ts_mqtt client (one client per broker, keyed
// by host:port), which also owns connection, retries and the per-node status report.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { MQTT_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/mqtt_publish",
  kind: "sink",
  paletteId: "mqtt_publish",
  label: "mqtt publish",
  group: "network",
  priority: 31,
  color: "#8a3b6e",
  bgcolor: "#4a1f3a",
  icon: "⇧",
  width: 128,
  description:
    "Broker config required -- won't compile without one. One WiFi network per flow: every WiFi node shares this " +
    "setting. In a flow with MQTT nodes, MQTT manages the WiFi connection, so \"unmanaged\" isn't accepted.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "topic", label: "topic", kind: "text", default: "" },
    { name: "retain", label: "retain", kind: "boolean", default: false },
    {
      name: "qos",
      label: "qos",
      kind: "select",
      default: 0,
      options: [
        { value: 0, label: "0" },
        { value: 1, label: "1" },
      ],
    },
    { name: "brokerConfigId", label: "MQTT Broker", kind: "configRef", configType: "thingstudio/config/mqtt-broker", default: "" },
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${MQTT_DERIVATION}
def compile(ctx, properties):
    settings, err = _ts_mqtt(ctx, properties, 'mqtt_publish')
    if err:
        return {'errors': [err]}

    topic = str(properties.get('topic') or '').strip()
    if not topic:
        return {'errors': ['mqtt_publish requires a non-empty "topic"']}
    try:
        qos = int(properties.get('qos', 0))
    except (TypeError, ValueError):
        qos = -1
    if qos not in (0, 1):
        return {'errors': ['mqtt_publish qos "' + str(properties.get('qos')) + '" must be 0 or 1 -- qos 2 is not supported (mqtt_as limitation)']}

    settings['topic'] = topic
    settings['qos'] = qos
    settings['retain'] = bool(properties.get('retain', False))
    return {'properties': settings}
`;

export const python = `import ts_wifi
import ts_mqtt

ts_wifi.ensure_station(properties['ssid'], properties['wifiPassword'], properties['security'], properties['deferToMqtt'])

_broker = ts_mqtt.ensure_client(
    properties['broker'], properties['port'], properties['ssid'], properties['wifiPassword'],
    properties['security'], properties['username'], properties['brokerPassword'])
_topic = properties['topic']
_retain = bool(properties['retain'])
_qos = int(properties['qos'])
_node_id = properties['nodeId']


async def run(msg, properties):
    _payload = msg.get('payload')
    if isinstance(_payload, (bytes, bytearray)):
        _body = bytes(_payload)
    elif isinstance(_payload, str):
        _body = _payload.encode()
    else:
        _body = str(_payload).encode()
    await _broker.publish(_node_id, _topic, _body, _retain, _qos)
`;
