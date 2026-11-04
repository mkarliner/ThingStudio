# Node pages batch 2, lean node catalog, tutorials folder split

Written 2026-11-04 15:46, end of a long session on the user-guide editing plan
(`docs/working-notes/user-guide-editing-plan.md`). Read `user-guide-editing-landed-briefing.md` for phases 0-4, the
tutorial-opening rules and the older environment facts; this brief covers what happened after it and what is next.

## State: nothing from this segment is committed

Mike commits (CLAUDE.md: git writes are his). He answered "done" at 15:42, after the `examples/` to `tutorials/`
rename; I took that as a commit up to there but never confirmed it. The page rename (`tutorial-flows.md`) and the
`mqtt subscribe` description fix came after. Ask before assuming. To commit,
he runs `rm -f .git/index.lock` first, then adds these paths (the folder renames need the directories, not file lists):

- `examples tutorials test-flows` (the rename shows as delete + add)
- `editor` (`src/cli/describe.ts`, `src/node-library/core-packages/mqtt-subscribe.ts`, `test/`)
- `packaging tools mkdocs.yml`
- `docs` (`user-guide/`, `nodes-catalog.md`, `working-notes/`)

## Landed since the last brief

**1. The node catalog is lean and says what it is for** (`editor/src/cli/describe.ts`, generated
`docs/user-guide/nodes-catalog.md`). Mike's review of the `wifi status` entry drove it: lead with a one-line purpose,
separate Type/Kind with a colon, drop the redundant `thingstudio/` prefix, explain properties.

- Each entry: `### label`, one purpose line (`NODE_PURPOSES`, all 50 nodes, a test enforces it), `Type: \`x\`. Kind: k.
  Palette group: g.`, a "Properties explained:" link to the node's page (`nodePage()`), Inputs/Outputs, then a table
  `Property | Editor label | Type | Default | Allowed values and notes`.
