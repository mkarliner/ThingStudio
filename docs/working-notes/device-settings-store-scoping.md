# Device settings store — scoping (persistent application values)

Status: scoping, 2026-10-17. Proposes; does not commit. Written after Mike stated the three use cases this
session (node state, application settings, share-between-nodes), called **settings-first** ahead of the volatile
context model (`context-model-scoping.md`), and chose **flowName namespacing** plus two recovery paths. Every
interface addition here — the runtime API, and any console/control surface — needs his explicit OK in the session
that lands it (root `AGENTS.md`, "Interface specs").

## 1. What this is

A persistent, **device-wide** key/value store for **application values**: state an app running on the device wants
to keep across reboots. The motivating case is a GUI settings page (a colour scheme, units kg/lbs), but **the
settings page is not the deliverable and is not a core node** — it is an example of the kind of app that needs
persistent values. The deliverable is the store: a small persistent key/value facility that node code (built-in,
package, or function) can read and write.

Not to be confused with three neighbours:

- `context-model-scoping.md` — the **volatile** node/flow context model. Sibling; sequenced after this one. Its
  future device/persistent scope should reuse this store's primitive.
- `local-persistence-scoping.md` / `~/.thingstudio` — **host-side** state (the editor/backend machine). This
  note is about storage **on the board**.
- `tier2-live-streaming-persistence.md` — design doc §5's flash store for **runtime/node state** (a calibration
  constant, a running average surviving a tweak-and-redeploy), node-ID keyed with a per-node opt-out. Same
  storage primitive family, different concept and different keying; it stays POST-MVP.

## 2. The use case (Mike's words)

- "I should be able to have a GUI settings page which persists application values across reboots."
- Examples of the values: a colour scheme; units kg/lbs.
- Nothing about the request implies a `gui_settings` node or any new core node. The page is application work,
  built from the existing GUI/widget family or a custom package; the request explains **why persistent values
  are wanted**.
- **No editor read/set at runtime.** This settles the context model's `STATE_*` question (§12 Q6 there): no wire
  change; persistence is device-internal.

## 3. What exists — the pattern, not the thing

`device-runtime/src/board_settings.py` is already the persistent-board-file pattern:

- `_board.json`, path built with `board_fs.under_root()` (so `/flash` and `/sd` mounts on stm32/pyboard work).
- Atomic write: temp file + `os.rename`, with a direct-write fallback for ports that won't rename over an
  existing file.
- Missing or corrupt file means **defaults**, logged, never a boot failure — the same contract as
  `listener.py`'s `_read_flow_meta()` and `_Store`'s missing-key behaviour.
- Cached in RAM after the first load.
- "Survives deploys and resets: one small JSON file … never touched by DEPLOY."

But its schema is **fixed and board-owned** (hostname, password hash), and it is written from the editor over
USB serial only. It is not a general key/value store. What is missing is a place for **arbitrary, app-chosen
keys** and a path for **node code** on the device to read and write them.

## 4. Identity: namespaced by flowName

A flat key namespace is the hazard the redeploy question exposed: a redeploy can be a completely different flow,
and a key like `theme` then either collides with the old app's value or reads something meaningless. The device
already carries the identity needed to separate them:

- `DEPLOY` carries `flowName` — "the flow file's stable, human-edited name" — and `deployId`, a fresh UUID per
  deploy.
- The listener persists both to `_flow_meta.json` and mirrors the current one in `_current_flow_name` for HELLO.
- `deployId` cannot provide continuity (it changes every deploy); `flowName` is the stable half.

**Adopted policy:** `_settings.json` is `{"<flowName>": {"<key>": <value>, ...}}`, and the store operates only on
the **current** flow's namespace. The listener already knows the current flow on both paths that matter — a live
`DEPLOY` and boot-time `_resume_flow` — so it sets the store's namespace there.

Consequences:

| Case | Result |
|---|---|
| Same flow, edited and redeployed | same namespace → values survive |
| A different flow deployed | different namespace → cannot see or overwrite the old app's values |
| App A → B → A again | A's namespace is still there → values come back |
| Older deploy with no `flowName` | reads return the caller's default; never a guess at another app |

