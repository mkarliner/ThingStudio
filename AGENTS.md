# Project rules for Thingstudio

Behavior Preferences
Keep responses concise and focused on code.Do not repeat large blocks of unchanged code in explanations.Provide complete, copy-pasteable files when rewriting components.

Orientation for anyone (human or AI) picking this project up: `docs/thingstudio-design-doc.md` is the design doc,
`docs/working-notes/` is active planning. Read the design doc in full before proposing architecture changes.
Adding or changing a built-in node: `docs/node-conventions.md` (message envelope, codegen patterns, ports, naming,
fault handling, docs/catalog/tests, vendoring). Cross-subsystem interface specs live in `interfaces/` (wire protocol
first; see its `README.md`). Before any change, check the table at the top of `docs/security-policy.md`: it says
in a few lines whether the change has security implications and which section to read.

## Message shape: the `msg`/`payload` convention

Every message flowing through a compiled flow is a dict: `msg = {'payload': ..., 'topic': ..., <anything else>}`.
`payload` is the one key every generic downstream node reads and the one a port's declared type checks against
(`debug` prints only `msg['payload']`). `topic` is a routing/identification string, required on every message even
when a node has no natural topic of its own -- set it to `''` rather than omitting it. Anything beyond those two keys
rides along unchecked, read only by a node written to look for it specifically. Full explanation and examples:
`docs/user-guide/custom-nodes.md`.

## Do not use the following phrases/words
- load bearing

## Engineering priority: fault handling over happy-path behavior

The measure of a good system is not how well it works but how well it fails. When a design or implementation choice
trades off clarity/robustness of fault handling against the happy path, fault handling generally takes priority —
timeouts, error attribution, degradation behavior, and recovery paths are not secondary polish added once the happy
path works, they're load-bearing. This is already the working convention this project applies to hardware/protocol
work (§5's fault isolation, the wire protocol's adversarial framing tests, bounded timeouts on network I/O) — worth
stating explicitly so it's applied consistently to new work too, not just re-derived per feature.

