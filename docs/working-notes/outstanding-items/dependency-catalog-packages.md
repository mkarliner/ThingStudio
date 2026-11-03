# Dependency catalog: install packages, not only flat modules

Status: open, 2026-11-03. Raised by the BLE scoping (`../ble-nodes-scoping.md`, call 1); Mike: "we'll get the same
problems with something else, so we'll have to address that sooner rather than later".

## The limit

A `DEPENDENCIES` entry in `device-runtime/runtime_manifest.py` maps `(vendor path, file name on the board)`, and
`device-runtime/src/deps.py` writes each file flat into `/lib`, refusing any name that is not an identifier. So a
library shipped as a package directory with relative imports (`aioble/`, `from .core import ble`) can only be
vendored by renaming its files and patching every import, and the patches are redone on every upgrade.

## Shape of a fix (to agree with Mike)

- Allow a board file name with a package path (`aioble/core.py`), each segment an identifier; `deps.py` creates
  the directory and removes it when no flow needs the library.
- `name` stays the import name (`aioble`), so the editor's `import x` → library mapping is unchanged.
- The backend's `/api/dependencies` validation, the board index, `DEP_PUT`, and `stage.py` for the frozen
  classic-ESP32 image all accept the new form.

## Blast radius

An interface change: runtime-api SPEC §3 (dependency catalog), and the wire protocol if `DEP_PUT`'s file-name
field is constrained there. Needs Mike's explicit permission, a major runtime bump (no obstacle now: no users),
and conformance updates in `editor/test/runtime-api-conformance.test.ts` and `device-runtime/test/`.
