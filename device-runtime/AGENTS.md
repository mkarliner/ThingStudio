# Thingstudio device runtime

Shared rules are in the repo root `AGENTS.md`; this is the device-runtime-specific orientation.

`device-runtime/` is the MicroPython code `test-flows/deploy_runtime.py` pushes onto a board: the listener, the
`runtime` module generated flow code calls, the vendored drivers, and the manifest.

It implements the wire protocol (`../interfaces/protocol/`) and provides the runtime API (`../interfaces/runtime-api/`).
Read those specs before changing anything they cover.

Run the real MicroPython suite, not `py_compile` — `test/README.md` has the build recipe for the interpreter and
`mpy-cross`. `runtime_manifest.py` is the one file list a runtime install (both paths) reads. Any change to a file
that gets pushed onto hardware is a version-bump call — see the root `AGENTS.md` discipline.
