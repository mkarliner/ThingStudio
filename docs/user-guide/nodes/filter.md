# filter

Passes a message on only when it's worth sending, and drops the rest. Messages that pass are unchanged.

## Properties

- **mode** — what counts as worth sending. Default `change`.
    - `change` — the payload differs from the last one passed.
    - `deadband` — the payload is a number that has moved at least **threshold** from the last one passed, up or
      down.
    - `rate` — at least **interval** has passed since the last message passed.
- **threshold** — for `deadband`. Default 1. Must be 0 or more. With 0, every number passes, changed or not.
- **interval (ms)** — for `rate`. Default 1000. Must be 1 or more.
- **ignore first message** — for `change` and `deadband`. Default off. When on, the first message only sets the
  starting value.
- **separately for each topic** — default on. Each `msg.topic` is filtered on its own, with its own last value and
  its own first message.

## Wiring

**Input** — any message.

**Output** — the message, unchanged, when it passes.

## Behavior

`change` compares payloads with Python's `==`, so `1` and `1.0` count as the same.

`deadband` compares with the last value it let through, not the last one it received, so a slow drift passes once it
adds up to the threshold. It reads text such as `"21.5"` as a number, so it works on MQTT payloads; the message still
goes out as the original text. Anything else, including `true` and `false`, is dropped.

`rate` drops extra messages. It doesn't queue them or send them later. The first message always passes.

The node tracks up to 32 topics. After that it forgets them all and starts again, and prints
`FILTER_INFO node=ID more than 32 topics, starting again` once.

## Errors

- **`deadband` gets something that isn't a number.** The message is dropped and the console shows a `[NODE_ERROR]`
  naming this node and `deadband needs a number, got str 'abc'`. It is reported once, then again only after a number
  has arrived. The chain keeps running.
- **A threshold below 0 or an interval below 1.** Deploy stops, naming the node and the property.
