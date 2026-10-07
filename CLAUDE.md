# Project rules for Thingstudio

@AGENTS.md

Behavior Preferences
Keep responses concise and focused on code.Do not repeat large blocks of unchanged code in explanations.Provide complete, copy-pasteable files when rewriting components.

Orientation for anyone (human or Claude) picking this project up: `docs/thingstudio-design-doc.md` is the design doc,
`docs/working-notes/` is active planning. Read the design doc in full before proposing architecture changes.

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

## Install instructions: never `curl | sh` alone

Piping a downloaded script into a shell (`curl ... | sh`, `irm ... | iex`) is widely regarded as unsafe, and many
readers will hesitate or refuse. Wherever docs give an installer one-liner, give a plain download (the GitHub
releases page) alongside it as an equal choice, and say how to read the script before running it. Mike,
2026-10-01.

## Any work that impacts the user experience should update the user documentation to reflect that.

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

## Commits

Prompt Mike at suitable points to commit — don't assume auto-commit and don't let uncommitted work pile up silently.
Suitable points: after a coherent unit of work lands (a doc section resolved, a feature/module working), before
starting something new or risky, and at the end of a work session regardless of how small the change was.

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
  lockfile.
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

## Git writes from the agent sandbox

The agent sandbox and Mike's real Mac share the same live-mounted repo, and the sandbox cannot delete files it just
created there (`Operation not permitted` on unlink) — confirmed for `.git/index.lock`, `.git/HEAD.lock`, and
`.git/objects/*/tmp_obj_*`. `git add`/`git commit` from the sandbox routinely leave one of these behind, which then
blocks the *next* git command (from either side) until someone with real delete permission — Mike, in a real Terminal
— removes it.

Read-only git commands from the sandbox (`status`, `log`, `diff`) are fine to run for what they report, but **they are
not lock-free** -- confirmed 2026-09-12: a plain `git status -sb` from the sandbox left a `.git/index.lock` behind
(git's own opportunistic index-refresh writing the index during a status check), which then blocked a real
`git commit` run from Mike's own Terminal minutes later, silently -- the commit just didn't happen, `git status` kept
showing everything as modified, and it took an explicit `rm -f .git/index.lock` from Mike's Terminal to clear it. So:
before handing Mike any `git add`/`git commit` sequence to run himself, also tell him to `rm -f .git/index.lock` first
regardless of what ran in the sandbox before it -- don't assume a prior read-only sandbox command left no lock just
because it didn't write anything. For writes (`add`, `commit`) themselves, still hand Mike the exact command(s) to run
himself in a real Terminal, rather than running `git commit` from the sandbox. Full incident: `learnings.md`'s
"Already promoted to `CLAUDE.md`" section.

## npm install / build / test from the agent sandbox

Same shared-mount hazard as the git-lock issue above, different symptom: never run `npm ci`/`npm install`,
`vite build`, `vite dev`, or `vitest`/`npm test` from the agent sandbox directly against the live-mounted `editor/`.
`make` counts too: every target except `clean`/`distclean` runs npm, and it builds a `.venv` of Linux binaries.
The sandbox (`device_bash`) is a Linux VM; Mike's Mac is darwin — packages with platform-specific native bindings
(rollup, esbuild/rolldown, etc.) get installed as their Linux build into the shared `node_modules` tree, breaking the
identical files on Mike's Mac afterward. Confirmed twice — full incident detail:
`docs/working-notes/learnings/editor-build-tooling.md`.

Read-only checks (`node -v`, whether `node_modules` exists at all, reading `package.json`) are fine from the sandbox.
For anything that writes into or resolves through `node_modules` for real — install, build, dev server, test run —
hand Mike the exact command(s) to run himself, same pattern as git writes. If the sandbox genuinely needs its own
test/build signal, extract the project (excluding `node_modules`) into the cloud session's own workspace and run
`npm ci` fresh there instead of touching the shared mount.

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
live there) carries none of the cross-platform-native-binary risk the npm/`node_modules` restriction above exists for,
so — unlike `npm`/`vitest`/`tsc` — this is safe to build and run directly from the agent sandbox or a device-bridge
session. Do this whenever a change touches `device-runtime/src` in a way that could actually run, not just
`py_compile` it and call it verified.

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

**Interim style reference, until we have our own:** Mike pointed at
[Node-RED's "Concepts" page](https://nodered.org/docs/user-guide/concepts)
as the shape to aim for — short (10–20 word) sentences, 3–4-sentence
paragraphs, a neutral/direct tone with no flourish, one clarifying
sentence per concept rather than a paragraph, and links out to
"Working with..." pages instead of embedding that detail inline. Not a
license to copy its wording — a reference for pacing and register while
we work out our own house style. Once Mike's happy with a piece written
this way, write the actual style guide from that example and replace this
paragraph with a pointer to it.

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

Existing `next-session-picks-briefing-*.md` files are left as-is -- this only governs naming going forward, not
a retroactive rename pass.

## Decisions and learnings logs

`docs/working-notes/decisions.md` and `docs/working-notes/learnings.md` are each a short index — one line per topic,
pointing at that topic's own detail file under `docs/working-notes/decisions/` or `docs/working-notes/learnings/`
(split out 2026-09-06 specifically so a session doesn't have to read either log end to end regardless of task). Read
the index to see what topics exist and orient fast; open only the detail file(s) matching your task's topic, not the
whole set — read everything only for genuinely cross-cutting work (a new architecture decision, or a dedicated
audit/consolidation session).

Update in the same change, not batched for later: any session that writes or updates a
`Status: decision`/`Status: resolved` note, or resolves a design-doc open question, adds one line to the relevant
`decisions/<topic>.md` file (a new topic gets a new file plus a new index entry in `decisions.md`); any session that
hits a surprising platform behavior, library gotcha, test-methodology trap, or hardware quirk worth remembering does
the same in `learnings/<topic>.md`. If a learning turns out to be a repeatable process rule (not just a fact worth
knowing), promote the *rule* to its own section in this file, keep the *incident* in `learnings/<topic>.md`, and
cross-reference the two — see `learnings.md`'s own "Already promoted to `CLAUDE.md`" section for the precedent (five
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