**Corollary, 2026-10-22: one deterministic path, not a recovery chain — fail well, not work badly.** When a failure
shows up, the first question is "what is the limit?", not "what retry gets around it?". Adding a fallback per observed
error — free this, retry that, restart, try again — produces a system whose states nobody can describe: it *appears*
to work, failures move rather than disappear, and the operator cannot tell what happened. Prefer one sequence decided
before anything is sent, with each step a named state and one clear failure per step; if the board or platform cannot
do the thing, say so in one line up front. Mike's words, after an afternoon of exactly that chain: *"we're spent hours
on this… it falls squarely on 'fail well, not work badly'."* Full incident: `docs/working-notes/decisions/
classic-esp32-firmware.md` (deploy over a running flow, 2026-10-22).

The operative half — what a failure looks like when a session is tempted to repair it (restated by Mike the same
evening, after the first version of this rule still shipped three automatic repairs):

- **No automatic recovery inside a user action.** If a deploy does not fit, it fails once, says so, and stops. Do not
  free memory, stop what the user is running, drop modules, restart, retry, or escalate on their behalf. A repair
  nobody asked for hides the limit and lands the user in a state they did not choose.
- **Warn on a prediction; refuse only on a fact.** A version mismatch or an unreadable flow is a fact — refuse.
  A memory estimate is not: the user may know the board better than the figure does. Say what you expect ("this may
  not fit"), then do as asked.
- **Every failure line carries three things**: what happened, the figure that names it (bytes free, message size,
  host:port, the node), and the one or two things the user can do next. Nothing the editor could have done itself.
- **Prefer the honest size to the safe size.** Shrinking work into ever-smaller pieces to dodge a limit makes the
  product slow and the limit invisible. Pick the size that makes the operation quick; a board that cannot take it has
  a problem worth seeing.
- **A retransmit is not a repair.** Resending an unacknowledged piece, or a bounded timeout that gives up and
  reports, stays: those are named states of one path. A retransmit that renegotiates the plan (smaller piece, freed
  memory, different flow) is the chain this rule forbids.

Mike on the second half: *"Don't be too clever… you can warn about limited memory, but the user may know better…
if it fails, say so clearly with some suggestions about what to do, remove any attempts at automatic fixes."*

**Corollary, 2026-09-06: don't chase every board's idiosyncrasies — make the failure legible instead.** The
board/platform landscape (ESP32/ESP-IDF, RP2040/RP2350's cyw43, and whatever comes after) is wide, and each one's
WiFi/network stack has its own timing and failure modes — a general-purpose fix aimed at holding across all of
them can be a moving target rather than a one-time close-out (the wifi_status-vs-mqtt_as ordering-race fix held on
RP2040 but still failed on ESP32 after a real fix attempt — `outstanding-items/wifi-status-mqtt-connect-ordering-
race.md`). Mike's own words, prompted by that finding: "there are a lot of boards, all with different
idiosyncrasies. Rather than play whack-a-mole and try to make all cases work, it's better to have really clear
error messages." Default to a clear, attributed failure — a `NODE_ERROR` naming the operation and its host:port,
the pattern already built into `udp-send.ts`/`udp-receive.ts`/`http-request.ts`/`mqtt-shared.ts` — over an
open-ended chase for a fix that works on every platform. Not a license to skip a real, cheaply-fixable bug — a
call on where further effort actually pays off once a platform-specific quirk resists a clean general fix.

## Unsupported boards: expect them anyway

Thingstudio has a list of supported processors (ESP32 family, RP2040/RP2350), but expect people to connect anything
that runs MicroPython -- STM32, nRF, SAMD, whatever they have to hand. We may not have tested it; they'll try it
anyway. Docs and console messages shouldn't assume the board is on the list. Where a step differs by chip
(installing MicroPython, pins, flashing), say what we cover and point everything else at the MicroPython docs
(micropython.org/download, docs.micropython.org) rather than leaving the reader with nothing. Mike, 2026-10-01,
from the first newcomer test.

## Hardware resources are keyed singletons

Every unique hardware resource -- GPIO pin, ADC channel, I2C or SPI bus, PWM output -- is a keyed singleton after
Peter Hinch's [functor_singleton](https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md)
pattern: the first user builds the one object, later users get the same object. A node that touches hardware must
(1) claim each pin and bus at compile time with `claimResource()` (`editor/src/node-library/hardware-shared.ts`), and
(2) get the object on the board through `runtime.shared(kind, key, signature, factory)`, never by constructing
`machine.Pin`/`ADC`/`I2C`/`SPI`/`PWM` itself. Unlike Hinch's version, a second user with different settings is an
error, not silently ignored. Mike, 2026-09-08, restated 2026-10-12 after it was found missing from five pin nodes:
`docs/working-notes/decisions/hardware-singletons.md`.

## Install instructions: never `curl | sh` alone

Piping a downloaded script into a shell (`curl ... | sh`, `irm ... | iex`) is widely regarded as unsafe, and many
readers will hesitate or refuse. Wherever docs give an installer one-liner, give a plain download (the GitHub
releases page) alongside it as an equal choice, and say how to read the script before running it. Mike,
2026-10-01.

## Any work that impacts the user experience should update the user documentation to reflect that.

## Read the user manual before the code

When a question is "how does X work" or "how do I use X", read the user-facing docs first — `docs/user-guide/`
(including the node pages and the FAQ/debugging pages), the READMEs, the walkthroughs — before reading the
implementation. The docs are the intended, user-facing picture of the system; the code is the fallback for the
parts they don't cover, or to confirm a specific behavior the docs state. Reading the code first tends to produce
an answer in implementation terms the user doesn't have, and to describe behavior the docs were deliberately
written not to promise. If the docs and the code disagree, that is a documentation bug — fix the docs in the same
change, don't quietly trust the code. Mike, 2026-10-17.

## Console messages: terse

People skim the console, so a long message gets skipped. One line: what happened, then what to do, in
fragments if that's shorter ("Board restarted starting the flow, probable crash, maybe low memory. Try Tools →
Reset board (hard), then deploy."). No explaining why, no hedged asides; the detail goes on the linked docs page.
Keep a raw error text in brackets when it helps a bug report. Mike, 2026-10-07.

## Watch for troubleshooting and FAQ entries

Whenever a session turns up something a user could hit and wouldn't understand on their own -- a confusing error,
a hardware limit, a board quirk, a "why does it do that" question from Mike -- add it, in the same change, to
`docs/user-guide/faq.md` (a question someone would ask) or `docs/user-guide/debugging.md` (a symptom and what to
do). Short entries in the user-guide style, linked rather than repeated. Mike, 2026-10-07, when the ESP32 memory
breakdown turned out to be FAQ material.

## No premature optimization, but don't paint into an architectural dead end

Default to the cheapest implementation that's actually correct — don't build the general/heavy version of something on
spec before a real need forces it. But before taking the cheap path, check whether it forecloses a future direction
that would otherwise be nearly free to keep open: if a shortcut is a one-way door (a field that can't be added later
without stranding already-deployed devices, a data shape that can't grow without a breaking migration), the cost of
avoiding that lock-in now is usually much lower than the cost of undoing it later, and that comparison is worth making
explicitly rather than skipped in the name of avoiding premature optimization. This project already applies the
pattern — reserving `HELLO`'s `authRequired`/`authScheme` fields and laying out OTA-capable partitions on the ESP32
build before either feature is built (`mvp-feature-priorities.md`, Tier 0) are both "ship the cheap version, but don't
foreclose the expensive one" calls, not exceptions to the cheap-by-default rule. Worth naming explicitly so it's
applied consistently to new work — including plain engineering-effort trade-offs, not just protocol/hardware one-way
doors — rather than re-derived per feature.

## Node format parity: built-in and custom nodes are one thing

The end state is the Node-RED model — a node is one package (descriptor + device-side Python behavior), core
nodes shipped in a folder ahead of the user's, same format, copyable and editable. "No difference between
custom nodes and builtin nodes" is the target; the reviewer's test is "could a built-in be rewritten as a
package with no loss." One divergence stays by design (the editor never executes package code —
`custom-node-authoring-scoping.md` Decision 5). Two rules bind new node work, so nothing here paints us into
a corner:

- **Data-equivalent rule** — a new descriptor capability must have a serializable form, not a
  JS-function-only one. `showIf` (function), `PortType`-as-function and `outputCount` are the existing
  corners; prefer data, and treat a genuinely unavoidable function as an explicit, revisitable divergence.
- **One-vocabulary rule** — the custom `.node.json` schema stays a strict subset of the canonical
  `NodeDescriptor`; never a parallel vocabulary that can drift.

Full reasoning, rules and the phased roadmap: `docs/working-notes/decisions/node-authoring.md` (2026-10-15).

## Everything is a plugin

Default to making new functionality something a user can extend the same way they extend custom nodes and board
definitions, rather than something only the core can provide. Before building a feature into the core, ask "could a
third party add this the way they add a custom node or a board definition, without a core change?" Where the answer
is cheap to make yes, do so. The node-level forms of this are already rules (the data-equivalent and
one-vocabulary rules above; `decisions/node-authoring.md`). The lens applies to review as much to old as to new work: if
an existing feature is hard-wired into the core that a package or a descriptor could carry, name it and propose the
extension point.

This is a default and a direction of travel, not a mandate to build a plugin framework for every new line.
Reasonable exceptions, each decided and stated rather than left implicit:

- editor-executed stranger code stays out -- the editor never runs package code
  (`custom-node-authoring-scoping.md` Decision 5);
- `function` (verbatim user code) and the `gui_*` family are the named built-in-only residue;
- where an extension point would cost more than the feature it generalizes, or would foreclose a settled
  interface, the core-only path is fine -- say why in the change and in the relevant `decisions/` note.

Mike, 2026-10-17.

## Architecture first at subsystem interfaces: MVP-ready is not tester-ready

Two bars, not one. "MVP" means feature-complete enough to demonstrate and dogfood on hardware we hold; "suitable for
initial testers" is higher — the subsystems are settled enough that a stranger's saved flows, deployed boards and
editor survive normal use. Don't read "we're on the MVP path" as permission to defer structure.

A known architectural problem gets fixed now, in the change that names it: a boundary an agent can couple across
wrongly, a format implemented in more than one place and left to drift, a descriptor with no single home. This is the
one-way-door rule above applied to structure rather than to a field or a message. The cross-subsystem interfaces —
editor ↔ backend ↔ device-runtime, the wire protocol, the flow file, the node and board descriptors — are where a
cheap-but-wrong shape today becomes a breaking change once boards and saved flows are in the field. Still not a
license to build the general version of everything on spec: the cheapest-correct default holds *within* a settled
boundary.

## Interface specs: read before you implement, change only with permission

Each cross-subsystem interface has one specification artifact. Code that touches one is written *against that
spec*, never against a guess or a neighbouring implementation:

- **Wire protocol** — `interfaces/protocol/SPEC.md` + `interfaces/protocol/messages.json`, with conformance vectors
  in `interfaces/protocol/vectors/` run by `editor/test/protocol-conformance.test.ts`,
  `device-runtime/test/test_conformance.py` and `backend/test/test_conformance.py`.
- **Device runtime API and dependency manifest** — `interfaces/runtime-api/SPEC.md` + `api.json`, checked by
  `editor/test/runtime-api-conformance.test.ts` and `device-runtime/test/test_runtime_api.py`.
- **Node descriptor** — `interfaces/node-descriptor/SPEC.md` + `custom-node.schema.json`, checked by
  `editor/test/node-descriptor-schema.test.ts`.
- **Board/processor descriptor** — `interfaces/board-descriptor/SPEC.md` + `{board,processor}.schema.json`, checked
  by `editor/test/board-descriptor-schema.test.ts`.

**Before implementing or changing code that emits, parses, stores or transmits anything an interface defines, read
that interface's spec, and run its conformance test.** If what you need isn't expressible in the spec, that's a
signal to stop and raise it, not to widen the code quietly and leave the spec behind.

**Interfaces change only with Mike's explicit permission.** A session may add conformance vectors and fix an
implementation that has drifted; it may not change a message id, field, framing rule, descriptor shape, or runtime
API signature — or add or remove one — without Mike saying so in the session. Propose the change, state the blast
radius (deployed boards, saved flows, the other implementations), and wait. This is the one-way-door rule at the
interface level: the spec is the contract, and the point is that it does not move under anything already in the
field.

**These specs are written for humans and must stay readable** — plain language, short sections, tables, a worked
example. A spec only an author can follow is a spec that will drift.

**The boundaries are enforced mechanically, not just documented.** Each subsystem has its own `AGENTS.md`
(`editor/`, `backend/`, `device-runtime/`, `interfaces/`); `.github/CODEOWNERS` routes every interface and its
conformance test to Mike; `editor/test/module-boundaries.test.ts` (run by `npm test`, and therefore CI) fails a
forbidden cross-layer import; and each interface has a conformance test. CI runs the editor's and backend's; the
device-runtime conformance suite is not yet in CI (`outstanding-items/enforce-interface-conformance-in-ci.md`).
When a boundary test catches a coupling, fix the coupling — don't relax the test.

## Commits

Prompt Mike at suitable points to commit — don't assume auto-commit and don't let uncommitted work pile up silently.
Suitable points: after a coherent unit of work lands (a doc section resolved, a feature/module working), before
starting something new or risky, and at the end of a work session regardless of how small the change was.

## Third-party code: pinned, scriptless, gated

Anything fetched from outside the repo — npm packages, Python packages, GitHub Actions, the firmware toolchain,
vendored libraries — is untrusted until it is all three of:

- **pinned to an immutable identifier** — a lockfile with integrity hashes, `requirements.txt` with `--hash`,
  an Actions commit SHA rather than a tag, a firmware tag plus a locally verified build;
- **installed without its own code running** — `npm ci --ignore-scripts`, `pip install --require-hashes` with no
  build isolation, no postinstall hooks;
- **covered by a check that fails rather than warns when it changes** — `npm audit --audit-level=high` in CI,
  Dependabot alerts, and the checksums `record-tested.sh` keeps for release images.

Mechanical rather than vigilant, deliberately: a supply-chain compromise is *designed* to survive review — the
package looks right and behaves until it doesn't (event-stream, ua-parser-js, node-ipc; the xz backdoor was caught
by an unrelated performance test, not by anyone reading the code). Human care does not scale to that. A pin that
goes red does. This is the fault-handling priority applied to code we did not write.

| source | the pin | enforced by |
|---|---|---|
| npm (`editor/`) | `package-lock.json` integrity hashes; `npm ci --ignore-scripts` | CI audit gate, `.github/dependabot.yml` |
| Python (`backend/`) | `backend/requirements.txt`, hash-pinned; installed `--require-hashes` | CI, docs and release workflows, `make` |
| GitHub Actions | 40-char commit SHA with a `# v7` comment, never a tag | every workflow |
| Firmware toolchain | MicroPython/ESP-IDF tag + a build verified on the board | `firmware/classic-esp32/build.sh`, `tested.json` |
| Vendored libraries | the reviewed copy in `device-runtime/src/vendor/` | no update path by design |

