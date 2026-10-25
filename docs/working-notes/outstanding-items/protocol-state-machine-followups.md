# Protocol state machine: follow-ups left after the merge

Status: open, pointers only. Added 2026-10-25 from the "Later" list of
`protocol-state-machine-merged-briefing.md`, when that work was already merged and released (PR #3,
v0.6.0, runtime 13.1.0) and the brief was found to be stale. Nothing here blocks anything; each item is a
piece of tidying or a drift risk the merge session named and deliberately deferred.

## 1. Version history lives in a code comment

`_RUNTIME_VERSION` in `device-runtime/src/listener.py` is a 4,888-character line of version history, and
`EDITOR_TARGET_VERSION` in `editor/src/app/main.ts` is 2,537 characters. They are hand-mirrored, and the
2026-10-23 architecture review already asks for one source or a drift test.

Why it is not just cosmetic: the version comment is the only place the reason for a bump is recorded, and it
sits in a file `deploy_runtime.py` pushes to hardware, so every reader of the deploy path scrolls past a wall of
prose. The fix is a `CHANGELOG` (or `docs/` page) as the human record, with the two constants reduced to the
number plus a pointer. Keep the two in step, then decide whether a drift test is still worth having once the
duplication is gone. Raised 2026-10-24.

## 2. God files: `main.ts` and `listener.py`

`editor/src/app/main.ts` is 3,333 lines and `device-runtime/src/listener.py` is 1,295. Board settings, restart,
exec and connect still use ad-hoc `waitForMessage` waits in `main.ts` rather than a table.

They are the next candidates for `editor.*` machines in `states.json`: the same treatment the transfer path
got, so the waits become named states with one failure each instead of stacked timeouts. Not scoped; the split
of each file is the real question (what stays, what moves), and the answer should follow the machines rather
than being a line-count exercise. Raised 2026-10-24.

## 3. `deps._RESERVED` is hand-kept next to `runtime_manifest.CORE_FILES`

Two lists say which runtime files a board must not lose: `deps._RESERVED` in
`device-runtime/src/deps.py` and `runtime_manifest.CORE_FILES` in the runtime API's generator. Nothing compares
them, so a new core file can be added to one and not the other, and the failure would show up as a library push
deleting a file the board needs.

Fix: a test that asserts the two sets are equal (or that one is derived from the other, which is better if the
import graph allows it). Cheap, and it closes a class of silent breakage rather than an instance. Raised
2026-10-24.

## 4. Library streams are dropped only by a `DEP_COMMIT`

`deps._streams` holds a `Stream` per in-flight library transfer, and an abandoned transfer (editor disconnects
mid-library) leaves a small entry behind until the board restarts. It is bounded (one per library name, and a
later transfer replaces it), so it is a leak rather than an unbounded growth.

Not fixed on purpose: any expiry or cleanup is a second path through transfer state, and the project's rule is
one deterministic path per step. If it is fixed, the choice is between a named timeout state in
`states.json` and leaving it as documented behaviour; do not add a silent sweep. Raised 2026-10-24.
