# Briefing: §6 wire-type system — implementation

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** Landed (`git log`:
> "Implement §6 wire-type system"). Kept for historical reference, not
> active reading.

For the next chat. Read `CLAUDE.md` in full, as always. Then read
`docs/working-notes/wire-type-system-scoping.md` **in full — this is the
spec for this session.** It reads as a scoping note by title but is
decision-complete: every open question in it was resolved in conversation
the same day it was written, including a self-correction partway through
(an `any → bool` rule that contradicted itself in an earlier draft — fixed
in the file, but worth knowing that history exists if something in the
matrix looks like it's arguing with itself, it isn't, that was already
caught). Its own closing line says the next session "can go straight to
the blast radius... without re-litigating the matrix" — that's this
session.

You do not need to read `backend-platform-decision.md`,
`backend-editor-auth-and-protocol.md`, `transport-auth-design.md`, or the
current `deployment-and-distribution-notes.md` addendum — all from the
same day, all a completely separate thread (backend platform/auth), zero
overlap with this session's work. Design doc §6 is already quoted in full
inside the scoping note where it matters; a targeted look rather than a
full design-doc re-read should be enough, since this session implements an
already-decided architecture change rather than proposing a new one.

## What kind of session this is

Implementation, the first real code since the Rete migration closed out.
Genuinely lower-risk than that migration was: the scoping note's own
governing call is "ship narrow and loose," and its scope-of-protection
analysis found that **nothing in today's actual 5-node canvas can hit a
refuse case** — `gpio_out`'s `signal` is the only concretely-typed input
that exists, and `any → bool` (the fix applied mid-session) means every
real connection reachable today stays allowed. So this is closer to
"add typed infrastructure behind existing behavior" than "change what the
editor accepts." The one thing that would be a real reassessment trigger:
**if implementing this actually produces a connection refusal somewhere in
the current inject/function/debug/gpio_out/timer canvas.** The scoping
note claims that can't happen — if it does, that claim was wrong, and
that's worth stopping and understanding before working around it, not
patching over. Sonnet is fine for this.

## What to actually do

The scoping note's own "Governing call and rough blast radius" section is
the task list, close to verbatim:

- **`editor/src/app/rete/sockets.ts`** — real socket classes (`Bool`,
  `Number`, `Int`, `String`, `Bytes`, `Any`) with coercion-aware
  `isCompatibleWith`, replacing the single always-true `AnySocket`. The
  three-bucket matrix (truthiness into `bool` from every type including
  `any`; `int → number` allowed, `number → int` refused, `string →
  number`/`int` allowed-but-can-fail-at-runtime; `bytes ↔ string` and
  `any → number`/`string`/`bytes` refused) is the exact rule set — don't
  re-derive it, it's in the note's coercion-matrix table.
- **`editor/src/compiler/node-definition.ts`** — add a `ports` field to
  `NodeDefinition` (name + payload type per input/output). The note
  frames this as the compiler and editor sharing one declaration rather
  than two that can drift; confirm that framing still holds once it's
  actually written, per the note's own caveat about it.
- **The 5 currently-canvas `node-library/*.ts` files** — `inject.ts`,
  `function-node.ts`, `debug.ts`, `gpio-out.ts`, `timer.ts` — declare
  their ports' types against the new field. The other 11 registered node
  types stay untouched (out of scope, per the note's question 5
  resolution).
- **`editor/src/app/rete/nodes.ts`** — read real socket types from the
  node-library ports instead of hardcoding `AnySocket`, plus `inject`'s
  retyping-on-`payloadType`-change mechanic.

**One thing the scoping note leaves genuinely ambiguous, worth resolving
explicitly rather than guessing: the retyping mechanic (drop the
now-invalid wire, flag via the highlight mechanism) is described as
"dormant until it's reachable" since nothing in today's node set can
actually trigger it.** Decide and record which of these this session
does, rather than silently picking one: build it now anyway (future-proof,
untestable hands-on today), or write the rule down as intent and leave the
actual mechanic for whenever a node that can trigger it exists. Either is
defensible; picking one silently isn't.

**No conversion node, no compiler codegen changes** — both explicitly
deferred/not-needed per the note (questions 4 and the "governing call"
section). Don't build either.

## Stop conditions

- **A connection refusal appears anywhere in the current 5-node canvas.**
  The note's own scope-of-protection analysis says this shouldn't happen;
  if it does, the analysis was wrong somewhere, worth understanding before
  proceeding.
- **`compiler/node-definition.ts`'s new `ports` field turns out to need
  the compiler's graph-walk logic to actually read it**, contradicting the
  note's "the compiler already trusts the graph it's handed, this is
  editor-side only" framing. Flag rather than quietly wire it in.
- **Any of the ~20 existing test suites needs modifying.** None should,
  per the same reasoning as every prior session's stop condition — if one
  does, that's new information, not something to accommodate.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always.** Same standing bug
  — the sandbox cannot delete or commit on the live-mounted repo
  (`Operation not permitted`), confirmed repeatedly this same day for both
  file deletion and `git commit`/`git status`'s own lockfile. Read-only
  git commands are fine; expect to hand Mike an `rm -f
  .git/index.lock` afterward even for those.
- **No new npm package should be needed** — this is additive TypeScript
  against existing types, not a new dependency. If something in this task
  turns out to need one, that's a real deviation from the plan, worth
  flagging per CLAUDE.md's npm rules before installing anything.
- **`npm test`/`vite build`/`npm run dev` still can't run from the
  sandbox** (Mac-only native bindings, confirmed structural since the Rete
  migration). `./node_modules/.bin/tsc --noEmit` does work and is this
  session's own verification step — but per the stop conditions above, the
  real verification is Mike's own hands-on pass confirming the existing
  canvas (inject → gpio_out, the fan-out case, a function node in the mix)
  still behaves identically, same bar as every prior session.
- **Prompt Mike to commit at the natural boundary** — after the
  sockets.ts/node-definition.ts/node-library changes land and `tsc
  --noEmit` plus his own build-and-run pass confirm nothing broke.

## Not in scope for this chat

- **The other 11 registered node types** not yet on the canvas — separate
  task, per the scoping note's question 5.
- **A real conversion node** — deferred until a node that needs one
  actually gets added, per question 4.
- **The backend thread entirely** (platform, both auth perimeters,
  WebSocket shape, WebSerial fallback) — fully decided the same day as
  this note but a disjoint piece of work; see the other working notes
  listed above if that's ever picked up instead.
- **The splice-trigger call** (`nodedragged` vs `nodetranslated`) — still
  open, still needs Mike's own hands-on real-browser judgment, not
  resolvable in a sandbox session.

## Success criteria

`sockets.ts` has real, coercion-aware socket types. `node-definition.ts`
carries a `ports` field, populated for the 5 canvas node types. `rete/nodes.ts`
constructs each port from its declared type instead of a hardcoded
`AnySocket`. `./node_modules/.bin/tsc --noEmit` clean. Mike confirms, on
his machine: `vite build`/`npm test`/`npm run dev` clean, and a hands-on
pass shows the existing canvas (inject/function/debug/gpio_out/timer,
including the fan-out case) behaves exactly as it did before this session
— per the scoping note's own claim, nothing here should be visibly
different from the user's side, only real underneath.