- **Adding a source is a reviewed decision, not a convenience.** Name it, say why, and add the line to
  `docs/third-party-licenses.md` in the same change — that ledger doubles as the supply-chain inventory.
- **Change one thing at a time.** A single reviewed security bump with the tests run is reviewable; `npm update` or
  `pip install -U` is not.
- **Refuse on a fact, warn on a prediction.** A hash mismatch, or a version with a published advisory, refuses.
  "This looks risky" is a note in a brief.

Stated exceptions, not accidents: `docs/requirements.txt` is exact-pinned (`==`) but unhashed — it is build-only
tooling and hoisting a lock file there buys little. MicroPython and ESP-IDF are pinned by tag rather than by hash
because we build them locally and verify the resulting image on hardware.

## npm / Node.js package use

Warn Mike before installing or adding any npm/Node.js package (dependency or dev dependency) — name the package, why
it's needed, and flag it before running the install. Once flagged, follow
[lirantal/npm-security-best-practices](https://github.com/lirantal/npm-security-best-practices) where reasonable (the
maintainer-side items — 2FA, provenance/OIDC publishing — don't apply here, this project doesn't publish its own
packages):

- **Install with scripts disabled by default**: `npm install --ignore-scripts <pkg>`. Only re-enable/run a specific
  package's install script after checking what it actually does and why it's needed — never blanket-trust a
  `package.json` postinstall hook.
