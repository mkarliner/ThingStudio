# Device runtime API and dependency manifest — v1 specification

Status: v1, shipped. This is the second cross-subsystem interface (after `../protocol/`). It is the contract
between the **editor's generated flow code** and the **device runtime** it runs on: what names generated Python may
call on the `runtime` module, and what the runtime's own file/dependency manifest looks like. Get it wrong and a
deploy fails on a real board with an `AttributeError`, far from the mistake.

The authoritative surface list is `api.json`. The design intent is design doc §5 (execution model, fault isolation)
and §7 (runtime API surface, flow dependencies).

## 1. The `runtime` module

Every compiled flow does `import runtime` and reaches the scheduler, fault boundary, keyed hardware singletons and
reporting through it. Generated code must only ever touch the names in `api.json`; nothing else on the module is
part of the contract.

| Name | Kind | Caller | Signature | What it does |
|---|---|---|---|---|
| `asyncio` | attribute | codegen | — | The `uasyncio` module. Generated code does `asyncio = runtime.asyncio` and then uses `asyncio.sleep_ms`, `asyncio.create_task`, etc. |
| `spawn` | function | codegen | `spawn(coro, node_id=None)` | Runs one generated coroutine under the per-task fault boundary. `node_id` is the chain's source node, the fallback attribution for an exception not already tagged by `NodeError`. |
| `NodeError` | class | codegen | `NodeError(node_id, orig)` | Raised by a generated per-node call wrapper to tag which node raised, before the boundary catches it. `node_id` is a string. |
| `register_cleanup` | function | codegen, user | `register_cleanup(key, fn)` | Registers a callable to run on teardown (redeploy). First registration for a key wins, so two nodes sharing a resource register it once. |
| `register_trigger` | function | codegen | `register_trigger(node_id, event)` | Registers a source node's live-trigger event object under its node id. Overwrites (node ids are unique). |
| `report_status` | function | codegen | `report_status(node_id, state, text=None)` | Pushes a `NODE_STATUS` message. `state` must be one of the protocol's states; a bad value raises `ValueError`. Not a fault — it never unwinds a coroutine. |
| `start_reason` | attribute | codegen | — | Why the flow started ("deploy", "power_on", "hard_reset", "soft_reset", "watchdog", ...). Generated startup code reads it with `getattr`, so it is tolerant of older runtimes. |
| `_report_error` | function | codegen | `_report_error(node_id, exc)` | Reports a fault without raising, so a transform can keep running. Underscored but codegen-facing (the `filter` node calls it). |
| `shared` | function | codegen, user | `shared(kind, key, signature=None, factory=None)` | The keyed hardware singleton (Peter Hinch's functor_singleton, keyed). First caller builds with `factory()`; later callers get the same object. A different `signature` raises naming both. No factory only fetches (raises `KeyError` if unbuilt). |
| `settings` | attribute | codegen, user | — | The device settings store (`device_settings.py`): a persistent, flow-name-namespaced key/value for application values. `get(key, default=None)`, `set(key, value)`, `delete(key)`, `keys()`. |
| `fire_trigger` | function | listener | `fire_trigger(node_id)` | Fires a source node's live-trigger event. Called by the listener on a `TRIGGER` message; an unknown id is logged and ignored, never fatal. |
| `cancel_running` | function | listener | `async cancel_running()` | Cancels the flow's tasks, clears triggers and singletons, then runs cleanups. Called by the listener on redeploy. |
| `on_node_error` | attribute | listener | hook | Set by the listener: `on_node_error(node_id, exception_type, exception_message)`. Must never raise. |
| `on_node_status` | attribute | listener | hook | Set by the listener: `on_node_status(node_id, state, text)`. Must never raise. |

`_guarded` is private (only `spawn` calls it) and listed for completeness.

**Fault boundary.** `spawn` wraps every coroutine so an uncaught exception is caught *inside* the task and reported
through `on_node_error` (or printed when no listener is attached); the task completes normally and the rest of the
flow keeps running. A `CancelledError` (a redeploy) propagates untouched — it is not a fault.

**Who calls what.** `caller` in `api.json`:
- `codegen` — emitted or referenced by compiled flow code. All of these must exist or a deploy breaks.
- `codegen, user` — also documented for hand-written node Python (`docs/user-guide/custom-nodes.md`).
- `listener` — the device listener only; not generated code.
- `internal` — private.

**Device settings store (`settings`).** A persistent, device-wide key/value store for application values (a
GUI settings page's colour scheme, units). Values are namespaced by the deployed flow's `flowName`, so the
same flow keeps its values across a reboot or redeploy, and a different flow cannot read or overwrite them.
`get(key, default=None)`, `set(key, value)`, `delete(key)` and `keys()` operate on the current namespace.
A missing key returns `default`; `set` raises `SettingsError` (with the key in the message) on a full/read-only
filesystem or an unencodable value. A corrupt file is moved aside and the store starts empty, so a bad
settings file can never prevent boot. Maintenance — `namespaces()`, `clear()`, `clear_all()`, `prune()` — is
reachable from the console as `settings` and is not part of the node-facing surface. Full design:
`docs/working-notes/device-settings-store-scoping.md`.

## 2. The module manifest

`device-runtime/runtime_manifest.py` (host-side metadata, never pushed to a board) is the one file list for a
runtime install. `test-flows/deploy_runtime.py` and `backend/src/thingstudio_backend/runtime_installer.py` both read
it, so the two install paths cannot drift.

| Field | Meaning |
|---|---|
| `CORE_FILES` | Modules copied as-is onto the board (everything the listener imports at module scope). |
| `LISTENER_FILE` | Installed as `main.py`, so the board boots into it. |
| `DEPENDENCIES` | The flow-dependency catalog (below). |
| `LEGACY_ROOT_FILES` | Files older runtimes put in the board root; a runtime install deletes them, since the root precedes `/lib` on `sys.path`. |

## 3. The dependency catalog

Each `DEPENDENCIES` entry describes one library a flow can import:

| Field | Meaning |
|---|---|
| `name` | What the board's index and the `DEP_PUT`/`DEPLOY` messages call it. Equal to the module name, so the editor maps an `import x` straight to it. |
| `files` | `(path under `device-runtime/src/vendor/`, file name on the board)`. Every file name minus `.py` is a module the library provides. |
| `requires` | Other libraries this one imports; the editor installs those too. |

The editor fetches this catalog from the backend at `/api/dependencies`, which validates it (names, files present,
`requires` known, no cycles). On deploy the editor installs the libraries the flow actually imports into the board's
`/lib` and removes ones no flow needs; `device-runtime/src/deps.py` owns the on-device file management.

## 4. Versioning

The runtime reports `runtimeVersion` (major.minor.patch) in `HELLO`. The deploy gate
(`editor/src/protocol/version.ts`) blocks a deploy only on a **major** mismatch, so any change that alters what
generated code requires from the runtime is a major bump — see AGENTS.md's device-runtime version-bump discipline.

## 5. Conformance

The surface exists in four places that must agree: the real `device-runtime/src/runtime.py`, the editor's test
fixture `editor/test/fixtures/pymock/runtime.py` (which generated flow code actually runs against in editor tests),
the generated code itself, and the documented user-facing API.

- `editor/test/runtime-api-conformance.test.ts` — every `api.json` name is present in `runtime.py` with the right
  kind; every `codegen` name is present in the editor's `pymock` fixture (otherwise editor tests would pass against
  a fictional API); and no `editor/src` codegen source references a `runtime.<name>` outside `api.json`.
- `device-runtime/test/test_runtime_api.py` — imports the real `runtime` under MicroPython and asserts the
  documented surface is present and of the right kind.

Runner: same rule as the wire protocol — read this spec and `api.json` before changing anything that emits or
provides these names, and change the interface only with Mike's explicit permission.
