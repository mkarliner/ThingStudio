# Briefing: bare-minimum editor, hands-on hardware pass in progress

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `f14d615`.

## Where things stand

Tier 0 and Tier 1's node-authoring work (software-only, GPIO/timer,
network batches) are all done and hardware-confirmed — see
`tier1-sensors-network-briefing.md` and `mvp-validation-plan.md` for that
history, unchanged by this session. Don't re-derive any of it.

**New this session:** a first, deliberately bare-minimum real editor —
Mike's explicit next goal was "create, edit, and run a flow myself,
however naively," not more node types. This is the first hands-on,
human-driven session (Mike interactively testing in his own browser
against his already-flashed board), not another off-device-then-HIL-batch
cycle — expect it to keep going interactively in whatever chat picks this
up, not to be "finished" as a discrete deliverable the way a node batch
was.

## What exists now (don't rebuild)

- `editor/index.html` + `editor/src/app/{main,nodes}.ts` — a real
  Litegraph canvas, four node types (`inject`, `function`, `debug`,
  `gpio_out`) wired to the **actual** `node-library`/`compile.ts`
  registry (not a hardcoded shape like POC-D's compiler). Toolbar:
  add-node buttons, Connect, Deploy. Sidebar: compiled-source preview
  (polled every 1s, not push-based — see main.ts comment on why), device
  console (`onMessage`/`onDebugLine`/`onProtocolError` from
  `transport.ts`).
- Deploy runs the real pipeline: `graph.serialize()` → `compile()` →
  mpy-cross WASM cross-compile → real §13 `DEPLOY` over WebSerial via
  `transport.ts` → waits on `DEPLOY_ACK`/`DEPLOY_ERROR` (30s timeout).
- **Deliberately not built**, per explicit scope: `HELLO`/version
  pre-flight gate (`version.ts` exists, unused), file save/load, the
  git-friendly flow file format, any inspector polish beyond a plain
  scrolling console. `mvp-feature-priorities.md`'s "Real editor shell"
  bullet has a dated note on this; don't mark that item done.
- Litegraph.js and the mpy-cross WASM build are vendored as **static
  files** into `editor/public/vendor/` (hash-verified copies of
  `pocs/poc-d`'s litegraph.min.js and `mpy-cross-wasm/`'s build), not npm
  packages — sidesteps `CLAUDE.md`'s install-script review entirely for
  both. `docs/third-party-licenses.md` updated in the same change.

## Two real bugs already hit and fixed this session — don't rediscover

1. **Cross-platform `node_modules` corruption.** My own Linux sandbox and
   Mike's real Mac share the same live-mounted `editor/` folder. Running
   `npm ci`/`npm install`/`vite build` from the sandbox installs
   **Linux** native optional-dependency bindings (rolldown, esbuild,
   fsevents) into what is actually Mike's Mac `node_modules` — breaks
   `npm run dev` on his end with "Cannot find native binding" errors from
   rolldown. Fix was for Mike to run `rm -rf node_modules && npm ci
   --ignore-scripts` himself, in a real Terminal on his Mac. **Do not run
   npm/vite commands against `editor/` from an agent sandbox once
   `node_modules` exists** — `tsc --noEmit` is fine (pure JS, no native
   bindings), but anything invoking vite/rolldown/esbuild is not safe to
   run from here. If verification is needed, ask Mike to run it and paste
   output back, same as HIL work already does for hardware.
2. **Vite forbids importing `public/` files from bundled source, even
   dynamically.** First attempt at loading the vendored mpy-cross.mjs via
   `import(/* @vite-ignore */ url)` from `main.ts` hit Vite's own guard
   ("should not be imported from source code... can only be referenced
   via HTML tags") on the very first real `npm run dev`. Fixed via
   `editor/public/vendor/mpy-cross/load.mjs`, loaded by a real `<script
   type="module">` tag in `index.html` (outside Vite's module graph,
   same unbundled pattern `pocs/poc-d/app.js` used), which imports the
   real file and publishes the factory on
   `window.__thingstudioCreateMpyCross`; `main.ts` polls for that global.
   If any other vendored public asset needs importing from `src/` later,
   this is the pattern — don't re-hit the same Vite guard.

## Supply-chain check done this session (per `CLAUDE.md`)

No new npm packages were installed — Litegraph/mpy-cross were vendored
specifically to avoid needing this review. Checked the existing
`editor/package-lock.json` (authoritative — `hasInstallScript` flags, not
the sandbox's own `node_modules` layout, which turned out to have
unrelated stray cache artifacts not reflected in the lockfile) for
install-script exposure across the whole devDependency tree: only
`fsevents@2.3.3` (transitive, from vite, `os: darwin`-gated, optional,
dev-only — vite's native macOS file-watcher). Its actual install script
was never inspected (it doesn't even install in the Linux sandbox to look
at) — if `npm run dev`'s file-watching behavior ever becomes a real
question, that's the one script left un-reviewed, and it needs Mike's
own Mac to inspect, not this sandbox.

## What's NOT yet confirmed — this is the actual next step

**A real flow has not yet been confirmed to deploy and run on hardware
in this session.** Mike got the dev server running (after the two fixes
above) and started exploring the canvas UI (asked about the inject
node's missing manual-trigger button — answered: deliberate, `manual`
repeat fires once at Deploy time, baked into generated code, no live
re-fire message exists in the v1 wire protocol per design doc §15.5; redeploy
to re-fire). **No Connect/Deploy round-trip against real hardware has
been reported back yet** — that's the actual open item, not a "done,
move on." Pick up there: does Connect find the port, does Deploy
actually reach `DEPLOY_ACK`, does the deployed flow behave as compiled
(e.g. an inject → gpio_out flow actually lighting the LED)? First real
end-to-end proof of this whole pipeline from a human clicking a real UI,
not a test harness.

## Conventions to keep following (unchanged, don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints (this session
  did — two commits: the bare-minimum editor itself, then the mpy-cross
  fix); flag any new npm/Python package before installing; update
  `docs/third-party-licenses.md` in the same change as any new
  dependency (including vendored static files, per this session's own
  new table there).
- `tsc --noEmit` and the full test suite green before every commit — the
  187 pre-existing off-device tests are untouched by this work and still
  pass; there are no new automated tests for the canvas/app layer itself
  (not testable the same way — it's a real browser + real hardware loop,
  same category as `test/hil/` work).
- No direct hardware or real-browser access from an agent sandbox — this
  is now doubly true here: HIL work was always "propose, hand to Mike,
  read back pasted output," and the `node_modules` platform bug above is
  a fresh, concrete reminder why the same caution applies to `npm run
  dev`/`vite build`, not just physical hardware.

## Not in scope for this chat

- New node types (I2C/SPI sensors — still gated on hardware availability
  per the previous briefing, unchanged).
- Tier 2 (live value streaming/persistence) and the rest of Tier 3
  (save/load, flow file format, HELLO/version gate, inspector polish) —
  all explicitly deferred, see `mvp-feature-priorities.md`'s dated note.
- Redesigning inject's manual-trigger UX (a fake canvas-only "inject now"
  button was offered, not yet requested) — leave as-is unless asked.
