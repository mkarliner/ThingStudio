# Library format — v1 specification (draft)

Status: **draft, 2026-11-24.** Approved in principle by Mike (2026-11-24, as part of the Home Assistant plan:
`docs/working-notes/user-libraries-and-frozen-builds-scoping.md` part A, plus bundles). Not yet implemented; the
conformance tests named in §9 arrive with the implementation. Until then this is the contract to build against, not
a description of shipping behaviour.

This is what a **user library** is: Python code of your own that a flow can import, which ThingStudio sends to the
board on Deploy exactly as it sends its built-in libraries (`ts_mqtt`, `mqtt_as`, …). It extends the dependency
catalog defined in `../runtime-api/SPEC.md` §3; nothing about how a library reaches the board changes.

## 1. Where libraries come from

| Source | Path | Order |
|---|---|---|
| Built-in | `device-runtime/runtime_manifest.py` `DEPENDENCIES` | first |
| Your libraries folder | `~/.thingstudio/libraries/` (beside `custom-nodes/`) | second |
| A bundle's own libraries | `~/.thingstudio/custom-nodes/<bundle>/lib/` (bundles: `../node-descriptor/SPEC.md` §3.1) | third, bundles in folder-name order |

The libraries folder and every bundle's `lib/` are read when the editor loads custom nodes, and again on
**Reload custom nodes** (which reloads libraries too). The `thingstudio-compile` CLI reads the same places, or
`--libraries <dir>` in place of the libraries folder; bundles come with `--custom-nodes <dir>`.

Within a source, libraries are taken in name order. Order never means override: no source can replace a name
another source already has (§4).

## 2. Layout and names

Inside a source folder, each entry is one library:

| Entry | Library name | Provides |
|---|---|---|
| `<name>.py` | `<name>` | the module `<name>` |
| `<name>/__init__.py`, plus any `.py` files and plain-named subfolders under it | `<name>` | the package `<name>` and its submodules (`<name>.core` from `<name>/core.py`) |

- `<name>` and every folder and file stem below it is a Python identifier (`str.isidentifier()`), the same rule as
  a built-in entry's file names in `../runtime-api/SPEC.md` §3. The library name is its top-level module name, so
  the editor maps `import x` or `from x.y import z` straight to it.
- A folder without `__init__.py` is not a library: refused if it holds `.py` files (most likely a forgotten
  `__init__.py`), ignored otherwise. Files that are not `.py` (a README, data) are ignored, as are names starting
  with `.` or `_` at the top of a source folder (`__pycache__`, `.git`).
- Board file names are the entry's paths as they are: `ts_ha.py` lands as `/lib/ts_ha.py`; `mylib/core.py` as
  `/lib/mylib/core.py` (packages need runtime 15.0.0, as for built-ins).

There is no descriptor file. A library's **`requires`** is worked out by scanning its own source with the same
import scan the editor uses on generated code (`findImportedModules`): every imported top-level name that is in the
catalog (built-in or user), other than the library's own name. Any other import is assumed to be provided by the
firmware, as for generated code today.

## 3. How a library joins the catalog

Each loaded user library becomes one catalog entry of the same shape as a built-in (`name`, `files`, `requires`),
plus:

| Field | Value |
|---|---|
| `source` | `"user"` (built-ins carry `"builtin"` once this lands) |
| `origin` | where it came from, for messages: `"libraries"` or `"bundle:<bundle folder name>"` |

From there everything is the existing flow-dependency path, unchanged: the editor resolves a flow's imports
against the merged catalog, closes over `requires`, compiles to `.mpy`, hashes, sends what the board lacks with
`DEP_PUT`/`DEP_COMMIT` into `/lib`, and removes libraries no flow needs. The deploy log names a user library as it
names a built-in, with its origin. The wire protocol and `deps.py` treat every name alike.

## 4. Refusals

A refused library is not in the catalog. Each refusal is one console line naming the library, its origin and the
reason; every other library still loads. A bundle with a refused library is skipped whole
(`../node-descriptor/SPEC.md` §3.1), because its nodes would fail at deploy.

