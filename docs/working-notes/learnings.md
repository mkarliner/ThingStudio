# Key learnings

Status: index, started 2026-08-19. An append-only ledger of hard-won
technical facts and gotchas — things that cost real time to discover and
will bite again if forgotten, but aren't a behavioral rule for how a
session should operate (that's `CLAUDE.md`'s job — a few of these
*did* get promoted there, e.g. the git-lock issue and the stray-`.js`
issue, and are cross-referenced rather than duplicated below). Each entry
is short: what was learned, why it matters, where the full story is.

**Maintenance rule:** whenever a session hits something like this — a
surprising platform behavior, a library gotcha, a test-methodology trap,
a hardware quirk — add one line here in the same change, not batched for
later. If it turns out to be a repeatable process rule Claude should
always follow (not just a fact worth knowing), promote it to `CLAUDE.md`
instead, and leave a pointer here rather than duplicating the text.

---

**2026-09-06 pass:** split every topic section except this one out into its own file under `docs/working-notes/learnings/`, same reasoning and pattern as `decisions.md`'s own split the same day — this file is now a fast index, not something to read end to end regardless of task. While in there, folded in the full incident narratives for two of the five rules below that had been living only in `CLAUDE.md` (the `register_trigger` version-bump incident and the npm/vitest native-binding incidents) — `CLAUDE.md` itself was trimmed to just the operative rules, pointing here for the "why." Nothing here was reworded or deleted otherwise.

## Already promoted to `CLAUDE.md` (standing rules, not repeated here)

Five standing rules started as findings here and got promoted to `CLAUDE.md`
once they turned out to be repeatable process rules, not just facts worth
knowing. CLAUDE.md carries the rule itself; this file carries the incident
that motivated it, so CLAUDE.md doesn't have to.

- **Git writes from the agent sandbox leave stale `.git/*.lock` files
  behind** on the live-mounted repo (confirmed for `.git/index.lock`,
  `.git/HEAD.lock`, `.git/objects/*/tmp_obj_*`) — `git add`/`git commit`
  never run from the sandbox, ever. `CLAUDE.md`, "Git writes from the agent
  sandbox."
- **Stray compiled `.js` files can shadow real `.ts` sources** when a
  sandboxed `npx tsc --noEmit` silently doesn't respect the flag — check
  and delete before trusting any test/build result. `CLAUDE.md`, "Check for
  stray compiled `.js`..."
- **`npm install`/`build`/`test` against the live-mounted `editor/`
  corrupts `node_modules` for Mike's Mac** (Linux native bindings written
  over darwin ones). Full incident detail:
  `docs/working-notes/learnings/editor-build-tooling.md`.
- **`device-runtime/src` changes need a breaking-change judgment call and a
  matching version bump**, backed by an automatic git-SHA marker check.
  Full incident detail (the `register_trigger` bug):
  `docs/working-notes/learnings/micropython-device-runtime.md`.
- **`py_compile` is a syntax check, not a test** — verify any
  `device-runtime/src` change that could actually run against the real
  MicroPython suite. Full incident detail (the CBOR `None`-encoding bug):
  `docs/working-notes/learnings/micropython-device-runtime.md`.

## MicroPython / device-runtime

Device-side runtime gotchas: `readline()` over `read(n)`/`readexactly(n)` for binary payloads, `mpy-cross` RAM headroom, the ESP32-C3's untrustworthy RNG without radio, no first-class `asyncio` UDP, boards with no auto-reset, client/device timeout mismatches, the `active(True)`-vs-`.connect()` WiFi race, `py_compile` vs. the real MicroPython suite, CBOR `None`-handling, and the `register_trigger` version-bump-discipline incident. 10 entries: `docs/working-notes/learnings/micropython-device-runtime.md`.

## Hardware bring-up / HIL rig

Witness-rig wiring gotchas (floating pins, long patch wires, first-`.irq()` `MemoryError`), Thonny's keyboard-interrupt-on-connect trap, Rete's `width`/`height` as a real rendering clipping budget. 5 entries: `docs/working-notes/learnings/hardware-bringup-hil-rig.md`.

## Editor / build tooling

`vite build` not type-checking, Litegraph's file-picker extension-matching gap, `execFileSync` deadlocking against an in-process test server, Node's chunked-transfer default, and the sandbox/`node_modules` native-binding corruption incidents. 5 entries: `docs/working-notes/learnings/editor-build-tooling.md`.

## Backend / security research

WebSocket same-origin/DNS-rebinding gaps, the WebSocket custom-header limitation, checking a dependency's real release activity (Python this time), verifying a citation by direct inspection, current browser transport support (WebSerial/Web Bluetooth). 5 entries: `docs/working-notes/learnings/backend-security-research.md`.

## Cowork remote-device testing environment

The cloud session's own staged mirror of the repo can be a partial snapshot — don't trust it for a real test/typecheck signal without confirming the full tree is present; a plain file on the shared live mount can also silently lose content mid-edit if something else writes to it at the same time, with no lock file to flag it. 2 entries: `docs/working-notes/learnings/cowork-remote-device-testing.md`.

## Custom node authoring

A custom node's top-level code runs inside a generated per-instance wrapper, not true module scope — `nonlocal`, not `global`, for persistent state. 1 entry: `docs/working-notes/learnings/custom-node-authoring.md`.

## Reusable patterns worth remembering

A bounded, drop-oldest ring buffer for queued outbound messages — `mqtt_as`'s own `MsgQueue` is a validated precedent. 1 entry: `docs/working-notes/learnings/reusable-patterns.md`.
