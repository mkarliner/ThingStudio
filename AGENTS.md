# Project rules for Thingstudio

Behavior Preferences
Keep responses concise and focused on code. Do not repeat large blocks of unchanged code in explanations.
Provide complete, copy-pasteable files when rewriting components.

Orientation for anyone (human or AI) picking this project up: `docs/thingstudio-design-doc.md` is the design doc,
`docs/working-notes/` is active planning — read the design doc in full before proposing architecture changes.
Built-in node work: `docs/node-conventions.md`. Interface specs live in `interfaces/` (wire protocol first). Before
any change, check the table at the top of `docs/security-policy.md`: it says in a few lines whether the change has
security implications and which section to read.

## Message shape: the `msg`/`payload` convention

Every message through a compiled flow is a dict: `msg = {'payload': ..., 'topic': ..., <anything else>}`. `payload`
is the one key every generic downstream node reads and the one a port's declared type checks against (`debug`
prints only `msg['payload']`). `topic` is a routing/identification string, required on every message even when a
node has no natural topic — set it to `''` rather than omitting it. Anything else rides along unchecked. Full
explanation and examples: `docs/user-guide/custom-nodes.md`.

## Do not use the following phrases/words
- load bearing

## Engineering priority: fault handling over happy-path behavior

The measure of a good system is not how well it works but how well it fails. When a choice trades off
clarity/robustness of fault handling against the happy path, fault handling generally takes priority — timeouts,
error attribution, degradation behavior, and recovery paths are not secondary polish, they're load-bearing. Already
the working convention for hardware/protocol work (§5's fault isolation, the wire protocol's adversarial framing
tests, bounded timeouts on network I/O).

**Corollary, 2026-10-22: one deterministic path, not a recovery chain — fail well, not work badly.** When a failure
shows up, the first question is "what is the limit?", not "what retry gets around it?". Adding a fallback per
observed error — free this, retry that, restart, try again — produces a system whose states nobody can describe.
Prefer one sequence decided before anything is sent, with each step a named state and one clear failure per step;
if the board cannot do the thing, say so in one line up front. What a failure looks like when a session is
tempted to repair it:

- **No automatic recovery inside a user action:** a deploy that does not fit fails once, says so, and stops — no
  freeing memory, stopping the flow, dropping modules, restarting, retrying, or escalating on the user's behalf.
- **Warn on a prediction; refuse only on a fact:** a version mismatch or an unreadable flow is a fact — refuse.
  A memory estimate is not: say what you expect ("this may not fit"), then do as asked.
- **Every failure line carries three things:** what happened, the figure that names it (bytes free, message size,
  host:port, the node), and the one or two things the user can do next. Nothing the editor could have done itself.
- **Prefer the honest size to the safe size:** shrinking work into ever-smaller pieces to dodge a limit makes the
  product slow and the limit invisible.
- **A retransmit is not a repair:** resending an unacknowledged piece, or a bounded timeout that gives up and
  reports, stays — those are named states of one path. A retransmit that renegotiates the plan is the chain this
  rule forbids.

Incidents and Mike's words: `decisions/classic-esp32-firmware.md` (2026-10-22).

**Corollary, 2026-09-06: don't chase every board's idiosyncrasies — make the failure legible instead.** Each
platform's WiFi/network stack has its own timing and failure modes; a general-purpose fix aimed at holding across
all of them is a moving target, not a one-time close-out. Default to a clear, attributed failure — a `NODE_ERROR`
naming the operation and its host:port, the pattern built into `udp-send.ts`/`udp-receive.ts`/`http-request.ts`/
`mqtt-shared.ts` — over an open-ended chase. Not a license to skip a real, cheaply-fixable bug — a call on where
further effort pays off. Incident: `outstanding-items/wifi-status-mqtt-connect-ordering-race.md`.

## Unsupported boards: expect them anyway