| Situation | Message names |
|---|---|
| The name is a **built-in library** (any `DEPENDENCIES` name) | the built-in it would shadow |
| The name is a **runtime module**: a `CORE_FILES` module, `listener`, `main` or `boot` | the runtime module |
| The name is a **firmware module** in `reserved-names.json` (`machine`, `asyncio`, …) | the firmware module |
| **Two user sources offer the same name** | both origins; **both** are refused, never first-wins |
| The entry isn't a module or package by §2 (a part that isn't an identifier, a folder without `__init__.py` that holds `.py` files, a bare top-level `__init__.py`) | the offending path |
| A file **doesn't compile** with the editor's `mpy-cross` (checked by the editor when it loads the catalog) | the file and `mpy-cross`'s error |
| Its `requires` form a **cycle** among user libraries | every library in the cycle |

Shadowing is refused because `/lib` comes first on the board's `sys.path` by design: a user `machine.py` would
silently replace the firmware's for every flow.

`reserved-names.json` is the list of names MicroPython firmware provides across the ports ThingStudio supports. It
is data, kept beside this spec, and grows when a port gains a module. A name missing from it that a particular
firmware does provide is not caught at load time; the board's own import order (`/lib` first) applies.

There is no size limit at load. Library files reach the board in pieces (`../protocol/SPEC.md` §7.2); a board
without room answers `NoSpace` at deploy, as for built-ins.

## 5. Where libraries work

| Surface | |
|---|---|
| ThingStudio App | yes |
| `thingstudio-compile` | yes (§1) |
| ThingStudio Web | no, as for custom nodes: they are read from the `.thingstudio` folder on your computer |

## 6. What is not covered

- **Freezing your libraries into a firmware image** (scoping doc part B). A user library is always sent on Deploy.
- **Fetching a library from a URL or a registry.** Only folders you place are read, as for custom nodes.
- **Versions.** The catalog holds one copy of each name; the board's copy is replaced when its hash changes.

## 7. Worked example

`~/.thingstudio/custom-nodes/home-assistant/lib/ts_ha.py` begins:

```python
import ts_mqtt
import json
import machine
```

It loads as:

```json
{"name": "ts_ha", "files": [["ts_ha.py", "ts_ha.py"]], "requires": ["ts_mqtt"],
 "source": "user", "origin": "bundle:home-assistant"}
```

`ts_mqtt` is a built-in, so it is a `requires`; `json` and `machine` are firmware. A flow containing `ha_sensor`,
whose `.node.py` does `import ts_ha`, deploys `ts_ha`, `ts_mqtt` and `mqtt_as` (`ts_mqtt`'s own `requires`) to
`/lib`. A second bundle that also ships `lib/ts_ha.py` makes both `ts_ha` copies refused and both bundles skipped:

```
library ts_ha refused: offered by bundle:home-assistant and bundle:ha-fork -- rename one
custom node bundle home-assistant skipped: its library ts_ha was refused
custom node bundle ha-fork skipped: its library ts_ha was refused
```

## 8. Relationship to other specs

- `../runtime-api/SPEC.md` §3 defines the catalog entry shape this extends. Adding `source`/`origin` is the only
  change to it.
- `../node-descriptor/SPEC.md` §3.1 defines bundles, whose `lib/` is a library source here.
- `../protocol/SPEC.md` is unchanged: `DEP_PUT` already carries any plain module name.

## 9. Conformance

`vectors/libraries.json` holds folder trees with the catalog entries or refusals they must produce (format in
`vectors/README.md`). Tests to add with the implementation:

- `backend/test/test_user_libraries.py`: the vectors against the backend's catalog merge (`/api/dependencies`).
- `editor/test/user-libraries.test.ts`: a flow whose custom node imports a user library resolves, compiles and sends
  it; the `mpy-cross` refusal.
- `device-runtime/test/`: on the unix port, a user-named module and package install into `/lib` and import.

Change this format only with Mike's explicit permission once it ships: users will have written libraries against
it.
