# Node conventions

A node moves a message from one point in a flow to the next. These are the rules a custom node follows; the file
format itself is in [Writing custom nodes](custom-nodes.md).

## The message

A message is a dict: `msg = {'payload': ..., 'topic': ..., <anything else>}`.

- **`payload`** is the node's value. It is what the output port's declared type checks against and the one key a
  generic downstream node reads — `debug` prints only `payload`. Put the value you want wired and checked here.
- **`topic`** is a routing string. Set it to a real protocol topic when the node has one, otherwise `''`. Don't put
  the node's own event or state in `topic`; use a named field instead.
- **anything else** rides along under its own name, and only a node written to read that name sees it.

Put one value in `payload` and leave the rest as named fields. The DHT22 example sends the temperature in `payload`
and the humidity in `msg['humidity']`.

## Ports

Port types are `int`, `number`, `bool`, `string`, `bytes` and `any`, the same as built-in nodes, with the same wire
checks. A declared output type must match what the node puts in `payload`. Use `any` when unsure. A custom node has
one input and one output: a source has the output, a sink the input.

## Kind

Every node is one of three kinds:

- **source** — makes its own messages, on the `intervalMs` schedule.
- **transform** — one message in, one out. Return the message, or `None` to stop it.
- **sink** — consumes a message and produces nothing.

## Errors

A runtime error in your Python is reported from the board, attributed to your node. A `transform` that returns
`None` stops that message; anything it passes on continues. The full list is under [Errors](custom-nodes.md#errors)
in Writing custom nodes.

## Limits

A custom node has the following limits:

- A source's `emit` runs on a timer, not on an external event — there are no event-driven custom sources.
- Two instances of the same custom node get independent setup, so don't put two on the same physical resource, such
  as the same pin.
- Your Python runs with the same trust as the `function` node. Read a package before you put it in the folder.