- **Avoid git-based dependency URLs** — they bypass registry scanning/provenance and can ship an `.npmrc` that
  silently re-enables scripts.
- **Use lockfiles and deterministic installs**: `npm ci`, not bare `npm install`, once a lockfile exists; commit the
  lockfile. See "Third-party code: pinned, scriptless, gated" above — npm is one instance of that rule, not its
  whole scope.
- **In `editor/`, the install command is `npm ci --ignore-scripts`.** A plain `npm install` fails on this tree with
  `Cannot read properties of null (reading 'edgesOut')` — an npm 10 arborist bug resolving vitest's optional browser
  peers, reproducible on an unchanged tree. To regenerate the lock, use
  `npm install --ignore-scripts --legacy-peer-deps`, then consume it with `npm ci`; never delete the lock. Full
  incident: `docs/working-notes/learnings/editor-build-tooling.md`.
- **Never blindly bulk-upgrade** (`npm update`, `ncu -u`) — review dependency updates individually, or via
  `npx npm-check-updates --interactive`.
- **Sanity-check before adding a new dependency**: recent maintenance activity, whether it has an install script at
  all, and — if anything looks off — `npm pack <pkg> --dry-run` rather than trusting the registry page's displayed
  source blindly.
- **Prefer fewer dependencies** — a small native-JS implementation over pulling in a small utility package, where
  reasonable.
