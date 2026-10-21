# MQTT dynamic subscription (subscribe/unsubscribe at run time)

Added 2026-10-19, from Mike's question "on mqtt -- how do I unsubscribe?" and the reviewer's answer
(`reviews/2026-10-19-reply-review-and-smoke-test.md` follow-up, same session). **Status: built 2026-10-20** --
`ts_mqtt` landed the per-node registry on 2026-10-19, and `mqtt_subscribe` is now a two-faced package whose input
face takes the actions below.

## Today

An `mqtt_subscribe` node is a source with a fixed `topic`. It subscribes once when the flow starts and stays
subscribed until the flow stops; it has no input. The only way to stop receiving is to delete the node (or change
its topic) and redeploy, or remove the flow. On redeploy the shared client's `runtime.register_cleanup` handler
disconnects from the broker, and the client starts each connection with a clean session (`clean_init: True` in
the vendored `mqtt_as` config), so the broker drops the subscription. Filtering messages out downstream with a
`function` node is a workaround; the board still receives them.

## The gap

Node-RED's `mqtt in` node has a "dynamic subscription" mode: the node gains an input, and messages with
`msg.action` (`connect`, `disconnect`, `getSubscriptions`, `subscribe`, `unsubscribe`) and `msg.topic` change what it
listens to at run time. Current Node-RED docs: for subscribe/unsubscribe, `msg.topic` is a string, a
`{topic, qos}` object, or an array of either; there is no `true` form. Mimic it as far as is reasonable (the
project's Node-RED rule).

The vendored `mqtt_as` already has `unsubscribe(topic)` (`device-runtime/src/vendor/mqtt_as/__init__.py`), so no
board-side capability is missing.

## Design requirements (implemented in `ts_mqtt`, 2026-10-19)

These matter even before dynamic subscription is built, because retrofitting them into a shared client is harder
than designing them in. See `network-package-gaps-briefing.md` item 2.

1. **Subscriptions are tracked per node, not per topic.** Two nodes on one broker may subscribe to the same topic
   (or overlapping wildcards). One node unsubscribing must not silence the other: the library keeps a
   `{topic: set(node_id)}` (or equivalent) registry and sends the broker an UNSUBSCRIBE only when the last node
   lets go.
2. **Resubscribe on reconnect from the current set**, not from the set the flow started with. `mqtt_as` reconnects
   on its own; after a reconnect the library resubscribes to whatever the registry holds at that moment.
3. **Routing is per node.** With a shared client, an incoming message is delivered to every node whose current
   subscriptions match it (MQTT wildcard rules), and no other.
4. **Cleanup is per flow.** The existing redeploy cleanup (disconnect, clean session) still ends every subscription;
   the registry is module state reset by `deps.forget_modules()`, the same mechanism `ts_wifi` relies on.
5. **Room for a "subscribed" signal.** The suspected boot race (`mqtt-pubsub-boot-race.md`: a publish can reach the
   broker before a sibling's SUBSCRIBE) is best fixed in the same registry, by letting a publish wait for pending
   subscriptions on the same client. Not required by this item, but don't design it out.

## What landed, 2026-10-20

`mqtt_subscribe` is a two-faced package: `kind: "sink"` + `eventSource: true`, with an input and an output. A
**dynamic subscription** boolean property (default off) gates the input face; off is exactly the old behaviour, and
the port is simply unwired in saved flows. `msg.action` is `subscribe` or `unsubscribe`, `msg.topic` a string, a
`{topic, qos}` object, or a list of either. `connect`/`disconnect`/`getSubscriptions` are deliberately not supported
yet -- `ts_mqtt` has no disconnect that leaves WiFi alone, and the output face would need a way to carry a
subscription list -- and any other action raises a clear error. The configured topic is subscribed at start; an
action changes the set.
Unsubscribing the configured topic lasts until the next reload.

The input face reports an error when dynamic subscription is off, when the action is unknown, or when a topic is
missing. Sibling nodes are independent: `ts_mqtt` only sends the broker an UNSUBSCRIBE when the last node on a topic
lets go.

**Hardware check, 2026-10-20 (ESP32-C3, `.22` broker):** flow with `mqtt_subscribe` on `dyn/a` (dynamic on), a
2s timer publishing to `dyn/b`, and inject/function pairs sending the actions. The initial `dyn/a` subscription
received nothing; an action `{subscribe, dyn/b}` made the `dyn/b` publishes arrive; an action
`{unsubscribe, dyn/b}` stopped them (two messages already in flight/queued at the action were delivered, then
20s quiet). Sibling independence is covered by `ts-mqtt.test.ts`.