This is the de-risking: the dangerous failure (two unrelated apps sharing a key and silently reading/writing each
other's values) becomes a safe one (the new app starts at its defaults). Values are **not** cleared on deploy, so
a rename or an accidental switch never destroys data.

**Honest limits.** Identity-based isolation cannot beat a bad identity:

- **Rename starts fresh.** `flowName` is deliberately user-edited; renaming the flow file makes it a new app and
  reads defaults. The old namespace remains (orphaned, §9), not destroyed. Fixing this would need a stable flow
  UUID, already considered and rejected for flow identity ("painful" with no index).
- **Name reuse** by two unrelated apps still collides. Author responsibility, same trust model as variable names.
- **Namespaces accumulate** across every distinct flow name ever deployed. Tiny, but not self-cleaning; §9 and
  §10 provide the explicit cleanup.

## 5. Shape

One new surface, and no new node type:

- A small **device-wide store**, owned by the runtime, reachable from node code: `get(key, default=None)`,
  `set(key, value)`, `delete(key)`, `keys()`, all scoped to the current flow's namespace.
- Backed by one small JSON file under `board_fs.under_root()` (proposed `_settings.json`, a sibling of
  `_board.json`), with the same atomic-write and corrupt-to-defaults contract as `board_settings.py`.
- **Runtime-owned, not compiler-emitted** — because a package's `.node.py` and a function node's user code must
  be able to reach it, and because the runtime lives outside the flow module, which is re-imported on redeploy.
- **No schema.** The store does not know or care what a key means. A reader supplies its own default (the
  default is the caller's, not the store's). A writer writes an already-validated value.

This is the same primitive the context model's future device/persistent scope should reuse — one persistence
implementation, not two.

## 6. Keying

- **Namespace = `flowName`** (§4), resolved by the listener, never supplied by node code.
- **Within a namespace, app-chosen stable names**, not node IDs. A key is a meaningful identifier ("theme",
  "units") and is not tied to a node instance, so moving or re-creating the node that uses it does not change
  which value it reads.
- **Flat within the namespace.** Two apps are isolated by §4; within one app, collisions are the author's
  responsibility, the same trust model as the unsandboxed function node.

## 7. What is stored

- **Only values the app actually wrote.** An absent key is normal and returns the caller's default; nothing is
  pre-seeded from the editor.
- **Unknown/removed keys are kept**, not garbage-collected. Harmless on disk, and a future re-add recovers the
  old value; deletion is the one thing that cannot be undone.
- **No migration or rename handling in the store.** A renamed key reads back as absent (the caller's default),
  which is the safe outcome. Renaming is a deliberate act by the app author.
- **JSON-native values only** (str, int, float, bool, None, list, dict). A value the store cannot encode is an
  attributed error, not a silent skip.

## 8. Backend

- The board file primitive answers "flash or SD": the file lives under `board_fs.under_root()`, which is the
  flash root on ESP32/RP2040 and `/flash` or `/sd` on the pyboard port.
- These values are written **rarely** (a page save, a settings change), so flash wear is not a design constraint
  the way continuous telemetry would be. A plain JSON write is appropriate.
- If a board's filesystem is read-only, saving is an attributed error (§9), not a silent no-op. SD-specific
  support is not designed here; nothing forecloses it because the path root is already board-defined.
- Size: the values are small and bounded; a corrupt/oversized file is treated as corrupt (§9).

## 9. Fault handling

Fault handling takes priority over the happy path here. The load path is deliberately **fail-safe**: bad settings
must never be the reason a board cannot boot or run.

- **Missing file** — normal on a fresh board; reads return the caller's default, no error.
- **Corrupt/unreadable file** — logged, **moved aside to `_settings.json.corrupt`**, and the store starts empty.
  Moving aside rather than deleting keeps a forensics copy; each new corruption overwrites the previous one.
  This is the automatic "clear bad settings" path, and it is why settings cannot brick the device.
- **Malformed namespace** (a flowName entry that is not an object) — dropped and logged; the rest of the file
  still loads.
- **Write failure** (flash full, read-only filesystem) — an **attributed** error naming the key, not a silent
  lost write. This is the fault the volatile `_Store` cannot express and this store must.
- **Unencodable value** — an attributed error before anything is written.
- **Atomicity** — temp file + rename, so a power loss mid-write leaves the previous file intact; the
  direct-write fallback is best-effort, as in `board_settings._save()`.

**Orphans** (namespaces for flows that will never be deployed again) are **not** pruned automatically: the device
cannot tell "gone for good" from "will come back". Pruning is an explicit, deliberate act (§10).

## 10. Recovery: two paths

The normal in-app path is the app's own reset control (a node calling `delete`/`clear`). The two recovery paths
below are for when that is not available — a bad value, a corrupt store, or orphaned namespaces.

### 10.1 Editor-level (device reachable)

A **"Clear device settings…"** action in the editor's device/board menu, with a confirmation. It offers two
scopes: the current flow's namespace, or all namespaces (destructive, separately confirmed).

Under the hood it reuses the existing connection and console-command channel — the same path as the console
command box (`EXEC`) — to call the store's maintenance functions, so **no new wire message and no runtime
protocol change**. If a first-class control message is preferred over `EXEC`, that is a wire change and needs
Mike's OK.

This is the ordinary field-issue path: the user has an editor, the board is connected, and one click resets the
offending values.

### 10.2 Device-only (no editor)

For a board running standalone, or one the editor cannot reach. These need no Thingstudio editor, only access to
the board itself:

- **Serial/WiFi console** — the existing `EXEC` channel, with a small maintenance surface: `namespaces()` (names
  and key counts), `clear(name=None)` (one namespace; `None` means the current flow), `clear_all()` (every
  namespace, plus `_settings.json.corrupt`), and `prune(keep)` (drop every namespace not in `keep`). Pre-import
  the store module into the console globals as `settings` so no `import` line is needed first.
- **Raw REPL** — if the listener is not running (a crash before it starts, or no flow), Ctrl-C to the MicroPython
  prompt and run `import device_settings; device_settings.clear_all()`. This is the lowest-level recovery that
  needs no Thingstudio tooling.
- **Boot-loop safe mode** (already built) — after repeated failed boots the listener starts *without* the flow,
  so a flow that crashes on a bad value can still be reached and its settings cleared (`clear_all()` works even
  when no flow is running). The fail-safe load (§9) and this existing net together mean settings alone cannot
  lock a board out.
- **Not v1:** a board-specific boot-time wipe (hold a pin/button for N seconds). It is the only path that works
  with no serial at all, but it costs a per-board pin definition and a factory-reset semantic; propose as a
  later addition if real devices in the field need it.

**Bricked, honestly:** if MicroPython itself will not start, no settings mechanism can help — that is a reflash.
What this design guarantees is that a *settings* problem never gets the device there.

## 11. What this is not

- **Not a new node type.** No `gui_settings` node, no settings section on `gui_screen`. A settings page is an
  app the user builds from existing GUI widgets (or a custom package) on top of this store.
- **Not a schema or validation system.** The store is a KV; the app knows what its values mean.
- **Not a GUI feature.** The GUI family is only an example consumer; any node may use the store.
- **Not editor-visible at runtime.** No wire messages for reading/writing values; `STATE_*` stays reserved.

## 12. Blast radius

- **`device-runtime/src/device_settings.py`** (new) — the file-backed, namespaced store; add to the runtime
  manifest (`runtime_manifest.py` `CORE_FILES` so both install paths pick it up).
- **`device-runtime/src/listener.py`** — set the store's namespace on `DEPLOY`/`_resume_flow`; expose the store
  in the console globals as `settings`.
- **`interfaces/runtime-api/{SPEC.md,api.json}`** + `editor/test/runtime-api-conformance.test.ts` +
  `device-runtime/test/test_runtime_api.py` — the store is reachable through `runtime`, and the `pymock` fixture
  needs it too. Codegen-visible, so a **major** runtime bump (root `AGENTS.md`).
- **`editor/src/node-library/function-node.ts`** — only if §15 Q1 decides function-node user code should get a
  `settings` local. Otherwise untouched.
- **Editor UI** — the "Clear device settings…" action, sent over the existing `EXEC` path.
- **Docs** — `docs/user-guide/custom-nodes.md` (how a node reads/writes it), the console-commands page, and a
  FAQ entry for "my settings reset after a rename" / "the board says it couldn't save".
- **Node descriptor, GUI nodes, wire protocol** — untouched.

## 13. Acceptance targets

1. A node/package writes a value, the board reboots: the value reads back (same flow).
2. The same flow redeployed: values survive.
3. A different flow deployed: it cannot read or overwrite the first flow's values.
4. An absent key returns the caller's default.
5. A corrupt file is moved aside, the store starts empty, and boot is unaffected.
6. A write that fails (full/read-only flash): an attributed error, not a silent success.
7. Editor-level clear resets the current namespace or all namespaces, with the confirmation it promises.
8. Device-only clear works from the console with no editor attached; the `.corrupt` file is removable too.

## 14. Order relative to the volatile context model

Per Mike's call this session, **this store lands first**; the volatile context model follows.

- It needs none of the context model's open questions, in particular the no-code-path question (Q3), which is
  still undecided.
- The context model's future device/persistent scope should reuse this store's primitive, not introduce a
  second one.
- The context model's case 1 (node state) and case 3 (share between nodes) already work today; this is the one
  of the three use cases with no existing mechanism at all.

## 15. Open questions for Mike

1. **Reachability from the function node:** should user code in a function node get a `settings` local (like
   `context`/`flow`), or is the store reachable only from a node's own Python (built-in or package)?
2. **File/name:** `_settings.json`, namespaced by `flowName` — confirm. A more general name (`_state.json`)?
3. **Value types:** JSON-native only, with an attributed error otherwise (§7) — agree?
4. **Unknown/removed keys and orphaned namespaces kept** — confirmed as the default, with §10 as the explicit
   cleanup? Or should an orphaned namespace be pruned after some evidence it is gone?
5. **Editor clear path:** reuse `EXEC` (no wire change) or add a first-class control message (wire change)?
6. **Reset scope:** is "clear all namespaces" needed, or only the current flow's? (The `.corrupt` file should be
   removable either way.)
7. **One API for both:** should the context model's device/persistent scope expose the *same* `get/set/delete/
   keys` surface and share this implementation, rather than growing a parallel one?

## 16. First step (if approved)

Land the primitive: `device_settings.py` (file-backed, `flowName`-namespaced, `get`/`set`/`delete`/`keys`,
JSON-native values, corrupt→moved-aside, attributed errors), the listener wiring (namespace on
deploy/resume, console global), its runtime API entry + conformance, and the docs. No node type, no GUI work.
Verify targets 1–8, with target 8 on a board with no editor attached.

## Progress, 2026-10-17: primitive and runtime API landed

`device-runtime/src/device_settings.py` and `device-runtime/test/test_device_settings.py` are written and pass
15/15 under the MicroPython unix port; the rest of the device-runtime suite (including the listener integration
test) passes, as do the editor conformance test and the full editor suite.

Wired this session: `device_settings.py` in `runtime_manifest.py`'s `CORE_FILES`; `runtime.settings` in
`interfaces/runtime-api/` (`SPEC.md` + `api.json` + the pymock fixture + both conformance tests); the listener
sets the namespace on DEPLOY and boot-time resume (before `import _flow`, so a setup statement reads the right
one) and exposes the store to the console as `settings`; runtime major bumped to 11.0.0, and
`EDITOR_TARGET_VERSION` with it.

Also landed: the editor's "Clear device settings…" action (§10.1) and the function-node `settings` local (§15 Q1).
Both recovery paths now exist.


## Hardware verification, 2026-10-17: both test flows pass on a real board

ESP32-C3 (`ESP32C3 module with ESP32-C3`), runtime 11.0.0, deployed over USB serial with
`test-flows/settings-test.flow.json` and `settings-test-other-flow.flow.json` (test-flows/README.md
has the inject-by-inject expectations). Acceptance targets 1-5, 7 and 8 pass:

- get/default (`'not set'`, `keys() == []`), set, increment, delete, then default again.
- an unencodable value (`b'bytes'`) raises `SettingsError` naming the key, and the console shows
  `NODE_ERROR node=setbadfn0001` -- the chain's debug node receives nothing, as intended.
- values survive a same-name redeploy and a soft reboot (`count == 2` after both).
- a different flow reads `'not set'` and writes its own `100`; returning to the first flow still reads
  `2`. `namespaces()` shows both names with one key each.
- corrupt file: moved to `_settings.json.corrupt`, store starts empty, including when the corrupt file
  is present at boot -- `LISTENER_READY` and the persisted flow resume normally.
- malformed namespace (`"bad": 5`) is dropped with a logged `SETTINGS_ERR`; the good namespace loads.
- `clear()` (current flow, the editor's "This flow" command), `clear_all()` (all namespaces and the
  `.corrupt` copy), and `prune([...])` all behave as specified.
- write failure was simulated by making `_save` raise `OSError(28)`: the caller gets
  `SettingsError could not save settings key 'x' ...` and nothing is written. A genuine full-flash /
  read-only-filesystem failure was not induced on this board.

Two host-tool defects surfaced and were fixed in the same change:

- `test-flows/deploy_runtime.py` could not run at all (helpers deleted in d1332e3, call sites left);
  restored. Without it the board could not be moved from 10.0.0 to 11.0.0.
- `deploy_flow.py`/`hil_common.deploy_message()` never sent `flowName`, so a host deploy was
  namespaced under `""`, not the flow's name. `deploy_flow.py` now takes `--flow-name` and warns
  without it, and `--trigger` to drive manual injects headlessly.

Not a settings defect, still open: the debug `NODE_ERROR` line appears on the console; the editor's
console filter/rendering of it was not checked from a browser this session.