- **Never run arbitrary `npx <package>`** for one-off tool use — pre-install into a lockfile-tracked location first,
  then run it offline against the pinned version.
- **Always run `npx` with `--no`** (e.g. `npx --no <pkg>`) when the package isn't already a project dependency.
  Without it, npm normally prompts before installing a missing package, but silently assumes `--yes` in a
  non-interactive shell (exactly what this environment is) — `--no` makes npm refuse instead, which is the actual
  enforcement, not just a reminder to be careful.

## Check for stray compiled `.js` before trusting any test/tsc run

`editor/src` and `editor/test` are TypeScript-only — `.gitignore` blanket-ignores `editor/src/**/*.js` and
`editor/test/**/*.js` with a comment calling them "never intentional, never committed." Vite/vitest resolve `.ts`
sources directly; nothing should ever leave a `.js` file sitting next to one. But `npx tsc --noEmit` doesn't reliably
respect `--noEmit` in every sandboxed shell — confirmed, not hypothetical: it silently emitted `.js` output during the
2026-08-18 UDP/TCP node session's own verification pass, and those stale files then shadowed that same session's
actual edits on the next test run (Node/Vite's module resolution finds a literal `./foo.js` on disk before ever
falling back to `foo.ts`, so stale compiled output loads instead of the real source — no error, just silently wrong
behavior: a function reported as missing that was actually right there in the `.ts`, a node type reported as
unregistered that was actually registered, etc.).

