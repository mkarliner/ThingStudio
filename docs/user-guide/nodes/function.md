# function

Runs your own MicroPython on each message. The most flexible node in the library — anything not covered by a dedicated node type usually belongs here.

## Properties

- **code** — the function body, run once per incoming message. `msg` is a dict; `msg['payload']` is what you'll usually read and write. Return the (possibly modified) message to pass it on, or nothing to stop it there.

## Context and flow variables

Two ways to keep state across messages, both available as plain objects inside your code:

- **`context`** — private to this one `function` node. Use it for a counter or running total only this node needs.
- **`flow`** — shared across the whole flow. `flow.set('name', value)` / `flow.get('name')` works from any function node, and reads/writes the same store a `variable_get`/`variable_set` node uses by name.

```python
count = context.get('count', 0) + 1
context.set('count', count)
msg['payload'] = count
return msg
```
