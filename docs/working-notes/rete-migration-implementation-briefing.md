# Briefing: Rete migration, Phase 0–1 (implementation)

For the next chat. Read `CLAUDE.md` in full, as always. Then read
`docs/working-notes/rete-migration-decision.md` **in full — it is the
spec for this session**, not background. Also read
`pocs/poc-rete/README.md` in full (the spike being ported from, including
its own gotchas), and `editor/src/app/nodes.ts` and `editor/src/app/main.ts`
before touching anything.

**You do not need to read the design doc in full this time.** The
previous briefing in this chain required that, correctly, because it was
proposing an architecture change. This session is not: the architecture
decision is made and written down. §6 (node model) and §13 (protocol) are
worth having to hand for reference; reading all fifteen sections is not a
good use of the session.

**Model note:** Sonnet. This is mechanical porting against a spike that
already exists and already type-checks, with exactly one piece of genuinely
new logic (the graph adapter, Phase 2). The reasoning-heavy work — whether
to migrate, how, what to leave alone, and the app-platform call — is done
and recorded. Switch back to Opus only if the coupling-boundary claim in
the decision doc turns out to be wrong (see "Stop conditions" below).

## What kind of session this is

Implementation, first pass. Phases 0–1 of the decision doc's scoped task
list: install and ledger the packages, then build the Rete canvas layer —
node classes, per-type Vue components, editor setup, palette sidebar.

**The existing Litegraph editor must stay runnable throughout.** Build the
Rete canvas alongside it; do not delete or disable the Litegraph path.
That parallel-path discipline is the whole risk-management story in the
decision doc and it is not tidiness to be optimized away — the cutover
happens in a later session, on the evidence of a hardware round-trip.

**If the session has room after Phase 1, Phase 2 (the adapter) is the
natural continuation** and is fully off-device testable, which suits a
sandbox well. **Stop before Phase 3.** Phase 3 is where `main.ts` starts
being rewritten and the Litegraph path starts going away; it deserves its
own session with the parallel-path constraint front of mind.

## What to actually do

The decision doc's Phase 0 and Phase 1 lists are the task list — follow
them rather than re-deriving. Five things it's worth calling out here
because they're where this will actually go wrong:

- **The node-type sets don't match, and this trips people up.** poc-rete
  has five *fake* types: inject, function, gpio out, **mqtt out**, debug.
  The real editor has five *real* ones: inject, function, debug, gpio_out,
  **timer**. So four port across directly, **`mqtt out` is discarded**
  (the canvas never exposed it, even though `node-library/mqtt-publish.ts`
  exists), and **`timer` has to be built fresh** — poc-rete has no
  equivalent to copy. Check this before assuming a 1:1 port.
- **`node.properties` must match each `node-library/*.ts` codegen
  exactly**, or the compiler silently produces wrong output rather than
  failing loudly: `inject` → `payloadType`/`payloadValue`/`repeat`;
  `function` → `code`; `debug` → none at all; `gpio_out` → `pin`;
  `timer` → `intervalMs`. `nodes.ts`'s own header documents this contract
  — reread it, don't infer from the Rete side.
- **Use the real editor's colour palette, not poc-c's.** They differ:
  `debug` is `#2e4a6e`/`#1f2c3f` here versus poc-c's grey, and `timer`
  (`#5b3b6e`/`#331f3f`) has no poc-c equivalent at all. The values are in
  `nodes.ts`; the decision doc's Phase 1 step 5 lists them.
- **Declared `width`/`height` are a real clipping budget in Rete's classic
  preset**, not layout hints the way Litegraph's `size` is. poc-rete's
  README documents this as a hands-on finding (`FunctionNode` at
  `height=70` clipped its own input socket). It never rendered `timer`, so
  that type's sizing is unverified by anyone.
- **Sockets stay `any`-equivalent this session.** See "Not in scope."

## Stop conditions

Stop and flag rather than working around, in each of these:

- **Anything under `editor/src/compiler/`, `editor/src/protocol/`,
  `editor/src/node-library/`, or `editor/src/flow-file/flow-file.ts` needs
  to change.** The entire decision rests on those being canvas-independent.
  If one of them needs touching, the blast-radius claim was wrong and
  that's an Opus-level reassessment, not a patch.
- **Any of the ~20 existing test suites needs modifying to stay green.**
  Same reasoning. They should be untouched and passing.
