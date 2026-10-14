# Decisions — Subsystem interfaces

Status: detail file, started 2026-10-14 (architecture-review continuation). See `decisions.md` for the index, the
log's scope boundary, and its maintenance rule. Context: `../architecture-review-continuation-briefing.md`.

- **2026-10-14 — The wire protocol is a shared, language-neutral artifact, not prose held together by convention.**
  New top-level `interfaces/` holds the cross-subsystem specs; its first member is `interfaces/protocol/` —
  `SPEC.md` (authoritative for the bytes), `messages.json` (append-only id/name/direction table + `NODE_STATUS`
  states), and `vectors/` (conformance cases). The editor (`editor/test/protocol-conformance.test.ts`), device
  runtime (`device-runtime/test/test_conformance.py`) and backend (`backend/test/test_conformance.py`) all run the
  same vectors, so the three implementations can no longer drift from each other without a red test. This is the
  first concrete **subsystem-interface boundary** the architecture review called for; it is a step toward the
  planned `thingstudio-protocol` component, and is reversible (it adds no new runtime dependency). Rule: change the
  protocol by editing `interfaces/protocol/` first, then every implementation. Checks are semantic (map key order is
  irrelevant); byte-exactness is required only for framing.
- **2026-10-14 — Conformance immediately found a real cross-implementation gap.** The editor's cborg codec can
  encode a CBOR **float**; the device's hand-rolled `device-runtime/src/cbor.py` rejects major type 7 outright. So
  a `VALUE_STREAM.payload` that is a float (every `number`-typed port value) would decrypt fine in the editor and
  fail on the device. Latent only because `VALUE_STREAM` is reserved and not emitted yet, but it is a hard
  constraint on the reserved live-value-streaming type and any future float-carrying field. Resolved for now by
  keeping the vectors within the documented CBOR profile (ints/text/bytes/bool/maps); the gap itself is
  open — see `outstanding-items/wire-float-support.md`.
- **2026-10-14 — `AGENTS.md` gains two sections, and `CLAUDE.md` echoes them.** "Architecture first at subsystem
  interfaces: MVP-ready is not tester-ready" (a known architectural problem is fixed in the change that names it, not
  deferred into technical debt — the one-way-door rule applied to structure), and "Interface specs: read before you
  implement, change only with permission" (read the spec and run its conformance test before touching code that
  emits/parses/stores/transmits what an interface defines; the interface itself changes only with Mike's explicit
  permission, with blast radius stated). Claude Code already imports `AGENTS.md`; `CLAUDE.md` now states the rule
  explicitly so it can't be missed. Recorded in `AGENTS.md`/`CLAUDE.md` themselves.
- **2026-10-14 — Multi-repo decomposition is under investigation, not decided.** The 2026-08-12 "single monorepo"
  decision (`repo-tooling.md`) stands. The review's position: define the interfaces as artifacts first (this file),
  then split repos only where the lifecycle genuinely differs (`device-runtime`, then `protocol`); a repo boundary
  without a spec artifact is worse than the monorepo. No repo has been split.