Thingstudio has a list of supported processors (ESP32 family, RP2040/RP2350), but expect people to connect anything
that runs MicroPython -- STM32, nRF, SAMD, whatever they have to hand. We may not have tested it; they'll try it
anyway. Docs and console messages shouldn't assume the board is on the list. Where a step differs by chip
(installing MicroPython, pins, flashing), say what we cover and point the rest at the MicroPython docs
(micropython.org/download, docs.micropython.org) rather than leaving the reader with nothing. Mike, 2026-10-01,
from the first newcomer test.

## Hardware resources are keyed singletons

Every unique hardware resource -- GPIO pin, ADC channel, I2C or SPI bus, PWM output -- is a keyed singleton after
Peter Hinch's
[functor_singleton](https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md)
pattern: the first user builds the one object, later users get the same object. A node that touches hardware must
(1) claim each pin and bus at compile time with `claimResource()` (`editor/src/node-library/hardware-shared.ts`), and
(2) get the object on the board through `runtime.shared(kind, key, signature, factory)`, never by constructing
`machine.Pin`/`ADC`/`I2C`/`SPI`/`PWM` itself. Unlike Hinch's version, a second user with different settings is an
error, not silently ignored. Mike, 2026-09-08, restated 2026-10-12: `decisions/hardware-singletons.md`.

## Install instructions: never `curl | sh` alone

Piping a downloaded script into a shell (`curl ... | sh`, `irm ... | iex`) is widely regarded as unsafe. Wherever
docs give an installer one-liner, give a plain download (the GitHub releases page) alongside it as an equal choice,
and say how to read the script before running it. Mike, 2026-10-01.

## Any work that impacts the user experience should update the user documentation to reflect that.

## Read the user manual before the code

When a question is "how does X work" or "how do I use X", read the user-facing docs first — `docs/user-guide/`
(including the node pages and the FAQ/debugging pages), the READMEs, the walkthroughs — before reading the
implementation. The docs are the intended picture; the code is the fallback. If they disagree, that is a
documentation bug — fix the docs in the same change, don't quietly trust the code. Mike, 2026-10-17.

## Console messages: terse

People skim the console, so a long message gets skipped. One line: what happened, then what to do, in fragments if
that's shorter. No explaining why, no hedged asides; the detail goes on the linked docs page. Keep a raw error text
in brackets when it helps a bug report. Mike, 2026-10-07.

## Watch for troubleshooting and FAQ entries

Whenever a session turns up something a user could hit and wouldn't understand on their own -- a confusing error,
a hardware limit, a board quirk, a "why does it do that" question from Mike -- add it, in the same change, to
`docs/user-guide/faq.md` or `docs/user-guide/debugging.md`. Short entries in the user-guide style, linked rather
than repeated. Mike, 2026-10-07.

## No premature optimization, but don't paint into an architectural dead end

Default to the cheapest implementation that's actually correct — don't build the general/heavy version on spec.
But before taking the cheap path, check whether it forecloses a future direction: if a shortcut is a one-way door
(a field that can't be added later without stranding deployed devices, a data shape that can't grow without a
breaking migration), avoiding the lock-in now is usually much cheaper than undoing it later. Existing examples:
`HELLO`'s reserved auth fields, OTA-capable ESP32 partitions (`mvp-feature-priorities.md`, Tier 0). Worth naming
so it's applied consistently, not re-derived per feature.

**While there is no user base, take the clean shape and ignore compatibility.** Compatibility work exists to protect
something already deployed; nothing is, until user testing starts. An interim field, a legacy alias or a "keep the
old one working" branch is a cost with no beneficiary. The one-way-door rule still applies; most doors are still
open, so walk through the one that leads to the clean design. Mike, 2026-10-25. Recorded with its first
application in `decisions/architecture.md`.

## Node format parity: built-in and custom nodes are one thing

The end state is the Node-RED model — a node is one package (descriptor + device-side Python behavior), core nodes
shipped in a folder ahead of the user's, same format, copyable and editable. The reviewer's test: "could a built-in
be rewritten as a package with no loss." One divergence stays by design (the editor never executes package code —
`custom-node-authoring-scoping.md` Decision 5). Two rules bind new node work:

- **Data-equivalent rule** — a new descriptor capability must have a serializable form, not a JS-function-only
  one. `showIf`, `PortType`-as-function and `outputCount` are the existing corners.
