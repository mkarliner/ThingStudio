# Flash-backed runtime-state persistence (was "Tier 2 — live value streaming + flow/state persistence")

Status: split 2026-09-06, during Mike's item-by-item priority pass over `outstanding-items.md`. The original item
bundled three separate things under one "Tier 2" heading; each has its own status now:

1. **The flow's own bytecode surviving power loss** — already built (boot-time flow auto-resume, 2026-09-05,
   `decisions/redeploy-network.md`). The old item's "not started at all" framing was stale on this point.
2. **A full live-value-streaming UI** (design doc §5: the device streams a throttled sample of node output values
   back over the transport so wires "light up" with real data while the editor has a flow open) — Mike's call,
   2026-09-06: not actually asked for. The real near-term bar is much smaller: per-node connection-status
   indicators (e.g. is `mqtt_publish` actually connected right now) — tracked as its own item,
   `node-status-indicators.md`, in the "UI / editor" section of the top-level index. Full wire-value streaming
   stays theoretically open (design doc §5 still describes it) but isn't being pursued as active work.
3. **This file's remaining scope: a flash-backed, node-ID-keyed key/value store for runtime state** — a
   `variable_get`/`variable_set` value, a calibration constant a node computes and wants to keep, surviving a
   redeploy by default (design doc §5's own framing: "a running average shouldn't reset just because the flow was
   tweaked and pushed again," with a per-node opt-out for where that default is wrong). Not built — today's
   `variable_get`/`variable_set` store (`_flow_vars`) is in-RAM only, wiped on every redeploy or power cycle
   (`variable-set.ts`'s own header).

**Deferred past MVP, 2026-09-06 (Mike's call):** this needs real design thinking before it's buildable —
storage format, how opt-out-on-deploy is expressed, what happens when a node's ID changes or a node is deleted
with stored state still on flash. **2026-09-06, Mike's call when prioritizing:** deliberately sequenced after `context-model-node-red-style.md`
(tagged **[P2]**, pre-MVP) rather than together with it -- that item settles the volatile-storage scope/API shape
first (node/flow/global scope, a generic setting mechanism); this item plugs in a flash-backed storage backend
underneath the same API once it exists, Node-RED's own `contextStorage` pattern (`memory` vs `localfilesystem` as
interchangeable backends) is the model for how the two fit together without needing to be built as one item.
