# Custom node authoring — implemented 2026-08-20 (historical record)

**Implemented 2026-08-20** — scoped and built in one session per Mike's sequencing override. Left here as
historical context (what was unknown going in), each "real open question" resolved inline.
`custom-node-authoring-scoping.md`, `docs/user-guide/custom-nodes.md`, `decisions.md`'s "Node authoring /
extensibility" section.

**Original framing (2026-08-19):** letting users create and register their own node types without rebuilding the
whole system. `docs/thingstudio-design-doc.md` §7 already lays the conceptual groundwork: a node is just two
halves — a small JSON descriptor for the editor (palette entry, ports, property UI) plus a Python module
implementing its behavior — and because node logic is ordinary precompiled `.mpy`, not baked into the firmware
image, §7's own framing is that adding a node type should be "a matter of pushing a new `.mpy` module to the
device's filesystem alongside the flow, not rebuilding and reflashing the runtime." §11 explicitly defers the
*mechanism* past v1.

Real open questions, as of 2026-08-19 — each now resolved:

- **Distribution mechanism.** **Resolved 2026-08-20: no new wire protocol.** Custom node Python is inlined into the
  existing DEPLOY-compiled flow module, same as any first-party node's generated code — §11's module-push sketch
  stays deferred until a real need (shared-across-flows, size) forces it, not built now.
  `custom-node-authoring-scoping.md` Decision 1.
- **Editor-side discovery/registration** — how the editor's palette picks up a node it didn't ship with; nothing
  like this existed in `editor/src/node-library/registry.ts`, a static, compiled-in list. **Resolved 2026-08-20:
  session-scoped browser file picker, no persistence.** A two-file package (`<name>.node.json` + `<name>.node.py`)
  loaded via the File System Access API multi-file picker into a new reactive store
  (`app/rete/custom-nodes-store.ts`), parallel to but deliberately separate from the config-node store — not
  cleared by "clear canvas," not saved/reloaded across sessions. `custom-node-authoring-scoping.md` Decision 4.
  **Persistence-across-app-runs half scoped 2026-08-21, still not built:** backend-owned `~/.thingstudio` folder,
  waits for the backend (now MVP-needed, see `backend-auth-overview.md`). `local-persistence-scoping.md`.
- **Whether the compiler/editor contract extends cleanly to third-party-authored nodes** —
  `node-definition-model.md`'s `NodeDefinition` contract (type ID, ports, properties, codegen hook, claimed
  resources) and the wire-type system's coercion rules (`wire-type-system-scoping.md`) were both designed and
  built assuming every node type is first-party; whether a user-authored node could declare ports/types through
  the same contract was unexplored. **Resolved 2026-08-20: yes, cleanly, via a generic builder.**
  `buildCustomNodeDefinition()` (`node-library/custom-node.ts`) wraps one instance's `.node.py` text in a
  per-instance closure and returns an ordinary `NodeDefinition` — indistinguishable to `compile.ts` from a
  first-party registry entry; zero compiler-core changes needed. Output ports capped at 1 by this builder's own
  codegen validation (not the wire-type system or the package format), specifically so it doesn't foreclose the
  multi-output-routing item (`connection-state-gate-router-nodes.md`). `custom-node-authoring-scoping.md`
  Decisions 2 and 3.
- **The likely trigger for §11's dormant function-node-sandboxing question.** §11 resolved "no hardening for v1"
  specifically because v1 has no marketplace or shared-flow mechanism. **Resolved 2026-08-20, Mike's explicit call:
  no hardening, same as the `function` node — "go with the trust-boundary call (until it bites us)."** Custom nodes
  don't cross the existing deploy-access trust perimeter (§9); loading stays session-scoped only, no registry or
  URL-install mechanism exists or is planned. Revisit if real pain shows, not preemptively.
  `custom-node-authoring-scoping.md` Decision 5.
