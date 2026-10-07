# Flow dependencies — scoping

Status: built 2026-10-07 on the `flow-dependencies` branch, runtime 7.0.0, then 8.0.0 (pieces, below); tested off-device (unix port, vitest,
pytest), not yet on hardware. "Built" notes below mark where the build differs from the first sketch.
Replaces the "selective vendor push" P4 item in `outstanding-items.md` (2026-09-17). Phase 1 of
`gui-layout-widget-system-scoping.md`'s phasing, and the module-push mechanism design doc §7 sketches.

## The problem

Every vendored library (`runtime_manifest.py`'s `VENDOR_FILES`: `mqtt_as`, display drivers, `bme280_float`,
switch primitives, ~76KB of source) goes onto every board at runtime install, whether its flow uses it or not.
Each new driver adds to every board's flash. The GUI work (framework, widgets, fonts) would make that a real cost
on a 2MB Pico (`decisions/gui-layout.md`, 2026-10-06 Pico constraint).

Read from the code, 2026-10-07: the runtime itself imports none of the vendored libraries (`listener.py`,
`runtime.py`, `net_transport.py` etc. use only firmware modules). Every vendored library exists for some node a
flow uses. Only one vendored library needs another: `events.py` imports `delay_ms`.

## Decisions (Mike, 2026-10-07)

1. **Name: flow dependencies.** A flow declares the libraries it needs; Deploy installs them.
2. **Delivered with Deploy, through the running listener,** not at runtime install. Works over USB and WiFi, sends
   only what's missing or changed, and gives custom nodes (`outstanding-items/custom-node-authoring.md`) a route
   for their own modules later.
3. **Unused dependencies are removed** once the new flow is running. Flash stays lean; switching back costs one
   resend.

## Design (recommended, not decided)

### Registry

`VENDOR_FILES` becomes a **dependency registry**: one entry per library with its name, the module(s) it provides,
its source file(s), and the other libraries it `requires`.

**Built:** the list is `DEPENDENCIES` in `runtime_manifest.py` itself, not a separate JSON file. Only Python reads it
(the backend, `tools/build_assets.py`, `test/hil/hil_common.py`), and the backend serves it to the editor as JSON
at `/api/dependencies` (`backend/.../dependencies.py`, which also checks it: names, files present, `requires` known,
no loops). Same single-list property, no new packaging step. A library's name equals its module name.
`LEGACY_ROOT_FILES` names what older runtimes put in the root.

### Compiler: what a flow needs

- Collect the top-level module of every `imports` entry the node codegens return (`from st7789py import ST7789`
  → `st7789py`). Map each to a registry entry; close over `requires`. No per-node changes needed.
- A module not in the registry is assumed to be in the firmware (`machine`, `framebuf`...). Nothing to send.
- **Function nodes:** scan their code for `import x` / `from x import` too. Today a function node can import a
  vendored library because everything is on every board; after this change it would fail on the board unless
  the scan catches it.
- The compiled flow's dependency set (name + content hash) goes to the deploy step and is shown in the deploy log.

### Editor: what to send

- Dependencies are precompiled to `.mpy` in the browser, as runtime files already are (`runtime-precompile`,
  `/api/runtime-sources`). Hash = SHA-256 over each file's name, length and bytes in name order, first 16 hex
  characters (`flow-dependencies.ts`; `hil_common.py` uses the same scheme and a test pins one value).
- **Built:** with no HELLO this connection, Deploy sends `HELLO_REQUEST` first; with no inventory at all it sends
  every library. A `MissingDependency` refusal makes the editor forget the board's inventory, so the next Deploy
  sends everything.
- HELLO gains an additive `dependencies` field: `{name: hash}` for what the board holds. The editor sends only
  entries that are missing or whose hash differs.
- Deploy order: send each needed file, then `DEPLOY` naming the full dependency set.

### Wire protocol (§13)

- **New `DEP_PUT`** (editor → device): `{name, hash, files}`, one per dependency; reply `DEP_RESULT {name, ok,
  code, error, freeFlashBytes}`. **Built (7.0.0):** `files` is a map `{file name: bytes}`, not a list: the device's
  CBOR codec deliberately has no arrays.
