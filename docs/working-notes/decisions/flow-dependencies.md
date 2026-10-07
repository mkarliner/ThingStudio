# Decisions: flow dependencies

Detail: `../flow-dependencies-scoping.md`.

- **2026-10-07 — Name, delivery and cleanup (Mike).** The "selective vendor push" item is renamed **flow
  dependencies**: a flow declares the libraries it needs and Deploy installs them. Delivered with Deploy through
  the running listener (USB or WiFi; only missing or changed files sent), not at runtime install. Dependencies a
  new flow no longer needs are removed once it runs. Recommended, not decided: a shared JSON registry replacing
  `VENDOR_FILES`; the compiler derives needs from codegen imports plus function-node imports; new `DEP_PUT`
  message and a `dependencies` field on `DEPLOY` and `HELLO`; files in `/lib/`; major runtime version bump.

- **2026-10-07 — Built, runtime 7.0.0 (not yet on hardware).** The list is `runtime_manifest.py`'s
  `DEPENDENCIES` (not a JSON file), served at `/api/dependencies`. `DEP_PUT`'s files travel as a map, since the
  device's CBOR has no arrays. Board side in `deps.py`: `/lib`, temp-then-rename writes, an index, a pre-import
  check that refuses with `MissingDependency` before touching the running flow, `sys.modules` cleared for libraries
  on each deploy, cleanup after a good import. Runtime install pushes no libraries and deletes the old root copies.
  Host test tools install libraries the same way.
