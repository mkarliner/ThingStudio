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

**Implemented, 2026-09-10.** Every `new ClassicPreset.Input(...)` call in `nodes.ts` now passes `true` as the
`multipleConnections` argument (10 call sites: `function`/`delay`/`debug`/`gpio_out`/`pwm_out`/`udp_send`/
`http_request`/`http_response`/`mqtt_publish`, plus `CustomNode`'s dynamic descriptor-driven inputs). The
codegen-risk check this item's own scope called for turned out to be a non-issue on inspection: `compile.ts`'s
header comment already documents fan-in as a deliberate, tested DAG-compiler feature from day one (no
single-provenance assumption anywhere), and `compiler.general.test.ts`'s pre-existing "fan-in: two independent
sources sharing one gpio_out sink" test already proved it -- a shared node's function is generated exactly once
and called once per incoming path, matching Node-RED's own semantics. `graph-adapter.ts`'s `toGraphData()` and
`main.ts`'s flow-file `edges` builder both already map over every `editor.getConnections()` entry with no
per-input uniqueness assumption either. The only real behavior change is in the interactive canvas: Rete's
`rete-connection-plugin`'s `syncConnections()` used to silently REPLACE an input's existing wire with a newly
dropped one on the same socket when `multipleConnections` was `false` (not a hard rejection -- "can't connect two
wires" was actually "the second wire silently evicts the first," confirmed by reading that plugin's own source).
With `true`, that auto-eviction is skipped for the port -- built-in library behavior, nothing bespoke needed.

New test file `editor/test/multi-connection-inputs.test.ts` (headless, no DOM -- same discipline as
`graph-adapter.test.ts`): one test per input-bearing node class confirming `multipleConnections === true`, plus an
end-to-end test wiring two independent `inject` sources into one `debug` node's single input and running the
compiled Python, confirming both messages fire and the sink's function is generated exactly once.
`docs/user-guide/canvas-basics.md` updated. **Not yet real-browser verified** -- the interactive drag/drop
behavior itself (a second wire actually landing instead of evicting the first, on a real drag gesture) is Mike's-
own-hands-on-pass territory, same as every other canvas-drag behavior in this codebase; this headless suite
can't reach that layer at all.
