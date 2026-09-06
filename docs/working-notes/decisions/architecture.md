# Decisions — Architecture

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-11 — MicroPython over CircuitPython.** Already validated
  end-to-end by POC-A/B/D against stock MicroPython; re-spiking
  CircuitPython would strand that validation for an unlikely win.
  `thingstudio-design-doc.md` §11.
- **2026-08-11 — Litegraph.js over Drawflow for the canvas (POC-C).**
  Native type-checked wiring, live value propagation, multi-select;
  Drawflow needed all three hand-rolled. **Reversed 2026-08-16** — see
  below.
- **2026-08-16 — Rete.js over Litegraph.js (reversal of the above).**
  Not a correction of POC-C's method — a maintenance/ecosystem finding
  POC-C wasn't scoped to weigh: Litegraph is a vendored, unmaintained
  single file; Rete is a real, actively-installed npm package set.
  `rete-migration-decision.md`, `thingstudio-design-doc.md` §11.
- **2026-08-11 — Human-readable generated Python, not a compact
  intermediate form.** `mpy-cross` compile latency is sub-millisecond
  regardless of source verbosity, so compactness buys nothing; readable
  source keeps `NODE_ERROR` reports traceable. `thingstudio-design-doc.md`
  §11.
- **2026-08-11 — No function-node sandboxing for v1.** No marketplace or
  shared-flow mechanism exists yet, so the only stated reason to harden it
  doesn't apply. Revisit if/when one is scoped. §11.
- **2026-08-11 — No node distribution/versioning system for v1.** v1's
  node set is fixed at flash time as part of the runtime image; a node's
  "version" is just the runtime image's version, already carried by
  `HELLO`. §11.
- **2026-08-11 — No no-hardware simulation mode, ever — not deferred, out
  of the project's roadmap entirely.** Real hardware doesn't behave like a
  simulator; POC-D's own hardware-only bug list is exactly what a
  simulator wouldn't catch. §11.
- **2026-08-11 — USB-only runtime image updates for v1; OTA deferred to
  v2.** No wireless transport exists yet for OTA to ride on. One hedge
  taken now regardless: reserve OTA-capable ESP32 partitions from the
  first flash (still not actually done — see `outstanding-items.md`). §11.
- **2026-08-12 — Precompiled `.mpy` bytecode over raw-source `exec()`.**
  Not a latency call (POC-A showed raw-source is fast enough) — a RAM
  call: on-device compilation needs RAM on top of what the compiled code
  needs, and can OOM a constrained board even when the bytecode runs fine.
  §15.1 addendum.
