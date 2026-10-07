# Vendored: `ThreadSafeEvent`

Source: [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async),
`v3/threadsafe/threadsafe_event.py` on the `master` branch. License: MIT
(confirmed via the file's own header comment and the repo's root `LICENSE`
file, both fetched and read directly — not inferred from the GitHub UI's
license badge alone).

Fetched 2026-08-17. Pin reference: commit `0fb2f22d1b130d63be2ec4d66958c4f6eb8106b3`
(2024-05-09, "Docs and code: Remove all references to uasyncio.") — the last
commit to actually touch this file, per GitHub's per-path commit history
(`api.github.com/repos/peterhinch/micropython-async/commits?path=v3/threadsafe/threadsafe_event.py`),
not just the `master` HEAD at fetch time. Tighter than `mqtt_as`'s own pin
(that README flagged its own version-tag-only pin as "worth tightening to an
exact commit SHA next time" — this is that tightening, applied to a new vendor
entry rather than going back to fix `mqtt_as`'s).

SHA-256 of the vendored file as committed: `8e5774d9867538cd04a0780d3142c7831ce36ba0385bff675bb68763cadcf78b`.
Honest caveat on verification, matching `mqtt_as/README.md`'s own convention
of saying plainly what wasn't checked: this was fetched via a web-fetch tool
in an environment with no direct outbound network access from the shell, so
the copy here was transcribed from that fetch's returned content and
syntax-checked (`ast.parse`, real Python) rather than byte-diffed against a
second independent download — a second fetch attempt in the same session was
served from the fetch tool's own cache rather than hitting the network again,
so it doesn't count as independent confirmation either. Worth an actual `diff`
against a fresh clone the next time someone has normal shell network access,
before relying on this for anything security-sensitive, same as `mqtt_as`.

## Why vendored rather than hand-rolled

MicroPython's built-in `asyncio.ThreadSafeFlag` is the primitive this class
wraps, and it's already the officially documented mechanism for signaling
`asyncio` from a hard ISR or another core — there's nothing to hand-roll at
the primitive level. What `ThreadSafeEvent` adds on top is real, non-trivial
logic worth not re-deriving: `ThreadSafeFlag` only supports a single waiting
task, but the interrupt node's own coroutine is the only consumer here, so
that alone wouldn't force vendoring. The actual reason is correctness under
task cancellation — `wait()`'s `try`/`except asyncio.CancelledError` branch,
which re-arms a background `_waiter()` task so a `.set()` that races a
cancelled `wait()` isn't lost — is exactly the kind of subtle concurrency bug
`CLAUDE.md`'s fault-handling priority says isn't worth re-deriving from
scratch when a maintained, widely-used implementation already exists and is
small enough to audit in full (32 lines, read start to finish as part of this
vendoring, not skimmed).

## Why this file specifically, not the whole `threadsafe` package

The upstream `v3/threadsafe/` directory (installed as a unit via `mip`) also
ships `message.py`, `threadsafe_queue.py`, and `context.py` — a `Message`
class (event + payload), a fixed-capacity thread-safe queue, and a
thread-pool-style `Context` class for offloading blocking calls to another
core. None of that is needed here: the interrupt node only needs a single
signal from a hard-IRQ handler to one waiting coroutine, exactly what
`ThreadSafeEvent` alone provides. `threadsafe_event.py` has no import beyond
stdlib `asyncio` — no dependency on the other files in the package — so
vendoring it standalone (not the package's `__init__.py`, which just
re-exports all four) is both correct and matches this project's "prefer
fewer dependencies" convention (`CLAUDE.md`): pull in the one class actually
used, not the whole grab-bag it happened to ship alongside.

## Hard-IRQ safety — the actual question this vendoring exists to answer

Confirmed against upstream's own docs
(`v3/docs/THREADING.md`, §3.1 "Threadsafe Event"), not inferred from the
class name: *"The `set` method may be called from an ISR or from code
running on another core."* Tracing why that's true rather than taking the
doc's word alone: `ThreadSafeEvent.set()` (this file, above) does exactly one
thing — `self._tsf.set()`, a call straight through to `asyncio.ThreadSafeFlag`,
MicroPython's own built-in primitive, specifically documented (upstream
`THREADING.md` §1.6, "Allocation") as usable from a hard ISR because it
performs no heap allocation — hard ISRs are disallowed from allocating at all
(an exception is raised if attempted), so a primitive that's safe there has
to be allocation-free by construction, not just "usually fine." `set()`
itself allocates nothing (no new object, no list/dict mutation, just a flag
set on an existing object) and calls nothing but that one built-in method.
The node's own generated `machine.Pin.irq()` handler (`node-library/interrupt.ts`)
is written to do only this — call `.set()` and return — matching this file's
own demonstrated hard-ISR usage example (`THREADING.md` §3.1, a `pyb.Timer`
callback calling `evt.set()` directly).

## Deploy note (same real gap `mqtt_as` already flags, not new)

Same as `mqtt_as/README.md`'s own "Deploy note" — nothing in this repo's
compile/deploy pipeline yet pushes `vendor/` alongside the flow module to a
real device. The interrupt node's generated code does
`from threadsafe_event import ThreadSafeEvent`, which only resolves on-device
once this vendored file is actually part of whatever gets pushed to the
device's filesystem. Not this vendoring step's job to fix; tracked once,
under `mqtt_as`'s entry, not duplicated per vendored dependency.

**2026-10-07 — flow dependencies.** Superseded: vendored libraries are no longer pushed at runtime install.
`device-runtime/runtime_manifest.py`'s `DEPENDENCIES` lists them, and Deploy installs the ones a flow imports into
the board's `/lib` (`docs/working-notes/flow-dependencies-scoping.md`).
