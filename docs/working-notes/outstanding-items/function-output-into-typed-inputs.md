# A function node can't feed `number`/`int`/`string` inputs

Status: open, 2026-10-11. Found during the user docs rewrite (`user-docs-rewrite-briefing.md`, Part 1), while
checking the Wiring section of `working-in-the-editor.md` against `sockets.ts`.

`function`'s output is typed `any` (`function-node.ts`). `NumberSocket`, `IntSocket` and `StringSocket` refuse an
`AnySocket` source (`sockets.ts`, bucket 3); only `bool`, `bytes` and `any` inputs accept it. So a function node
can't be wired into `pwm out`'s `duty` input (`number`), the only `number`-typed input in the node library today.
There is no conversion node, so the user has no way round it in the editor. A computed duty cycle is a common
pattern (dimming from a sensor reading).

The old Wiring section said "without an explicit conversion in between", but no such node exists.

Options to decide:

- Let `any` into `number`/`int` as well, failing on the board with `NODE_ERROR` as `string -> number` already does
  (the same reasoning that let `any` into `bool` and `bytes`).
- A way to declare a function node's output type (per output), as `inject` does with `payloadType`.
- A conversion node.

Docs: `working-in-the-editor.md#wiring` states the rule as it is; `faq.md` has an entry. Update both when this
changes.
