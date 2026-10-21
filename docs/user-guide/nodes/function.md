# function

Runs your own MicroPython on each message. Use it for anything a dedicated node type doesn't cover.

## Properties

- **code** — the function body, run once per incoming message. `msg` is a dict; `msg['payload']` is what you'll
  usually read and write. Return the (possibly modified) message to pass it on, or nothing to stop it there.
- **outputs** — how many outputs the node has (`outputCount` in the flow file, up to 10).

## Wiring

One input, any message. With more than one output, return an array to route to specific outputs, Node-RED style:

```python
if msg['payload'] > 100:
    return [msg, None]   # output 1 only
else:
    return [None, msg]   # output 2 only
```

- `None` in a slot sends nothing out that output.
- A plain `return msg` (no array) always targets output 1.
- A slot holding a list of messages sends all of them out that one output, in order:
  `return [[msg1, msg2], None]`.
- Returning fewer elements than the node has outputs leaves the missing ones as `None`; returning more ignores the
  extras.

## Behavior

### Context, flow and settings

Three ways to keep state across messages, all available as plain objects inside your code:

- **`context`** — private to this one `function` node. Use it for a counter or running total only this node needs.
- **`flow`** — shared across the whole flow. `flow.set('name', value)` / `flow.get('name')` works from any function
  node, and reads/writes the same store a [change](change.md) node uses by name.
- **`settings`** — saved on the board and survives a reboot. Use it for a value the user changes, such as units or a
  colour scheme. It is namespaced by the flow's name, so a different flow cannot read or overwrite it.
  `settings.get('units', 'kg')` / `settings.set('units', 'lbs')`.

```python
count = context.get('count', 0) + 1
context.set('count', count)
msg['payload'] = count
return msg
```