Before trusting any `npm test`/`vitest run`/`tsc` result — yours or an agent's — run
`find editor/src editor/test -name "*.js" -type f`. If that's non-empty, delete them (`-delete`) before testing; any
of them could be stale relative to whatever was just edited, and there's no cost to deleting all of them (they're
never intentional, always regeneratable, never committed). Prefer the direct binary,
`./node_modules/.bin/tsc --noEmit`, over `npx tsc --noEmit` — the `npx` wrapper is the thing observed not respecting
the flag, not `tsc` itself.

## `device-runtime/src` changes: run the real MicroPython suite, not just `py_compile`

`python3 -m py_compile` only proves a file parses — it's a syntax check, not a test, and it has already missed a real
bug that broke a live message type at runtime. Full incident:
`docs/working-notes/learnings/micropython-device-runtime.md` (the CBOR `None`-encoding bug, 2026-09-05).

`device-runtime/test/`'s own suite (`test_cbor.py`, `test_framing.py`, `test_protocol.py`, `test_runtime.py`, run
against a real MicroPython unix-port build; `test_listener_integration.py`, a CPython3 script driving a real
`micropython listener.py` subprocess) is what actually exercises this code at runtime. Neither binary it needs
(`micropython`, `mpy-cross`) is vendored — `device-runtime/test/README.md` has the ~2-minute build recipe (clone
`micropython`, `make -C mpy-cross`, `make submodules && make` in `ports/unix`). Building it fresh in a
throwaway/scratch location (never the shared mount with Mike's Mac — these are Linux-native binaries with no reason to
live there) carries none of the cross-platform-native-binary risk that the npm/`node_modules` restriction in Claude
Code's own sandbox rules (`CLAUDE.md`) exists for, so — unlike `npm`/`vitest`/`tsc` — this is safe to build and run
directly from the agent sandbox or a device-bridge session. Do this whenever a change touches `device-runtime/src` in
a way that could actually run, not just `py_compile` it and call it verified.

## Authored flows read left to right

When you write or generate a flow file — `test-flows/`, an example in the docs, anything handed to someone to open —
lay it out left to right: sources at the left edge, every wire going to a node further right, branches stacked
vertically within their column, and kept visually tight (columns about 220 px apart, about 36 px between stacked
nodes, about 66 px between separate chains; full rules in `docs/user-guide/ai-authoring.md#layout`). A flow that
wraps back to the left edge on its second row reads as a rats nest even when the graph itself is fine, and it is the
person reading it who pays. `node editor/dist-cli/thingstudio-compile.mjs --relayout <flow.json>` does the layout,
`--layout` checks it, and `editor/test/flow-layout.test.ts` fails the build for a shipped flow with a leftward wire.
(`python3 test-flows/relayout.py` still works but uses the older, looser 260 x 170 grid.) This is about flows we author: a user's own flow keeps whatever layout they put
it in, and the editor never repositions nodes on load. Mike, 2026-10-22; "kept tight", 2026-10-23.

## Third-party software tracking

`docs/third-party-licenses.md` is the running ledger of every third-party dependency in use — runtime/platform
components, editor build tooling, and anything vendored — with its license. Keep it current in the same change, not
batched up for later: any new npm package (already requires the flag-and-approve step above), any newly vendored
library, or any platform/runtime component decision (a different ESP-IDF version, a different MicroPython fork, etc.)
gets a line added or updated there immediately, pulling version/license straight from the installed package metadata
rather than from memory.

## Device-runtime version bump discipline

`_RUNTIME_VERSION` (`device-runtime/src/listener.py`) and its manually-mirrored counterpart `EDITOR_TARGET_VERSION`
(`editor/src/app/main.ts`) are what `version.ts`'s `decideDeploy()` compares to decide whether a DEPLOY is safe — but
it only ever gates on a `major` mismatch; `minor`/`patch` differences are logged but never block anything. Full
incident this rule came from (the `register_trigger` bug):
`docs/working-notes/learnings/micropython-device-runtime.md`.