- Ports read "message, payload bool" (a port named `msg` carries a whole message; the type is its payload's).
- The catalog does not explain properties. The node page does. The table keeps only what the code owns: allowed
  options, the config id type, and the older hand-written `PROPERTY_NOTES` (e.g. "118 is 0x76"). I added then removed a
  batch of meanings: they duplicated the node pages and broke "one home for changing facts". Do not re-add them.
- The intro says it is the flow-file reference and points to the node pages and to check-a-flow / ai-authoring.
- A test fails if a node's page file is missing. GUI nodes all link to `nodes/gui.md`.
- Regenerate: `cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown >
  ../docs/user-guide/nodes-catalog.md`. A test compares the committed file.

**2. Phase 5 batch 2: `http in`, `http response`, `udp send`, `mqtt publish`, `mqtt subscribe`.** Rewritten to the
node-page layout (purpose line, Properties, Wiring with **Input**/**Output**, Behavior, Errors) and checked against
the code and `device-runtime`, not only reshaped. Facts that were wrong or unverifiable in the old pages:

- `udp send`: the timeout only covers a full send buffer; an unreachable IP raises nothing; `None` sends the text
  `None` (same for `mqtt publish`); a name that won't resolve raises `udp_send: could not resolve HOST:PORT`.
- `http in`: the request body is never read (old page said it was drained); any other path or method gets a 404; the
  query string is dropped; the link to the client is a hidden `_http_conn` field, so a node that builds a new message
  breaks it. Dropped as unverifiable: "same-route requests queue".
- `http response`: a second reply doesn't raise (old page said it did); no `Content-Type` is sent.
- `mqtt publish` ignores `msg.topic`. `mqtt subscribe` keeps 20 messages per node and drops the oldest; wildcards `+`
  and `#` work; the payload is decoded as UTF-8.
- The `mqtt subscribe` descriptor description claimed "otherwise bytes"; fixed to say UTF-8 text (Fix A). A real bytes
  fallback (try/except in the node's Python) is parked: it changes `device-runtime`, so it needs a runtime version
  bump (`_RUNTIME_VERSION` / `EDITOR_TARGET_VERSION`, major) and a hardware check. Not in `outstanding-items.md` yet.

**3. Tutorial flows split from test flows** (Mike: "test flows stay in the repo, tutorial flows are copied to the
installation"; decision note `decisions/examples-folder.md`, 2026-11-04 section).

- `examples/` is now **`tutorials/`**, holding only `blink`, `two-more-blinks`, `http-blink`, `blink-from-anywhere`.
  `tools/make_bundle.py` copies it to the bundle root as `tutorials/`.
- `basic-http-request`, `basic-mqtt`, `bmp280-test-flow`, `gui-touch-freenove-s3-4in`,
  `gui-headliner-sensor-freenove-s3-4in` moved to `test-flows/`. Tests that read them follow (cli-check-flow,
  gui-compile, gui-trend); `examples-compile.test.ts` became `tutorials-compile.test.ts`; flow-layout walks both.
- The two network tutorial flows ship with blank `credentialName` (WiFi and broker), so a flow never points at a
  credential the reader doesn't have. The compile check supplies stand-ins for blanks. The WiFi/broker config types
  already default to a blank name; a blank config shows in the dropdown as "(unnamed WiFi #abc123)" (possible polish).
- The guide page `examples.md` ("Example flows") is now **`tutorial-flows.md`** ("Tutorial flows"; not
  `tutorials.md`, which would collide with the Tutorials section URL). Nav, links and `tutorials/README.md` follow.
- Mike's own words kept in the page opening: "If you'd rather not build the tutorial flows from scratch, or you get
  stuck..." and "You'll need to change the flow to match your WiFi setup, and the actual pins...". Don't reword them.
  The "Before you deploy" bullet reads "A flow with a WiFi or MQTT node holds no passwords." There is no such thing as
  a "WiFi flow"; say "a flow with a WiFi or MQTT node".
- `ai-authoring.md`'s "Examples to copy" table now lists `tutorials/...` and `test-flows/...` paths. The AI-skill build
  (`packaging/ai-skill/build.mjs`) rewrites `test-flows/` to the skill's own `examples/` and takes `blink` from
  `tutorials/`.

## Open items

- Skill build fails: `node packaging/ai-skill/build.mjs --out /tmp/x --version t` reports "elements is not iterable" on
  the `test-flows/ai-authoring` GUI flows. Not caused by this work as far as the file list goes, but not confirmed on
  a clean tree. Check before a release.
- `ai-authoring.md` now names `test-flows/` paths a user with only an install doesn't have; the AI skill bundle carries
  them. Say so on the page if Mike wants.
- `working-in-the-editor.md` (Config nodes, around line 68) still says "a credential that isn't saved on this
  computer".
  Mike found the same wording unclear on `tutorial-flows.md`; reword to match.
- Carried over: whether Mike ran the remote delete and re-push of tag `v0.11.2` so Release builds on the version-bump
  commit (publishing the draft is manual); finishing the web repo rebase; the PowerShell refresh line is untested; the
  MQTT tutorial hasn't run on a board; `wifi status` 201/202 advice vs discussion #5; whether an onboarding-reports
  category exists; the nav "Get started"/"User guide" duplicate URL on the landing page; Mike's own-voice rewrites
  of the Web Blink / Blink from anywhere / sensor display openings and tutorial titles.

## Next, in order

1. **Phase 5 general pages** (nine): `inject`, `timer`, `function`, `change`, `delay`, `filter`, `journal`, `debug`,
   `startup`. Then hardware pages, then the BLE pages (newer than the review, need their own check).
2. Per page: read `docs/working-notes/docs-style-guide.md` (node page layout, "Places for Mike's own voice"); read the
   old page; read the descriptor in `editor/src/node-library/core-packages/<node>.ts` and the Python in the same file
   or `device-runtime/src/`; rewrite; keep every fact the code confirms, drop or fix the rest and say which in the plan
   note; run `python3 tools/docs_lint.py`. Do not touch the catalog's wording per page: it needs no per-page work now.
3. Add a "Batch N done" note to the Phase 5 section of `user-guide-editing-plan.md` after each batch.
4. Phases 6 (structure) and 7 (pictures) as in the plan.

## Environment facts (every toolchain this segment used)

**Device bridge.** The repo is `$HOME/mnt/ThingStudio` (this run: Mac mini, capital S) = `/Users/mike/Src/ThingStudio`.
The device shell is a Linux VM: it has Python and `mkdocs` but **not** Material (a `mkdocs build --strict` there fails
on the theme), so don't build the site on the Mac. `rm` fails until `device_request_delete_permission` is granted for
the repo folder (this run it was granted once, for the session; `mv` of a file or directory works without it).
Edit with Python read-modify-write and `assert old in s`; `grep -r` over the root times out (name the directories).

**Cloud workspace (where tests and the site build run).** Never run `npm ci`, vitest, vite or `make` against the
Mac mount (CLAUDE.md). This run used a clone at `/tmp/ts-ble` (branch `ble-phase-3`), made by staging the repo without
`node_modules` and running `cd editor && npm ci --ignore-scripts`. It lives only as long as the session; rebuild it the
same way. Commands that worked there:

- `./node_modules/.bin/tsc --noEmit`, then `./node_modules/.bin/vitest run test/cli-describe.test.ts
  test/cli-check-flow.test.ts test/tutorials-compile.test.ts test/flow-layout.test.ts test/gui-compile.test.ts
  test/gui-trend.test.ts` (about 6 s).
- Before trusting a run: `find editor/src editor/test -name "*.js" -type f` (stray compiled files).
- Site build: `mkdocs build --strict -d /tmp/site` from the clone root (Material is installed in the cloud; the
  "MkDocs 2.0" banner is not a warning, the exit code is the result).
- `python3 tools/docs_lint.py` works in both places. Baseline: 12 known violations, none new.

**Moving files.** Mac to cloud: `device_stage_files` (lands under `/mnt/user-data/uploads/ThingStudio/...`), then `cp`.
Cloud to Mac: copy to `/mnt/user-data/outputs/<dir>/`, then `device_commit_files` with `stagedPath`; compare SHA-256
before and after. Check the Mac file still equals the base you edited (hash) before overwriting.

**Git.** Hand Mike commands; don't commit. A plain `git status` from the sandbox can leave `.git/index.lock`, and this
run did run one from `device_bash`, so tell him `rm -f .git/index.lock` first. The tag/push route from the sandbox
(bundle in a connected folder, fresh shallow clone in `/tmp`, push from the cloud) is in the landed brief.
