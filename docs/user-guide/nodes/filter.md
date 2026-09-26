# filter

Passes a message on only when it's worth sending, and drops the rest. Messages that pass are unchanged.

## Properties

- **mode** — what counts as worth sending:
    - `change` — the payload differs from the last one passed.
    - `deadband` — the payload is a number that has moved at least **threshold** from the last one passed,
      up or down.
    - `rate` — at least **interval** has passed since the last message passed.
- **threshold** — for `deadband`. A number of 0 or more. 0 passes any change.
- **interval (ms)** — for `rate`.
- **ignore first message** — for `change` and `deadband`. The first message only sets the starting value.
- **separately for each topic** — on by default. Each `msg.topic` is filtered on its own.

## Behavior

Deadband compares with the last value it let through, not the last one it received. A slow drift is
passed once it adds up to the threshold.

Deadband reads text such as `"21.5"` as a number, so it works on MQTT payloads. The message still goes
out as the original text. Anything else, including `true`/`false`, is dropped. The first time that
happens, the node reports an error; the flow keeps running.

`rate` drops extra messages. It doesn't queue them or send them later.

A node tracks up to 32 topics. After that it forgets them all and starts again, and says so once in
the console.

Everything resets when you deploy or the board restarts.

## Example

A temperature sensor read every second, into a `filter` in `deadband` mode with threshold `0.5`, into
`mqtt publish`. The broker only hears about changes of half a degree or more.
