// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/mqtt-subscribe.ts
//
// mqtt_subscribe as a core package (2026-10-19). A source: waits for a message routed to this node by the shared
// ts_mqtt client (one client per broker, subscriptions tracked per node) and emits payload/topic/retained. The
// hook validates the topic/qos and derives the flow's WiFi and referenced broker config.
//
// Dynamic subscription (msg.action subscribe/unsubscribe, Node-RED's mqtt-in shape) is not built yet; ts_mqtt's
// subscribe()/unsubscribe() take a node id and the registry is per node, which is the seam it will use
// (docs/working-notes/outstanding-items/mqtt-dynamic-subscription.md).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { MQTT_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/mqtt_subscribe",
  kind: "source",
  eventSource: true,
  paletteId: "mqtt_subscribe",
  label: "mqtt subscribe",
  group: "network",
  priority: 30,
  color: "#6e3b8a",
  bgcolor: "#3a1f4a",
  icon: "⇩",
  width: 132,
  description:
    "Broker config required -- won't compile without one. One WiFi network per flow: every WiFi node shares this " +
    "setting. In a flow with MQTT nodes, MQTT manages the WiFi connection, so \"unmanaged\" isn't accepted.",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "topic", label: "topic", kind: "text", default: "" },
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
    settings, err = _ts_mqtt(ctx, properties, 'mqtt_subscribe')
    if err:
        return {'errors': [err]}

    topic = str(properties.get('topic') or '').strip()
    if not topic:
        return {'errors': ['mqtt_subscribe requires a non-empty "topic"']}
    try:
        qos = int(properties.get('qos', 0))
    except (TypeError, ValueError):
        qos = -1
    if qos not in (0, 1):
        return {'errors': ['mqtt_subscribe qos "' + str(properties.get('qos')) + '" must be 0 or 1 -- qos 2 is not supported (mqtt_as limitation)']}

    settings['topic'] = topic
    settings['qos'] = qos
    return {'properties': settings}
`;

export const python = `import ts_wifi
import ts_mqtt

ts_wifi.ensure_station(properties['ssid'], properties['wifiPassword'], properties['security'], properties['deferToMqtt'])

_broker = ts_mqtt.ensure_client(
    properties['broker'], properties['port'], properties['ssid'], properties['wifiPassword'],
    properties['security'], properties['username'], properties['brokerPassword'])
_topic = properties['topic']
_qos = int(properties['qos'])
_node_id = properties['nodeId']


class _Sub:
    def __init__(self):
        self.ready = False
        self.last = None

    async def wait(self):
        if not self.ready:
            await _broker.ensure_connected(_node_id)
            await _broker.subscribe(_node_id, _topic, _qos)
            self.ready = True
        self.last = await _broker.wait_message(_node_id)

    def emit(self):
        _topic_in, _payload, _retained = self.last
        return {
            'payload': _payload.decode() if isinstance(_payload, (bytes, bytearray)) else _payload,
            'topic': _topic_in.decode() if isinstance(_topic_in, (bytes, bytearray)) else _topic_in,
            'retained': bool(_retained),
        }


_sub = _Sub()


async def wait(properties):
    await _sub.wait()


async def emit(properties):
    msg = _sub.emit()
    # The old built-in's repeatMs. A burst of queued messages would otherwise run back to back with no yield,
    # the non-yielding-event-loop hazard the source model guards against.
    await asyncio.sleep_ms(10)
    return msg
`;
