# Multiple wires into one node input — not supported today

Mike's ask, from `mikes-questions-and-points.md`'s "Bugs -- priority" section (his own commit `49faf43`, alongside
the wifi-status-completeness line below). Every node input in `editor/src/app/rete/nodes.ts` is single-connection-
only today -- not a Thingstudio bug, Rete's own default: `rete.common.js`'s `Input` constructor takes `(socket,
label, multipleConnections)` and defaults the third arg to `false` (`Output`'s equivalent constructor defaults it
to `true` -- asymmetric on purpose in Rete itself). Every `this.addInput(...)` call across `nodes.ts` (`msg`,
`signal`, `duty`, function-node dynamic inputs, etc.) omits the third argument, uniformly.

**Design call, 2026-09-09 (Mike): every input becomes multi-connection by default, Node-RED-style** -- any number
of wires into one input, messages just arrive whenever each upstream source fires; not opt-in per port/node type.
Tagged **P1**, build before the connection-status-indicator work.

Mechanically simple on the Rete side (pass `true` for the constructor's third argument). The real risk is
`compile.ts`'s codegen for a source's downstream chain and a sink's own handler -- neither was written with "this
input might fire from two unrelated upstream sources" in mind. Check for single-provenance assumptions there
before shipping, not just flip the port flag and assume it works. Multi-input wiring may also matter for testing
the connection-status-indicator work (a status fan-in wanting multiple upstream sources feeding one display) --
see `node-status-indicators.md`.
