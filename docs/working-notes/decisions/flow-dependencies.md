# Decisions: flow dependencies

Detail: `../flow-dependencies-scoping.md`.

- **2026-10-07 — Name, delivery and cleanup (Mike).** The "selective vendor push" item is renamed **flow
  dependencies**: a flow declares the libraries it needs and Deploy installs them. Delivered with Deploy through
  the running listener (USB or WiFi; only missing or changed files sent), not at runtime install. Dependencies a
  new flow no longer needs are removed once it runs. Recommended, not decided: a shared JSON registry replacing
  `VENDOR_FILES`; the compiler derives needs from codegen imports plus function-node imports; new `DEP_PUT`
  message and a `dependencies` field on `DEPLOY` and `HELLO`; files in `/lib/`; major runtime version bump.
