# Enforce interface conformance in CI — device-runtime half not wired

The editor and backend run their interface conformance in CI (`.github/workflows/ci.yml`): the editor's
`npm test` includes the wire-protocol, runtime-api, node-descriptor and board-descriptor conformance tests plus
`module-boundaries.test.ts`, and the backend job runs `pytest` including `test/test_conformance.py`.

The device-runtime half is not in CI: `device-runtime/test/test_conformance.py` and `test_runtime_api.py` run only
under a MicroPython unix-port build (`device-runtime/test/README.md`: clone MicroPython, `make -C mpy-cross`, then
`ports/unix`), which is heavier than the rest of CI. Until it's wired in, a change that breaks the device side of
the protocol or runtime API is caught only when someone runs the MicroPython suite locally.

Option to scope: a CI job that builds MicroPython (cache the build) and runs the `test_*.py` suite, gated so it
doesn't run on every push if build time is a problem. Decide the cost/benefit with Mike.
