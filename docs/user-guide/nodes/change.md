# change

Sets or deletes one value on each message, then passes the message on.

Use it to hold a value between messages (a last reading, a counter set elsewhere) or to copy one into a message.
It is the no-code way to work with the flow store that a **function** node's `flow.get`/`flow.set` uses.

## Properties

- **operation** — `set` or `delete`.
- **target** — `msg property` or `flow variable`.
- **property / name** — the message property or flow variable to change.
- **value from** (set only) — `a literal value`, `another msg property`, or `a flow variable`.
- **literal type** (set from a literal) — `string`, `number` or `bool`.
- **value / source property** — the literal, or the name of the message property / flow variable to copy.

## Behavior

One rule per node. Chain **change** nodes for more than one change.

A flow variable is shared by name across the whole flow: another **change** node and a **function** node using
`flow.get`/`flow.set` see the same value. Flow variables are in RAM and are cleared when the flow is redeployed.

Node context is not offered here; use a **function** node for a value private to that one node.

```text
inject "hello" → change (flow.last = msg.payload) → change (msg.payload = flow.last) → debug
```

The second node reads the value the first one stored, and the debug node prints `hello`.