- **One-vocabulary rule** — the custom `.node.json` schema stays a strict subset of the canonical `NodeDescriptor`;
  never a parallel vocabulary that can drift.

Full reasoning: `decisions/node-authoring.md` (2026-10-15).

## Everything is a plugin

Default to making new functionality something a user can extend the same way they extend custom nodes and board
definitions. Before building a feature into the core, ask "could a third party add this without a core change?"
Where the answer is cheap to make yes, do so. It applies to review as much as new work: if an existing feature is
hard-wired into the core that a package or descriptor could carry, name it and propose the extension point.

This is a default, not a mandate. Reasonable exceptions, each decided and stated:

- editor-executed stranger code stays out (the editor never runs package code, Decision 5 above);
- `function` (verbatim user code) and the `gui_*` family are the named built-in-only residue;
- where an extension point would cost more than the feature it generalizes, or would foreclose a settled interface,
  the core-only path is fine -- say why in the change and in the relevant `decisions/` note.

Mike, 2026-10-17.

## Architecture first at subsystem interfaces: MVP-ready is not tester-hardened

Two bars, not one. "MVP" means feature-complete enough to demonstrate and dogfood on hardware we hold; "suitable
for initial testers" is higher. Don't read "we're on the MVP path" as permission to defer structure.

A known architectural problem gets fixed now, in the change that names it: a boundary an agent can couple across
wrongly, a format implemented in more than one place and left to drift, a descriptor with no single home. This is
the one-way-door rule applied to structure — where a cheap-but-wrong shape today becomes a breaking change once
boards and saved flows are in the field. Still not a license to build the general version on spec: the
cheapest-correct default holds *within* a settled boundary.

## Interface specs: read before you implement, change only with permission

Each cross-subsystem interface has one specification artifact; code that touches one is written *against that
spec*, never against a guess or a neighbouring implementation:

- **Wire protocol** — `interfaces/protocol/SPEC.md` + `messages.json`, conformance vectors in
  `interfaces/protocol/vectors/`.
- **Device runtime API** — `interfaces/runtime-api/SPEC.md` + `api.json`.
- **Node descriptor** — `interfaces/node-descriptor/SPEC.md` + `custom-node.schema.json`.
- **Board/processor descriptor** — `interfaces/board-descriptor/SPEC.md` + `{board,processor}.schema.json`.

Each is checked by conformance tests (see `interfaces/*/README.md` and the per-subsystem `AGENTS.md` files).

**Before implementing or changing anything an interface defines, read that interface's spec and run its
conformance test.** If what you need isn't expressible in the spec, stop and raise it — don't widen the code
quietly and leave the spec behind.

**Interfaces change only with Mike's explicit permission.** A session may add conformance vectors and fix an
implementation that has drifted; it may not change a message id, field, framing rule, descriptor shape, or runtime
API signature — or add or remove one — without Mike saying so in the session. Propose the change, state the blast
radius, and wait. **Specs are written for humans and must stay readable.** **Boundaries are enforced
mechanically:** per-subsystem `AGENTS.md` files, `.github/CODEOWNERS`, `editor/test/module-boundaries.test.ts`,
and each interface's conformance test; when a boundary test catches a coupling, fix the coupling — don't relax
the test.

## Commits

Prompt Mike at suitable points to commit — don't assume auto-commit and don't let uncommitted work pile up silently.
Suitable points: after a coherent unit of work lands, before starting something new or risky, and at the end of a
work session regardless of how small the change was.

## Third-party code: pinned, scriptless, gated

Anything fetched from outside the repo — npm packages, Python packages, GitHub Actions, the firmware toolchain,
vendored libraries — is untrusted until it is all three of: **pinned** to an immutable identifier, **installed
without its own code running**, and **covered by a check that fails rather than warns when it changes**.
Per-source pin inventory, exceptions and reasoning: `decisions/third-party-pinning.md`; the ledger is
`docs/third-party-licenses.md`.

## npm / Node.js package use

