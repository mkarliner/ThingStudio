# Deploy the runtime itself from the browser editor, not just compiled flows

Confirmed untracked anywhere until 2026-09-12 (grep across `outstanding-items.md` and every
`outstanding-items/*.md`). Still wanted, priority **P3** (Mike, 2026-09-13).

## What exists today vs. what this asks for

Two genuinely different operations already share the word "deploy," and this item is about the one that isn't
built at all:

- **Flow deploy (built, works today):** the browser's Deploy button sends a §13 `DEPLOY` message -- compiled
  flow bytecode + static data -- over whatever transport is connected (WebSerial direct, or via the backend's
  WebSocket relay). `listener.py`'s `_handle_deploy()` (`device-runtime/src/listener.py` ~line 330) just writes
  those bytes to `_FLOW_PATH`/`_STATIC_DATA_PATH` on the device's filesystem and starts running it -- the
  listener process itself keeps running throughout, unmodified.
- **Runtime deploy (today: `test-flows/deploy_runtime.py`, a standalone hand-run script, not built into the
  editor at all):** pushes `device-runtime/src/*.py` itself -- `listener.py` (installed as `main.py`, so the
  board boots straight into it), `runtime.py`, `messages.py`, vendor libs (`mqtt_as`, etc.) -- via `mpremote cp`
  over the serial port. This is what makes the board able to speak the protocol and run flows at all; a runtime
  deploy is a precondition for any flow deploy ever working, not an alternative to one.

## Why this isn't just "reuse the DEPLOY message"

`DEPLOY` writes one bytecode file while the listener that's already running stays untouched. A runtime deploy
needs to overwrite the listener's own source files -- including the file it's currently executing from
(`main.py`) -- which a running MicroPython process can't cleanly do to itself. `mpremote`'s approach works
because it operates from the host machine against the board's raw REPL/filesystem access, entirely independent
of whatever's currently running on-device.

Doing this from the browser means either:

- A new §13 message type (or small family of them) for writing arbitrary named files to the device filesystem,
  handled by `listener.py` itself -- but `listener.py` would be rewriting its own currently-executing source,
  which needs careful sequencing (write files first, then explicitly `machine.reset()` to actually load the new
  code -- there's no way to "hot-swap" a running MicroPython module), and no visibility into whether the
  in-progress transfer is even a coherent set of files until reset actually happens.
- Or a recovery/bootstrap-mode path that doesn't depend on the currently-running listener at all (closer to what
  `mpremote`'s raw-REPL access does) -- which the direct-WebSerial transport could plausibly implement (Web
  Serial gives raw byte access to the port), but the via-backend transport would need the *backend* to speak
  raw-REPL directly rather than relaying through the listener's own framed protocol, a meaningfully different
  code path from every other backend-relay message today.

## Also relevant once this is picked up

`CLAUDE.md`'s "Device-runtime version bump discipline" section and `version.ts`'s `decideDeploy()`/
`checkRuntimeBuild()` -- a browser-triggered runtime deploy is exactly the mechanism that would make
`_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` mismatches self-correcting rather than something Mike has to notice
and fix by re-running the manual script. Worth designing this item with that in mind rather than bolting version
awareness on afterward.

Not scoped further than this -- needs a real design session (which transport(s) to support first, whether v1
can be direct-WebSerial-only and defer the via-backend case, wire message shape) before it's buildable.

## Scoped, 2026-09-22 -- this is MVP item 1, and the two questions above are answered

Confirmed with Mike before writing any wire-protocol code (this doc's own "needs a real design session" line,
taken literally):

- **Transport: backend-relay only, not WebSerial-direct.** Matches `decisions/backend.md`'s 2026-09-08 entry
  (`direct` mode already hidden in `index.html`, no new investment per the 2026-08-16 addendum) -- Mike's own
  call, confirmed explicitly this session ("web serial is deprecated").
- **This doc's own framing of the two mechanisms as a choice is wrong -- they solve different problems, and
  only one of them solves *this* item.** A board with no runtime at all has nothing listening on the framed
  §13 protocol -- there's no running listener for a new "write-file" message family to reach. So:
  - **Raw-REPL bootstrap (this item's actual mechanism):** the backend drives MicroPython's raw REPL directly
    over the already-open `pyserial` connection `serial_relay.py` already has -- same primitive `mpremote`
    uses, no new dependency (the MVP's own fixed decision already rules out asking users to `pip install
    mpremote`, `serial_relay.py` already depends on plain `pyserial`). This is the only mechanism that works
    for an initial install on a bare-MicroPython board.
  - **A listener-side self-rewrite message family (this doc's other option):** only useful for a board that
    already has *some* working listener -- an in-place runtime *upgrade*, not an initial install. Real, and
    ties into `CLAUDE.md`'s version-bump-discipline section (an auto-correcting `_RUNTIME_VERSION`/
    `EDITOR_TARGET_VERSION` mismatch), but it's a different, separate future item -- not scoped further here,
    not blocking this one.
- **v1 ships a manual "Install runtime" action, not automatic detection.** No preference from Mike on this
  point, so defaulting to the cheaper, faster-to-ship slice: always offer the action when not connected/no
  HELLO, rather than first building the boot-log-based "no runtime" detection
  (`learnings/hardware-bringup-hil-rig.md`'s 2026-09-18 `LISTENER_BOOTING`-line finding) to gate it. Detection
  can be layered on top later without changing the install mechanism itself.

**Still not built** -- this session did item 2's first slice instead (`decisions/editor-connect-errors.md`) and
used the reading this doc asked for to get the above confirmed. Next concrete step: a small raw-REPL client in
the backend (new module, `serial_relay.py`-adjacent -- enter raw REPL, push `device-runtime/src/*.py` + vendor
files, matching `test-flows/deploy_runtime.py`'s own file list, then reset), a new backend control-plane
message pair for the editor to trigger it and get progress/completion back, and a button in `main.ts`. Needs a
real board to verify against, same rigor as every other device-runtime-adjacent change this project has made
(`CLAUDE.md`'s device-runtime test-suite rule doesn't directly apply -- no `device-runtime/src` changes here,
only a new backend-side client speaking to it -- but the raw-REPL push itself still needs a real-hardware pass
before it's trusted, not just reasoned through).
