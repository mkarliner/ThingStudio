# MQTT dynamic subscription (subscribe/unsubscribe at run time)

Added 2026-10-19, from Mike's question "on mqtt -- how do I unsubscribe?" and the reviewer's answer
(`reviews/2026-10-19-reply-review-and-smoke-test.md` follow-up, same session). **Status: requirement, not scoped
or built.** Priority is Mike's call.

## Today

An `mqtt_subscribe` node is a source with a fixed `topic`. It subscribes once when the flow starts and stays
subscribed until the flow stops; it has no input. The only way to stop receiving is to delete the node (or change
its topic) and redeploy, or remove the flow. On redeploy the shared client's `runtime.register_cleanup` handler
disconnects from the broker, and the client starts each connection with a clean session (`clean_init: True` in
the vendored `mqtt_as` config), so the broker drops the subscription. Filtering messages out downstream with a
`function` node is a workaround; the board still receives them.

## The gap

Node-RED's `mqtt in` node has a "dynamic subscription" mode: the node gains an input, and messages with
`msg.action` (`subscribe`, `unsubscribe`, `connect`, `disconnect`) and `msg.topic` change what it listens to at run
time. Check Node-RED's current docs for the exact action set and `msg.topic` forms (a string, a list, `true` for
"all") before building; mimic it as far as is reasonable (the project's Node-RED rule).

The vendored `mqtt_as` already has `unsubscribe(topic)` (`device-runtime/src/vendor/mqtt_as/__init__.py`), so no
board-side capability is missing.

## Design requirements (bind `ts_mqtt`, which is being designed now)

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

## Node shape when built

Dynamic subscription makes `mqtt_subscribe` **two-faced**: an input face that takes action messages and an output
face that emits received messages. That is the same capability as `ntp` needs -- `eventSource: true` on a `sink` in
the package format (`reviews/2026-10-19-reply-review-and-smoke-test.md` §4). If that lands first, dynamic
subscription is a small addition to the `mqtt_subscribe` package. Likely a property (Node-RED's "dynamic
subscription" choice) that switches the input on; with it off, the node behaves exactly as today, so saved flows
are unaffected.
