# change

Sets or deletes one value, on the message or in a flow variable, then passes the message on.

## Properties

- **operation** — `set` or `delete`. Default `set`.
- **target** — `msg property` or `flow variable`. Default `msg property`.
- **property / name** — the message property or flow variable to change. Default `payload`. Required. A leading
  `msg.` or `flow.` is dropped. The name is one top-level key: `payload.temp` names a property called
  `payload.temp`, not `temp` inside `payload`.
- **value from** — with `set`: `a literal value`, `another msg property` or `a flow variable`. Default
  `a literal value`.
- **literal type** — with a literal: `string`, `number` or `bool`. Default `string`.
- **value / source property** — with `set`: the literal, or the name of the message property or flow variable to
  copy. Default empty. A `bool` literal is true only for `true`. An empty `number` literal is `0`.

## Wiring

**Input** — any message.

**Output** — the same message, changed when the target is a message property.

## Behavior

One rule per node. Chain `change` nodes for more than one change.

A flow variable is shared by name with every other `change` node and with a [function](function.md) node's
`flow.get` and `flow.set`. There is no node-private store here; use a `function` node's `context` for that.

Copying a property or flow variable that doesn't exist sets the target to `None`. Deleting one that doesn't exist
does nothing.

## Errors

These stop the deploy:

- No property or flow variable name: `change needs a property or variable name`.
- No source name when copying: `change needs a source property or variable name`.
- A `number` literal that isn't a number: `change value "abc" is not a valid number`.
