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

- **2026-10-07 — First hardware pass, Pico W (Mike).** An MQTT flow on a freshly installed 7.0.0 runtime: the
  editor sent only `mqtt_as` (11 KB, ~0.6 s; `threadsafe_event` was already installed by an earlier deploy), then
  DEPLOY; WiFi and MQTT connected and messages flowed. The same flow on a plain Pico (no WiFi) failed with
  `ImportError: no module named 'socket'`, old flow still running -- correct, but unexplained, so the editor now
  explains a deploy ImportError and warns before deploying networking to a board reporting no WiFi
  (`editor/src/app/import-error-help.ts`, user guide "Module missing on the board"). Still owed: ESP32, a display
  flow, a 6.x board upgrade, a flow switch that removes a library.

- **2026-10-07 — Hardware pass continued (Mike).** Pico W: deploying blink after the MQTT flow removed both
  libraries. CYD (classic ESP32) upgraded from 6.0.0: free flash rose 32 KB after the reinstall (old root copies
  deleted; HELLO reported no libraries); the MQTT flow then sent `mqtt_as` (~2 s over the CYD's USB-serial bridge)
  and `threadsafe_event`, deployed, and ran. Only a display flow remains untested.

- **2026-10-07 — Libraries go in 1 KB pieces plus a commit (runtime 8.0.0).** CYD with a display flow running: the
  whole-library `DEP_PUT` hit MemoryError decoding 11 KB on a fragmented heap and the board answered nothing (30 s
  editor timeout). Now `DEP_PUT` pieces (no reply) and `DEP_COMMIT` (always answered; incomplete files and unreadable
  messages reported, naming the library). Pending editor waits are cancelled on disconnect. Major bump: boards on
  7.0.0 need the runtime installed again.

- **2026-10-07 — Manual restart, not automatic (Mike).** On the CYD, a WiFi flow deployed after other work crashed
  the board (`abort()`) as it started, then ran fine after the reboot. Considered: soft-reset on every deploy so each
  flow starts on a clean heap. Mike's call instead: manual **Tools → Restart board (soft)** and **Reset board (hard)**
  (new `RESTART {hard}` message), suggested by the console when memory is the likely cause -- low ESP-IDF heap before
  a networking deploy, a `MemoryError`, or a restart mid-deploy (`editor/src/app/memory-advice.ts`). Reason: a hard
  reset drops native-USB boards off the bus, and an automatic restart on every deploy costs time on boards that
  don't need it. Also: flow identity is now saved before the flow starts, and a HELLO during a deploy is reported as
  "the board restarted" with whether the new flow is running, instead of a 30 s timeout. Not yet checked on
  hardware: whether a soft reset gives WiFi its ESP-IDF memory back on a classic ESP32.

- **2026-10-07 — A reply to every piece (runtime 9.0.0).** On the CYD (CH340 USB-UART bridge, no flow control),
  1 KB pieces sent back to back arrived garbled (`CBOR map key must be a text string`, `incorrect padding`), then
  the editor waited out its 30 s timeout. The board now answers each `DEP_PUT` with `DEP_ACK {name, file, offset,
  ok, code, error}`, and the editor sends the next piece only after it: 10 s per piece, a failure names the library,
  file and byte. One round trip per KB, under a second for the largest library over USB. Major bump: boards on
  8.0.0 need the runtime installed again.