- **A new npm package looks necessary** beyond the seven already approved.
  `CLAUDE.md`'s flag-and-approve rule has no spike exemption, and this
  isn't even a spike. Specifically do **not** reach for `rete-engine`
  (see "Not in scope") or `rete-dock-plugin` (deliberately dropped, see
  the decision doc's sub-decision 2).

## Real costs and traps to respect

- **Don't run `npm install` or `npm run dev` against the live-mounted
  repo.** `editor-look-and-feel-briefing.md` documents the `node_modules`
  cross-platform corruption this hits. Scratch-install outside the mount,
  verify, copy **source files only** (`.ts`/`.vue`), never `node_modules`.
- **`vite build` does not type-check** — it uses esbuild, which strips
  types rather than checking them. poc-rete learned this the hard way and
  found four real errors once `tsc --noEmit` was actually run. A green
  build proves nothing here.
- **Run `./node_modules/.bin/tsc --noEmit`, not `npx tsc --noEmit`.** The
  repo's own `.gitignore` documents why: some sandboxed `npx` invocations
  swallow the flag and emit `.js` next to every `.ts`. If stray `.js`
  files appear under `editor/src/` or `editor/test/`, that's the symptom —
  they're gitignored, so they won't be committed, but their presence means
  the type check didn't run the way you think it did.
- **Git writes go to Mike as exact commands for a real Terminal.** Reads
  (`status`/`log`/`diff`) from the sandbox are fine. This is the
  `.git/index.lock` permission problem in `CLAUDE.md`, not a style
  preference.
- **`docs/third-party-licenses.md` gets updated in the same change as the
  install**, not batched. The seven packages move out of the poc-rete
  spike section into a real `editor/` runtime-dependency section — they
  are currently filed as spike-only, which stops being true.

## Not in scope for this chat

- **The wire type system.** Ports stay `any`-equivalent. This is the
  single biggest scope-creep risk in the session, because leaving
  `gpio_out` accepting anything looks obviously wrong — and it *is*
  wrong, but it's wrong today too (`nodes.ts` declares every port `"*"`,
  so the shipped editor has no wire type checking at all). §6's real type
  system is its own task, immediately after, deliberately separated so any
  regression stays attributable. Decision doc, sub-decision 3.
- **Drag-to-splice.** poc-rete has a working ~90-line version and it will
  come across eventually, but the trigger question (`nodedragged` vs
  `nodetranslated`) is an unresolved hands-on call of Mike's.
- **`rete-engine` / canvas-side live value propagation.** poc-rete
  hand-rolled `propagate()` only because it had no device. Live values are
  Tier 2 `VALUE_STREAM` work driven by the *device*. The real editor may
  need no execution engine at all — don't install one out of habit.
- **The backend, and anything auth-related.** Decided but unscoped; see
  `rete-migration-decision.md` Decision 2 and
  `transport-auth-design.md`. Disjoint half of `main.ts`.
- **Any new node type**, and Tier 1 reprioritization.
- **Deleting the Litegraph path.** That's Phase 4 step 17, after the
  hardware pass.

## Success criteria

Phase 0 and Phase 1 complete, meaning: seven packages installed and
ledgered; five Rete node classes matching the real property contracts;
per-type Vue components carrying the real palette; editor setup with
multi-select and the checkpoint-1 validation pipe; palette sidebar with
the hand-rolled DnD.

Verification bar: `./node_modules/.bin/tsc --noEmit` clean, a real
`vite build` clean, and the existing test suites untouched and green. The
Litegraph editor still runs.

**What this session cannot establish**, and shouldn't claim: whether the
new canvas actually feels right, and whether it survives a real deploy.
Both are Mike's, on his own machine, and the second one (Phase 4 step 16)
is the only step in the whole plan whose failure would mean the decision
was wrong. Everything before it is reversible.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Flag any new npm package before installing, individually. Git writes get
handed to Mike as exact commands for a real Terminal, never run from the
sandbox. Update `docs/third-party-licenses.md` in the same change as any
dependency decision. Prompt Mike to commit at suitable points — after
Phase 0 lands and again after Phase 1, not once at the end. Fault
handling over happy path: `applyFlowFile`'s skip-and-report behaviour for
unknown node types is load-bearing and must survive its eventual rewrite
(Phase 3, not this session, but don't design it away in Phase 1 either).