Warn Mike before installing or adding any npm package — name it, why, and flag before running the install. Then,
where reasonable, [lirantal/npm-security-best-practices](https://github.com/lirantal/npm-security-best-practices):

- **Install with scripts disabled by default** — `npm install --ignore-scripts`; re-enable a specific package's
  install script only after checking what it does.
- **Avoid git-based dependency URLs** — they bypass registry scanning and can ship an `.npmrc` that re-enables
  scripts.
- **Lockfiles and deterministic installs** — `npm ci`, not bare `npm install`, once a lockfile exists; commit the
  lockfile.
- **In `editor/`, the install command is `npm ci --ignore-scripts`.** A plain `npm install` fails on this tree
  (npm 10 arborist bug; incident in `learnings/editor-build-tooling.md`). To regenerate the lock:
  `npm install --ignore-scripts --legacy-peer-deps`, then consume with `npm ci`; never delete the lock.
- **Never blindly bulk-upgrade** (`npm update`, `ncu -u`) — review updates individually.
- **Sanity-check before adding** — recent maintenance, install scripts, `npm pack <pkg> --dry-run` if anything
  looks off. **Prefer fewer dependencies** where reasonable.
- **Never run arbitrary `npx <package>`** — pre-install into a lockfile-tracked location first.
- **Always run `npx` with `--no`** when the package isn't already a project dependency — npm silently assumes
  `--yes` in a non-interactive shell; `--no` makes npm refuse.

## Check for stray compiled `.js` before trusting any test/tsc run

`editor/src` and `editor/test` are TypeScript-only — a `.js` file next to a `.ts` source is never intentional.
`npx tsc --noEmit` has been observed not to respect the flag in sandboxed shells, and stale output then silently
shadows real sources at module-resolution time — no error, just wrong behavior. So: run
`find editor/src editor/test -name "*.js" -type f` before trusting any test/tsc result; if non-empty, delete
(`-delete`) before testing. Prefer the direct binary, `./node_modules/.bin/tsc --noEmit`, over `npx tsc`.

## `device-runtime/src` changes: run the real MicroPython suite, not just `py_compile`

`python3 -m py_compile` only proves a file parses — it has already missed a real runtime bug
(`learnings/micropython-device-runtime.md`, the CBOR `None`-encoding bug, 2026-09-05). `device-runtime/test/`'s
suite is what exercises this code; it needs `micropython` and `mpy-cross`, neither vendored — the build recipe is
in `device-runtime/test/README.md`, in a throwaway/scratch location (never the shared Mac mount). Run it whenever
a change touches `device-runtime/src` in a way that could actually run.

## Authored flows read left to right

When you write or generate a flow file — `test-flows/`, docs examples, anything handed to someone — lay it out left
to right, kept visually tight (columns ~220 px, ~36 px between stacked nodes, ~66 px between chains; full rules in
`docs/user-guide/ai-authoring.md#layout`). `editor/dist-cli/thingstudio-compile.mjs --relayout <flow.json>` lays it
out, `--layout` checks it, and `editor/test/flow-layout.test.ts` fails the build for a shipped flow with a leftward
wire. A user's own flow keeps their layout. Mike, 2026-10-22; "kept tight", 2026-10-23. Background:
`decisions/flow-authoring.md`.

## Third-party software tracking

`docs/third-party-licenses.md` is the running ledger of every third-party dependency — runtime/platform components,
build tooling, anything vendored — with its license. Keep it current in the same change: a new npm package, a newly
vendored library, or a platform/runtime component decision each gets a line immediately, pulling version/license
from the installed package metadata, not memory.

## Device-runtime version bump discipline

`_RUNTIME_VERSION` (`device-runtime/src/listener.py`) and its manually-mirrored `EDITOR_TARGET_VERSION`
(`editor/src/app/main.ts`) gate deploys, but `decideDeploy()` only blocks on a `major` mismatch.

**Rule:** any change to a file `deploy_runtime.py` pushes onto real hardware gets evaluated, in the same change,
for whether it's breaking — and if so, both numbers get bumped together, in the same commit. **Breaking:** could
an editor with this change's codegen produce a flow that a board running the OLD `runtime.py` would fail to run
correctly? If yes — even for only some node types — bump `major`. That's the only level enforced. Reserve "no
bump" for changes with no codegen-visible effect at all. This is blunter than textbook semver — most additions end
up `major` — a known, accepted cost; if the granularity becomes a real pain, revisit `decideDeploy` itself, don't
quietly under-bump. Origin (the `register_trigger` bug): `learnings/micropython-device-runtime.md`.

**Automatic backstop, non-blocking:** `test-flows/deploy_runtime.py` stamps a board with a git SHA of
`device-runtime/src`; the board echoes it back in HELLO as `runtimeBuild`; the editor warns on mismatch
(`checkRuntimeBuild`). Diagnostic only. `runtimeBuild: null` means "can't confirm," not "confirmed stale."

## Human-facing documentation: concise, not exhaustive

Applies to documentation written *for people to read* — end-user docs, READMEs, anything handed to someone as
their whole picture of how to do something. Not to working-notes files, the design doc, or this file. Default
output tends toward exhaustive; human-facing docs should state what a thing is and how to use it — short
sentences, short paragraphs, definitions over elaboration, an example only where one clarifies. **Style guide:**
`docs/working-notes/docs-style-guide.md` (draft, 2026-10-11). Read it before writing or editing anything in
`docs/user-guide/`.

## Handoff/briefing note filenames: lead with the topic, not "next-session-picks"

Before naming or writing the handoff file, actually do this, in order:

1. Write down the one-sentence topic of the session in your own head first — what this session actually *did* or
   *is handing off* (not "what's next"; that's the content, not the topic). That sentence is where the name comes
   from.
2. Turn it into a short kebab-case phrase (3-6 words), plus `-briefing.md`. A date suffix only if another briefing
   already uses that exact topic phrase.
3. The string `next-session-picks` must not appear in the filename you're about to write. If it does, you've
   defaulted to the deprecated pattern — stop and go back to step 1.
4. Check the new name against `ls docs/working-notes/*briefing*.md` for a collision or near-miss, disambiguate if
   needed.

**A brief's environment facts cover every toolchain the session used, not just the device** — commands that work
and don't included. Incident history (violated once after being written down; a brief missing its npm line cost
Mike an hour): `decisions/handoff-notes.md`. Existing `next-session-picks-briefing-*.md` files stay as-is.

## Decisions and learnings logs

`docs/working-notes/decisions.md` and `docs/working-notes/learnings.md` are each a short index — one line per
topic, pointing at that topic's own detail file under `decisions/` or `learnings/`. Read the index to orient
fast; open only the detail file(s) matching your task's topic — read everything only for genuinely cross-cutting
work.

A design rule Mike states ("X should always work like Y") goes into `decisions/` the day he states it, even when
building it waits: a rule parked only as an `outstanding-items.md` entry doesn't bind the work done meanwhile.
The hardware-singleton rule was lost for a month this way (`decisions/hardware-singletons.md`, History).

Update in the same change, not batched for later: a session writing a `Status: decision`/`Status: resolved` note
adds one line to the relevant `decisions/<topic>.md` (a new topic gets a new file plus an index entry);
a session hitting a surprising platform behavior, library gotcha, test-methodology trap, or hardware quirk does
the same in `learnings/<topic>.md`. If a learning turns out to be a repeatable process rule, promote the *rule*
to its own section in this file, keep the *incident* in `learnings/<topic>.md` — see `learnings.md`'s "Already
promoted to the project rules". `outstanding-items.md` is the third leg — current open work, not history.

## Line length in markdown working-notes files

Wrap prose at under 120 characters per source line, continuation lines indented to align under the bullet/point
they belong to. Applies to this file and to `docs/working-notes/decisions.md`/`outstanding-items.md`/
`learnings.md` and their per-topic detail files. A one-line index/pointer entry still counts as one logical entry
even when its text wraps across several physical source lines — the constraint is line width, not entry count.
Markdown headers are exempt. Governs new and edited content going forward — not a retroactive rewrap of every
existing file.