- **Changed same day (8.0.0): pieces, then a commit.** A whole library in one message failed on a CYD running a
  display flow: decoding an 11 KB `DEP_PUT` needed one 11 KB block and the heap was fragmented (MemoryError). The
  board logged it but answered nothing, so the editor timed out after 30 s. Now `DEP_PUT {name, file, offset, total,
  data}` carries 1 KB, appended to the file's temp copy, no reply; `DEP_COMMIT {name, hash, files: {file: size}}`
  checks every file arrived whole, installs, and always answers `DEP_RESULT`. A piece the board couldn't read shows
  up as "arrived incomplete (x of y bytes)", plus what the board couldn't read. The editor also cancels pending
  waits on disconnect (a stale 30 s wait had fired in the middle of the next deploy). Frames cap at 64KB (`framing.py`), so a dependency over
  that is split per file, and a single file over it is a compile-time error naming the file. (Largest today:
  `mqtt_as`, 37KB source; smaller as `.mpy`.)
- **`DEPLOY` gains `dependencies: {name: hash}`.** Before importing the flow, the listener checks every one is
  present with that hash. If not: `DEPLOY_ERROR` naming the missing or mismatched dependency, and the previous
  flow is not touched. A clear, attributed failure, never an `ImportError` from deep inside the flow.
- After the new flow imports successfully, the listener removes dependencies not in the set.
- Major version bump for `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION`: an older board can't receive dependencies,
  so `decideDeploy()` must block and say "update the board software".

### On the board

- Dependencies live in **`/lib/`** (on MicroPython's default `sys.path` for ESP32 and RP2), not the root, so the
  runtime's own files and the flow's libraries never mix. Index in `/lib/_deps.json`: `{name: {hash, files}}`.
- Writes go to a temporary name, then rename, then the index is updated, so a lost connection or a full flash
  leaves the old version or nothing, never half a file under the real name.
- Errors are attributed: "no space for `mqtt_as` (needs 21KB, 9KB free)", not a bare `OSError 28`.
- Boards on another port may not have `/lib` on `sys.path`: the listener adds it at boot if missing.
- **Built:** on `DEPLOY`, the listener drops every installed library's modules from `sys.modules` after stopping the
  old flow, so a replaced library is imported fresh, not reused from the previous flow.
- **Built:** `deps.py` (board side, separate from the listener so it tests on its own) holds all of this.

### Migration

Boards installed before this change hold vendored files in the root. Root shadows `/lib` on `sys.path`, so a stale
root copy would win silently. The runtime installer for the new major version deletes the legacy root copies by
name (it knows the old list), and stops pushing them.

### Host tools

**Built:** `test/hil/hil_common.py`'s `deploy_message()` does the same for `deploy_flow.py` and the HIL check scripts
(sends every library, no inventory diff). `deploy_runtime.py` pushes no libraries and deletes legacy root copies.

### Not in scope

- Custom-node modules: same channel later, not built here.
- Dependency versions beyond a content hash (no semver, no ranges): the editor ships the one version it has.
- Partial-update DEPLOY (§8 diffing).

## Testing

- `vitest`: dependency resolution (imports → registry → `requires` closure, function-node scan, unknown module
  treated as firmware), hash/diff against a HELLO inventory, frame-size errors.
- Device runtime on the unix port (CLAUDE.md: the real MicroPython suite, not `py_compile`): `DEP_PUT` write and
  rename, index update, hash check before import, `DEPLOY_ERROR` on a missing dependency with the old flow still
  running, cleanup after success, no-space error attribution.
- `test_listener_integration.py`: a full deploy that ships a dependency, then a second flow that drops it.
- Hardware: an MQTT flow on an ESP32-C3 and a Pico W from a clean install; confirm flash before and after.
- **Not covered:** the editor's Deploy handler itself (DOM, fetch, transport) has no automated test, as before; the
  pure parts it calls are tested. Direct (WebSerial) mode can't fetch the library list, so Deploy refuses with a
  message there (that mode is hidden and frozen).

## Docs owed

User guide: Deploy now installs the libraries a flow needs, and the deploy log lists them. Mention that a function
node's imports are detected the same way.