**Rule:** any change to a file `deploy_runtime.py` pushes onto real hardware (`device-runtime/src/*.py`, plus the
vendored files it can push) gets evaluated, in the same change, for whether it's a breaking change — and if so, both
`_RUNTIME_VERSION` and `EDITOR_TARGET_VERSION` get bumped together, in the same commit, not batched for later.

**What counts as breaking, given how `decideDeploy` actually works today:** it only blocks a DEPLOY on a `major`
mismatch, so the real test isn't classic semver ("is this a new backward-compatible feature?") — it's: could an editor
with this change's codegen produce a flow that a board running the OLD `runtime.py` would fail to run correctly? If
yes — even for only some node types, even if most flows would be unaffected — bump `major`. That's the only bump level
`decideDeploy` actually enforces. Reserve "no bump needed" for changes with no codegen-visible effect at all
(comments, refactors, internal renames nothing outside the file references).

This is blunter than textbook semver (most `runtime.py` additions will end up being `major` bumps, not `minor`) — a
known, accepted cost of keeping `decideDeploy`'s gate simple. Per this project's fault-handling-over-happy-path
priority, an over-cautious block on a technically-safe deploy is preferable to a false "compatible" that silently lets
a crash through again. If this granularity becomes a real practical pain, that's a case for revisiting `decideDeploy`
itself — not a case for quietly under-bumping.

