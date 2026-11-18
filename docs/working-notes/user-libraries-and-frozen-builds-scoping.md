# User libraries, and freezing them into your own image — scoping

Status: proposal, 2026-11-18. Needs Mike's answers to the questions at the end. Two pieces, in this order:
**A. Deploy sends your own libraries** (most users stop here), **B. build an image with them frozen in** (for the
RAM and flash saving). Neither changes the wire protocol or the device runtime, as far as read; both to confirm.

## The problem

Mike, 2026-11-18: what if a user wants a ThingStudio custom image, plus their own frozen code? Today they can't,
and the step before it is missing too:

- **No way to send a library of your own.** `custom-nodes.md` says it outright: "A library of your own can't be
  sent yet. Code two of your nodes share goes in each `.node.py`." A user copying modules by hand (`mpremote cp`
  into `/lib`) works, but ThingStudio doesn't know about them, a reflash loses them, and a name clash with a frozen
  module silently replaces it (`/lib` is first on `sys.path`, by design, so pushed updates win).
- **No supported way to add frozen code.** The route is to edit `firmware/manifest.py` (add a `freeze(...)`) and
  run `firmware/build.sh`: editing a file we maintain, merging it on every update.

"Everything is a plugin" (`AGENTS.md`) says both should be extension points.

## What already exists (read 2026-11-18)

- **Flow dependencies** (`flow-dependencies-scoping.md`, runtime 7.0.0 onward): `runtime_manifest.py`'s
  `DEPENDENCIES` is the registry; the backend serves it at `/api/dependencies`; the editor finds a flow's imports by
  scanning the **generated program** (`flow-dependencies.ts`, `findImportedModules`), so custom nodes' and function
  nodes' imports are already seen; it closes over `requires`, precompiles to `.mpy`, hashes, and sends only what the
  board's HELLO inventory lacks (`DEP_PUT`/`DEP_ACK`/`DEP_COMMIT`), into `/lib/`, atomically, with attributed
  errors. That design's "Not in scope" names this: "Custom-node modules: same channel later".
- **Custom images** freeze every registry library; `gen_deps_index.mjs` writes the frozen inventory with the
  editor's own hashing, so Deploy sends nothing the image already has (`firmware/README.md`,
  `decisions/custom-firmware.md`).

So A is mostly "a second source for the registry", and B is "stage that source too, and index it".

## A. Deploy sends your own libraries

### Where they live

`~/.thingstudio/libraries/`, beside `custom-nodes/`. One library per entry:

- `<name>.py` — a module; or
- `<name>/__init__.py` (+ more files) — a package (runtime 15.0.0 supports packages on the board).

A library's name is its module name, as for the built-ins. No descriptor file: `requires` is worked out by scanning
the library's own imports against the registry (the same `findImportedModules`), so there is nothing to keep in
step. Loaded when the editor loads custom nodes, and on **Reload custom nodes** (rename the button "Reload custom
nodes and libraries", or keep it short: Question 3).

### Rules at load (one console line each, the library is skipped, the others load)

- The name is a built-in library (`mqtt_as`), a runtime module (`runtime`, `deps`), or a firmware module MicroPython
  provides (`machine`, `asyncio`): refused, naming which. Shadowing one would break every flow that uses it.
- Not valid Python for the editor's `mpy-cross`: refused, with its error.
- Over the 64 KB frame limit per file: refused, as for built-ins.
- A `requires` that resolves to nothing known is fine: assumed to be firmware, as today.

### What changes where

- **Backend:** `/api/dependencies` merges the user folder after the built-ins, each entry marked `"source": "user"`;
  the sources endpoint the editor precompiles from serves the user files too (confirm which endpoint:
  `/api/runtime-sources` serves the built-ins today). The CLI (`thingstudio-compile`) loads the same folder, or
  `--libraries <dir>`, as it does `--custom-nodes`.
- **Editor:** nothing new in resolution, hashing or sending, if the registry entry has the same shape. The deploy
  log names user libraries as it names built-ins.
- **Board:** nothing, if `deps.py` treats every name alike (it should: it stores by name and hash). Confirm on the
  unix port with a user-named library, including a package.
- **Wire protocol:** unchanged: `DEP_PUT` already carries any name. Confirm against `interfaces/protocol/SPEC.md`.

### The function node

It imports user libraries for free (the scan covers generated code, and its code is spliced in verbatim). Say so
in its docs page.

## B. Your own image, with your libraries frozen in

### Shape

`firmware/build.sh <target> --libraries <dir>` (or an environment variable, to match `MICROPY_DIR`):

1. Stage as today, then copy the user libraries into the stage, refusing a name clash as in A.
2. `gen_deps_index.mjs` indexes them with the editor's hashing, so Deploy sees them as installed (frozen) and sends
   nothing. Today it reads `DEPENDENCIES` only; it takes the user list as well.
3. **The image is named as a user build, never `thingstudio-…`:** e.g. `user-<target>-<runtime>-<sha>.bin`. This is
   the important part. The user's tree is clean (their libraries are outside the repo), so today's naming would
   give it the same name as our tested image with different bytes. `record-tested.sh`, `publish.sh` and the
   catalogue tool already accept only `thingstudio-…` names, so a user build can never be published or catalogued
   by mistake.
4. The user flashes it with **Or use your own image file**, as today.

No edit to `firmware/manifest.py` (it freezes the stage, whatever is in it), so updating ThingStudio is a `git pull`.

### What it doesn't solve

Building still needs ESP-IDF, a MicroPython checkout at the pinned tag and the chip toolchain: a big ask. A hosted
build (CI builds an image from a user's library folder) would remove that, at the cost of running other people's
code in our CI. Out of scope; recorded so the shape doesn't foreclose it (the build takes a folder, which is what a
hosted build would hand it).

## Scope is not shape

- **A second library source** (a shared folder, a project's own folder, a marketplace): another path in the
  backend's source list, as `custom_node_dirs` already is. **A second one would need:** one entry in that list.
- **A second chip:** B goes through the same target folders as every image; nothing per chip.

## Work

A, then B, separately mergeable:

1. A: backend source list and merge, name rules, CLI flag; tests (backend: load, clash, package; editor: a flow
   whose custom node imports a user library resolves and sends it; device runtime on the unix port: a user-named
   library and package install and import).
2. A: user docs: `custom-nodes.md` "Libraries you can import" gains "Your own libraries"; `function.md` a line;
   `thingstudio-folder.md` the new folder. Hardware: a C3 on stock MicroPython and the classic custom image.
3. B: `build.sh --libraries`, staging, indexing, naming; tests for the name rule; `custom-firmware.md` "Add your own
   frozen code" replaces the one-line "build your own"; `firmware/README.md` a section. Hardware: build one for the
   classic ESP32, check HELLO lists the user library as frozen and Deploy sends nothing.

## Questions for Mike

1. **Order:** A first, B later (recommended: A alone covers most users, and B depends on A's name rules)?
2. **Does the library folder format need its own spec in `interfaces/`?** It's a new user-facing extension format,
   like the node descriptor. Recommended: yes, short (folder layout, naming, clash rules), with a conformance test.
3. **Folder and button names:** `~/.thingstudio/libraries/`? And the palette button?
4. **Custom node packages bundling their own library** (one shareable unit): not now (recommended), but keep the
   library format reusable inside a package later?
5. **B's image name:** `user-<target>-…`, or something else that can't be mistaken for ours?
