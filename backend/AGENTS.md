# Thingstudio backend

Shared rules are in the repo root `AGENTS.md`; this is the backend-specific orientation.

`backend/` is the local Python service: the serial ↔ WebSocket relay, the admin API, runtime install, and the
packaged assets.

It implements the wire framing defined in `../interfaces/protocol/` (and never decodes CBOR), and reads the runtime
module list from `../device-runtime/runtime_manifest.py`. After a change, run `pytest` (or `make test-backend`); the
protocol conformance vectors are in `test/test_conformance.py`, and run on `make test`.
