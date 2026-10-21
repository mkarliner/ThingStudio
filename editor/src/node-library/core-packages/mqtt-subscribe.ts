// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/mqtt-subscribe.ts
//
// mqtt_subscribe as a core package (2026-10-19). Two-faced since 2026-10-20: its output face waits for a message
// routed to this node by the shared ts_mqtt client and emits payload/topic/retained; its input face changes the
// subscription at run time (msg.action subscribe/unsubscribe, Node-RED's mqtt-in shape). ts_mqtt tracks
// subscriptions per node, so one node letting go does not silence a sibling on the same topic.
//
// The configured topic is subscribed at start, as before. With dynamic subscription off, the input face reports a
// clear error rather than silently ignoring an action message. The hook validates the topic/qos and derives WiFi
// and the broker config.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { MQTT_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/mqtt_subscribe",
  kind: "sink",
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
    "setting. In a flow with MQTT nodes, MQTT manages the WiFi connection, so \"unmanaged\" isn't accepted. " +
    "Dynamic subscription: with it on, an input message {action: subscribe|unsubscribe, topic} changes what this " +
    "node listens to at run time.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
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
    { name: "dynamic", label: "dynamic subscription", kind: "boolean", default: false },
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
_dynamic = bool(properties['dynamic'])


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


async def run(msg, properties):
    if not _dynamic:
        raise OSError("mqtt_subscribe: dynamic subscription is off -- turn it on to use this node's input")
    action = msg.get('action')
    topic = msg.get('topic')
    if topic is None or topic == '':
        raise OSError("mqtt_subscribe: an action message needs a topic")
    topics = topic if isinstance(topic, (list, tuple)) else [topic]
    parsed = []
    for entry in topics:
        if isinstance(entry, dict):
            name = entry.get('topic')
            try:
                entry_qos = int(entry.get('qos', _qos))
            except (TypeError, ValueError):
                entry_qos = -1
            if entry_qos not in (0, 1):
                raise OSError("mqtt_subscribe: topic %r has qos %r -- use 0 or 1" % (name, entry.get('qos')))
        else:
            name = entry
            entry_qos = _qos
        if name is None or name == '':
            raise OSError("mqtt_subscribe: an action message needs a topic")
        parsed.append((str(name), entry_qos))
    await _broker.ensure_connected(_node_id)
    if action == 'subscribe':
        for name, entry_qos in parsed:
            await _broker.subscribe(_node_id, name, entry_qos)
    elif action == 'unsubscribe':
        for name, _entry_qos in parsed:
            await _broker.unsubscribe(_node_id, name)
    else:
        raise OSError("mqtt_subscribe: unknown action %r -- use subscribe or unsubscribe" % (action,))


async def wait(properties):
    await _sub.wait()


async def emit(properties):
    msg = _sub.emit()
    # The old built-in's repeatMs. A burst of queued messages would otherwise run back to back with no yield,
    # the non-yielding-event-loop hazard the source model guards against.
    await asyncio.sleep_ms(10)
    return msg
`;
