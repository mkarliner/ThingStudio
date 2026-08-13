# Briefing: wire protocol (§13) implementation

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `6f8c200`.

## Where things stand

A prior session resolved design doc §11's open questions (MicroPython
over CircuitPython, human-readable generated code, no function-node
sandboxing, node distribution deferred, no simulation mode, USB-only
runtime updates, precompiled bytecode over raw-source deploy), then
produced the MVP feature list, a validation plan (including a two-ESP32
hardware-in-the-loop witness/DUT rig design), and a repo structure
decision. It then started building real v1 code against that plan:

- **`editor/src/compiler/`** — the general graph → Python compiler
  (design doc §6), replacing `pocs/poc-d/compiler.js`'s hardcoded
  single-shape version. Per-node-type codegen registry
  (`node-definition.ts`) plus a topological compiler (`compile.ts`).
  Regression-tested against POC-D's exact flow, plus adversarial and
  beyond-POC-D-shape tests. 20 of the 23 current tests are this piece.
- **`editor/src/protocol/envelope.ts`** — the `msg` envelope as real
  TypeScript types (typed payload, topic, extra properties) with an
  exhaustive 6×6 type-compatibility matrix test.
- **`device-runtime/src/runtime.py`** — deliberately minimal: just the
  `spawn()`/`asyncio` contract the compiler's generated code imports.
  Not the real listener/protocol handler — that needs hardware to build
  against safely (see "Not in scope" below).
- Housekeeping: `LICENSE` (Apache-2.0) + SPDX headers, `mpy-cross-wasm/`
  vendored from `pocs/poc-b/` (byte-identical copy, not a fresh build),
  `.github/workflows/ci.yml` (editor tests only — device-runtime and
  hardware-in-the-loop tests aren't wired up), and
  `docs/third-party-licenses.md` (a living dependency ledger, kept
  current per a `CLAUDE.md` rule).

23/23 tests passing, `tsc --noEmit` clean, as of the commit above.

Full detail, don't re-derive any of this from scratch:
- `docs/working-notes/mvp-feature-priorities.md` — the tiered feature
  list. Tier 0 (foundations) is what this briefing continues.
- `docs/working-notes/validation/mvp-validation-plan.md` — per-tier
  validation criteria plus dated Results (the compiler's entry is a
  model for how to write this task's entry when it's done, including
  what to honestly flag as *not* covered).
- `docs/working-notes/repo-structure-and-conventions.md` — repo layout,
  language/tooling decisions, CI split (automated vs. needs-hardware).
- `docs/working-notes/node-definition-model.md` — the node-authoring
  contract the compiler implements.

## The task: the real wire protocol (§13)

Two of Tier 0's four foundations are done (general compiler, msg
envelope). This is the third: replace POC-A/D's ad hoc text/base64
protocol with the real one design doc §13 sketches.

### What §13 actually specifies

- **Framing**: 2-byte length header + payload, identical across
  serial/BLE/WiFi so higher layers don't need to know which transport
  they're on. 1-byte message type + CBOR-encoded body.
- **Message types**: `HELLO` (device→editor on connect: chip type,
  runtime version as major.minor.patch, free flash/RAM — lets the editor
  warn before a flow is too big); `DEPLOY` (editor→device: full flow
  bytecode + static data, full-flow replace, matching §8's "start with
  full redeploy" call); `DEPLOY_ACK`/`DEPLOY_ERROR`; `VALUE_STREAM`
  (device→editor, throttled live port values); `NODE_ERROR`
  (device→editor, the fault-isolation report — node ID + exception
  type/message); `STATE_READ`/`STATE_WRITE` (persisted variable store,
  no full redeploy needed).
- `HELLO`'s major.minor.patch is load-bearing, not decorative: the
  editor compares it before sending `DEPLOY` and warns if a major
  mismatch means the device will wipe the flow and state store (the
  policy §5/§11 already resolved — this protocol just has to carry the
  version field that policy depends on).
- **Deliberately not fixed yet, don't invent them**: auth/pairing fields
  (depends on an unbuilt WiFi pairing design) and OTA mechanics
  (deferred to v2, per §11's resolution).

### Validation plan's Tier 0 bar for this (already written — §"Real wire
protocol (§13)" in `mvp-validation-plan.md`, don't re-derive)

- CBOR round-trip for every message type, "both sides" per the plan's
  wording — but in practice, **only the browser/JS side is buildable
  right now**. There's no real device-side protocol handler anywhere in
  this repo yet (`device-runtime/src/runtime.py` is just the stub the
  compiler's output imports). Building the JS-side message types +
  framing + CBOR codec, with real adversarial tests, is the actual scope
  here. The Python-side listener is real Tier 0 work too (see "Fault
  isolation" in the validation plan) but is a separate, larger piece
  that also needs hardware to validate safely — don't try to do both in
  one pass.
- **Adversarial framing** (fully testable in JS against your own
  encoder/decoder, no device needed): truncated frames, oversized length
  headers, garbage bytes, one frame split across multiple reads,
  multiple frames arriving in one read. Every case should degrade to a
  logged/recoverable error, never a hang or a crash — matches the
  compiler's own "reject cleanly, don't misbehave silently" bar.
- **Version-handshake matrix**: every device/editor major.minor.patch
  combination produces the correct outcome (safe deploy allowed, or
  blocked with the right wipe warning).
- **Hardware pass**: explicitly out of scope for this chat if it's
  running in a sandbox without attached hardware — leave it `(pending)`
  in the validation plan's Results entry, same honesty convention the
  compiler's entry already models (it flags mpy-cross cross-compilation
  as not yet exercised, for the same reason).

### First real decision before writing code

No CBOR library is chosen yet — `repo-structure-and-conventions.md`
names this as an explicit open gap. Pick one (small, well-maintained,
permissively licensed to clear design doc §12's bar), flag it per
`CLAUDE.md`'s standing rule (name it, why, `npm install --ignore-scripts`,
and add it to `docs/third-party-licenses.md` in the same change — don't
batch that update for later).

### Where this code goes

`editor/src/protocol/` already exists (`envelope.ts` lives there). Wire
protocol code — message types, framing, the CBOR codec — belongs
alongside it. Exact file breakdown is this chat's call, not prescribed
here.

## Conventions to keep following (all established this repo — don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints (a coherent
  unit landing, before something new/risky, end of session); flag any
  npm package before installing (`--ignore-scripts`; run `npx` with
  `--no` unless the package is already a project dependency — this
  closed a real incident earlier, see the git log around commit
  `0649c95`); update `docs/third-party-licenses.md` in the same change
  as any new dependency, not after.
- Off-device first, with adversarial/malformed input, before any claim
  of "done." `tsc --noEmit` and the full test suite green before every
  commit.
- Dated Results entries appended to `mvp-validation-plan.md`'s relevant
  section once actually verified — honest about what isn't covered
  rather than silently implying more than what was tested.
- This environment (whichever sandbox runs this chat) may have no
  MicroPython and no attached hardware, same constraint the compiler
  work hit — same honesty about it in whatever gets written and
  committed.

## Not in scope for this chat

- The device-side listener/protocol handler and fault isolation — needs
  the witness+DUT rig, tracked separately in the validation plan.
- The OTA-capable-partition-table hedge — needs an actual firmware build
  step that doesn't exist yet.
- Tier 1 (the node set) — Tier 0 isn't finished until this task and
  fault isolation both land.