**Automatic backstop (non-blocking, doesn't replace the rule above):** `test-flows/deploy_runtime.py` stamps a board
with a git SHA of `device-runtime/src` at push time (a plain marker, not a content hash — a hash can't tell a
same-behavior comment edit from a real change); the board echoes it back in HELLO as an optional `runtimeBuild` field;
the editor compares it to its own build-time SHA and logs a warning on mismatch (`version.ts`'s `checkRuntimeBuild`) —
diagnostic only, never blocks a DEPLOY. `runtimeBuild: null` means "can't confirm," not "confirmed stale."

## Human-facing documentation: concise, not exhaustive

This applies specifically to documentation written *for people to read* —
end-user docs like `docs/user-guide/custom-nodes.md`, READMEs, anything handed to
someone (or to a deliberately narrow validation session) as their whole
picture of how to do something. It does not apply to working-notes files,
`docs/thingstudio-design-doc.md`, or this file — those exist to carry a
full reasoning trail and stay in their own established style.

Default output tends toward exhaustive: every edge case named, every
decision's rationale included inline, headers for things that don't need
one. Human-facing docs should be shorter and plainer than that default —
state what a thing is and how to use it, not the full case for why it's
built that way. Short sentences, short paragraphs, definitions over
elaboration, an example only where one actually clarifies.

**Style guide:** `docs/working-notes/docs-style-guide.md` (draft, 2026-10-11, from Mike's review of the docs).
Read it before writing or editing anything in `docs/user-guide/`.

## Handoff/briefing note filenames: lead with the topic, not "next-session-picks" -- this keeps getting ignored, read it before you name the file

Several earlier sessions named the end-of-session handoff note `next-session-picks-briefing-<date>[-suffix].md`.
That prefix is pure noise once there are more than a couple of them -- a directory listing of a dozen
`next-session-picks-briefing-2026-09-07*.md` files tells you nothing about what any of them actually cover.
Mike's call, 2026-09-08: name these the same way every other topic-scoped briefing in this directory already is
(`rp2350-bringup-briefing.md`, `tier1-sensors-network-briefing.md`, `udp-tcp-nodes-implementation-briefing.md`)
-- a short, meaningful topic phrase first, `-briefing` suffix, a date only if needed to disambiguate more than
one briefing on the same topic. `failure-handling-briefing-2026-09-08.md`, not
`next-session-picks-briefing-2026-09-08-failure-handling.md`.

**This rule has already been violated at least once after being written down** -- on 2026-09-11, in the very
session that fixed the WiFi-flapping/mqtt-status bugs, the handoff doc was written and saved as
`next-session-picks-briefing-2026-09-11.md`, the exact deprecated pattern this section prohibits, by an agent
that had presumably already read this file earlier in the same session. It took Mike explicitly flagging it
("it keeps being ignored") for it to be caught and renamed (to `node-status-hardware-pass-briefing.md`). The
likely failure mode: with a dozen pre-2026-09-08 `next-session-picks-briefing-*.md` files still sitting in
`docs/working-notes/` (they're grandfathered -- see below -- so they're not going away), it's easy to pattern-match
off what's already in the directory listing instead of off this rule. Don't do that. If you're about to run
`ls docs/working-notes/ | grep briefing` or otherwise eyeball existing filenames to decide the new one, that's
the moment this has previously gone wrong.

**Before naming or writing the handoff file, actually do this, in order:**

1. Write down the one-sentence topic of the session in your own head first -- not "what's next" (that's the
   content of the doc, not its topic), but what this session actually *did* or *is handing off*. That sentence
   is where the filename comes from.
2. Turn that sentence into a short kebab-case phrase (3-6 words). That phrase, plus `-briefing.md`, is the
   filename. A date suffix only gets added if another briefing already uses that exact topic phrase.
3. The string `next-session-picks` must not appear in the filename you're about to write. If it does, you've
   defaulted to the deprecated pattern -- stop and go back to step 1. This check takes one second and catches
   the exact mistake made on 2026-09-11.
4. Before saving, check the new name against `ls docs/working-notes/*briefing*.md` for a collision or near-miss
   (a differently-worded file already covering the same topic) and disambiguate if needed.

**A brief's "environment facts" section covers every toolchain the session used, not just the device.** If the
session ran `npm ci`, flashed firmware, rebuilt a MicroPython, or started a backend, that goes in — including the
command that works and the one that doesn't. Mike hit exactly this gap on 2026-10-24: the brief listed the serial
port, ESP-IDF and the device interpreter, and had no npm line at all, so a broken `npm install` and six dependency
advisories were rediscovered by hand on a Mac an hour later. The section is written for the person about to touch
the same things, not as a summary of what the author found interesting.

Existing `next-session-picks-briefing-*.md` files are left as-is -- this only governs naming going forward, not
a retroactive rename pass.

## Decisions and learnings logs

`docs/working-notes/decisions.md` and `docs/working-notes/learnings.md` are each a short index — one line per topic,
pointing at that topic's own detail file under `docs/working-notes/decisions/` or `docs/working-notes/learnings/`
(split out 2026-09-06 specifically so a session doesn't have to read either log end to end regardless of task). Read
the index to see what topics exist and orient fast; open only the detail file(s) matching your task's topic, not the
whole set — read everything only for genuinely cross-cutting work (a new architecture decision, or a dedicated
audit/consolidation session).

A design rule Mike states ("X should always work like Y") goes into `decisions/` the day he states it, even when
building it waits: a rule parked only as an `outstanding-items.md` entry doesn't bind the work done meanwhile. The
hardware-singleton rule was lost for a month this way (`decisions/hardware-singletons.md`, History).

Update in the same change, not batched for later: any session that writes or updates a
`Status: decision`/`Status: resolved` note, or resolves a design-doc open question, adds one line to the relevant
`decisions/<topic>.md` file (a new topic gets a new file plus a new index entry in `decisions.md`); any session that
hits a surprising platform behavior, library gotcha, test-methodology trap, or hardware quirk worth remembering does
the same in `learnings/<topic>.md`. If a learning turns out to be a repeatable process rule (not just a fact worth
knowing), promote the *rule* to its own section in this file, keep the *incident* in `learnings/<topic>.md`, and
cross-reference the two — see `learnings.md`'s own "Already promoted to the project rules" section for the precedent (five
rules have gone this route so far). `docs/working-notes/outstanding-items.md` is the third leg of this set — current
open work, not history — check there too when picking up a new task.


## Line length in markdown working-notes files

Wrap prose at under 120 characters per source line, continuation lines indented to align under the bullet/point
they belong to -- not one long unbroken line per paragraph or list item, which is what most of this project's
markdown had drifted into. Applies to this file and to `docs/working-notes/decisions.md`/`outstanding-items.md`/
`learnings.md` and their per-topic detail files (`decisions/<topic>.md`, `outstanding-items/<topic>.md`,
`learnings/<topic>.md`). A one-line index/pointer entry (see "Decisions and learnings logs" above) still counts
as one logical entry even when its text wraps across several physical source lines -- the constraint is line
width, not entry count. Markdown headers are exempt (they can't wrap). Governs new and edited content going
forward, same as the handoff-filename rule above -- not a retroactive rewrap of every existing file.
