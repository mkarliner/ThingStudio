# function

Runs your own MicroPython on each message, for anything no other node does.

## Properties

- **code** — the body of a Python function, run once for each message. Default `msg['payload'] = msg['payload']`
  followed by `return msg`. Required.
- **outputs** — how many outputs the node has, 1 to 10. Default 1. `outputCount` in the flow file.

## Wiring

**Input** — any message, as `msg`: a dict with the main value in `msg['payload']`.

**Output** — what the code returns. Return the message to pass it on, or return `None` or nothing to stop it. Every
output has type `any` (see [Wiring](../working-in-the-editor.md#wiring)).

With more than one output, return a list with one entry per output, as in Node-RED:

```python
if msg['payload'] > 100:
    return [msg, None]   # output 1 only
return [None, msg]       # output 2 only
```

The returned list is read entry by entry:

- `None` sends nothing on that output.
- A list of messages sends each of them on that output, in order: `return [[msg1, msg2], None]`.
- A list shorter than the number of outputs leaves the rest empty. Entries past the last output are ignored.
- A plain `return msg`, not in a list, goes to output 1.

With one output, a returned list is passed on as the message itself. Set **outputs** to 2 or more to use the list.

## Behavior

The code is the body of an `async def`, so `return` and `await` work at its top level. `asyncio` and `runtime` are
already defined; import anything else in the code, such as `import machine`. A library ThingStudio provides, such as
`mqtt_as`, is installed on the board when you deploy (see [Libraries](../flow-lifecycle.md#libraries)).

Don't call `time.sleep()` or run a long loop: either stops every other chain while it runs. Use
`await asyncio.sleep(1)` instead (see [The one rule: don't block](../background/event-driven.md#the-one-rule-dont-block)).

Local variables start again for every message. Keep values between messages in `context`, `flow` or `settings`.

### Context, flow and settings

Three stores keep values between messages, each with `get(name, default)` and `set(name, value)`:

- **`context`** — this node only. Two `function` nodes using the same name don't share it.
- **`flow`** — shared by every `function` and [change](change.md) node in the flow, by name.
- **`settings`** — saved on the board, so it survives a restart and a redeploy of the same flow. It is
  `runtime.settings`; see [Persisting values](../custom-nodes.md#persisting-values) for what else it does.

`context` and `flow` start empty each time the flow starts.

```python
count = context.get('count', 0) + 1
context.set('count', count)
msg['payload'] = count
return msg
```

## Errors

- **The code is empty.** Deploy stops with `function node's code is empty`.
- **The code has a syntax error.** Deploy stops and highlights the node.
- **The code raises an exception.** The console shows a `[NODE_ERROR]` naming this node and the exception, and the
  chain stops. See [Reading a node error](../debugging.md#reading-a-node-error).
