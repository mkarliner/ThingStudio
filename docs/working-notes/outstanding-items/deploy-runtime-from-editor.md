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
