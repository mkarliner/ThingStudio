# `convert` node — explicit port-type conversion

Status: open, 2026-10-11. From the typed-port discussion (a session with Mike): the wire-type system
(`editor/src/app/rete/sockets.ts`, bucket 3) refuses conversions it can't do safely and points at "an explicit
conversion node" — which was never built. This is that node.

## Why

`sockets.ts` refuses conversions that need a decision, all with the same "an explicit conversion node" answer:

- **`bytes` ↔ `string`** — the encoding is a real choice (utf-8? raw?).
- **`any` → a concrete type** (`number`/`int`/`string`) — genuinely ambiguous for an arbitrary value.
- (`number` → `int` is refused for silent truncation; `string` → `number` is allowed but can fault at runtime.)

Without the node, a flow has no way to make these wires. The concrete pain: a `function` output is `any`, so it
can't drive `pwm out`'s `number` input at all (`function-output-into-typed-inputs.md`).

## Shape (to decide)

A `transform` with a **`to`** property (`number`, `int`, `string`, `bytes`, `bool`) and a per-target option or two
(string encoding; int rounding). Input `any`/`bytes`/`string`; output the chosen type. On a value it can't convert,
it faults with a `NODE_ERROR` naming the value and the target — not a raise (the project's fault-handling priority).

## Related, from the same discussion

The cheaper fix may be to stop *refusing* wires that can only be validated at runtime: allow `any` into every
concrete input and let the existing runtime `NODE_ERROR` catch a genuine mismatch, exactly as `string → number`
already does. That alone unblocks `function` → `pwm out`. The `convert` node is still worth having for the genuine
ambiguity cases (encoding, rounding), but less urgent if `any` is opened up. Decide the two together.

Docs to update when this lands: `working-in-the-editor.md` (Wiring), `faq.md`.
