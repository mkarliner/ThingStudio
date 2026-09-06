# Decisions — Redeploy / network fault handling

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-20 — Explicit cleanup registry (`runtime.register_cleanup`/
  `cancel_running`), not GC-timing reordering, fixes the redeploy socket
  leak.** A `gc.collect()` reorder would only make the `EADDRINUSE` flake
  less frequent, still relying on incidental collection timing for
  something that needs to be deterministic. `redeploy-cleanup-and-
  network-fault-detection-briefing.md` Problem 1, `runtime.py`.
- **2026-08-20 — `wifiConfigId` made mandatory for `wifi_status`/
  `udp_send`/`udp_receive` (Option B), reversing the config-node
  briefing's "optional" call.** The optional/implicit fallback was
  exactly what let `wifi_status` report a connection the flow never
  declared. `http_request` is untouched (still unmigrated to config
  nodes at all). Mike's own explicit sign-off, not a default. Same
  briefing, Problem 2b; see `config-node-and-palette-implementation-
  briefing.md`'s own retroactive note.
- **2026-08-20 — WiFi config `security` field: `"password"` (default) |
  `"open"` | `"unmanaged"`, not just the two the briefing scoped.** The
  third state (`"unmanaged"` -- no managed connection, ride on whatever
  the device already has) is the explicit, labeled replacement for what
  an omitted `wifiConfigId` used to mean implicitly, kept specifically so
  Option B's mandatory-config rule doesn't foreclose a future captive-
  portal/AP-fallback WiFi provisioning flow (raised by Mike 2026-08-20,
  not built or scoped -- see `outstanding-items.md`). An empty password
  on a `"password"`-security config is a compile-time `CompileError`.
  `config-types.ts`, `wifi-status.ts`.
- **2026-08-20 — Network OSError messages re-raised with host:port
  context, `udp_send`/`udp_receive` only.** `http_request`/`mqtt-
  shared.ts` left untouched -- the briefing flagged touching them as a
  judgment call, not mandated; not done this session, still open for
  whoever picks it up next.
- **2026-08-21 — "sta is connecting, cannot set config" deploy failure
  (real hardware, `mqtttest.flow.json`) fixed on Thingstudio's own side,
  NOT by patching the vendored `mqtt_as` -- reversing this same day's
  earlier call to patch it, on Mike's own explicit direction after he
  reviewed the library's own issue history.** Root cause, confirmed by
  reading the vendored source directly: mqtt_as's `wifi_connect()` (ESP32
  branch) does `s.active(True)` then unconditionally
  `s.connect(self._ssid, self._wifi_pw)`, with no check for a connect
  already in progress; `s.active(True)` alone can trigger ESP-IDF's own
  NVS-cached auto-reconnect from a previous deploy's saved station config,
  and if that's still resolving when the very next line fires its own
  connect, ESP-IDF refuses the second connect's config-set. Ruled out
  first: not a cross-node-type race (wifi_status/http_request/udp_send/
  udp_receive vs. mqtt_as's own connect) -- the reproducing flow has only
  `mqtt_publish`/`mqtt_subscribe`, sharing one `wifiConfigId`/
  `brokerConfigId`, and the existing lock/dedup mechanism
  (`mqttEnsureConnectedSnippet`) was already working correctly, so the bug
  is entirely inside `wifi_connect()` itself.
  A local patch to the vendored file (adding the missing guard, mirroring
  the ESP8266 branch's own existing `isconnected()` check a few lines
  above) was drafted, applied, and delivered -- then reverted the same
  day. Mike reviewed this library's own GitHub issue history and found
  this exact class of fix (an `isconnected()`/connecting-state guard on
  the ESP32 branch) already raised more than once
  ([peterhinch/micropython-mqtt#59](https://github.com/peterhinch/micropython-mqtt/issues/59),
  [#61](https://github.com/peterhinch/micropython-mqtt/issues/61), and a
  `_is_connecting`-flag variant discussed in
  [#57](https://github.com/peterhinch/micropython-mqtt/pull/57)) without
  landing in the base implementation -- his call was not to carry a
  diverging local patch against the maintainer's evident preference, and
  to fix this entirely on Thingstudio's own side instead.
  `mqttWifiPrecheckStatement()` (`mqtt-shared.ts`) is that fix: a
  module-scope statement, emitted by every mqtt_publish/mqtt_subscribe
  node (deduped to one occurrence per flow via the existing `mergeSetup`
  mechanism), that WAITS OUT -- never cancels -- any WiFi connect already
  in progress, bounded, before mqtt_as's own async `.connect()` ever gets
  a chance to run. Waiting rather than cancelling is what keeps this safe
  for a flow that also has wifi_status/http_request/udp_send/udp_receive:
  those issue their own real `.connect()` call in their own module-scope
  setup, and a cancel-based approach (the reverted vendored-file patch)
  would have risked tearing down another node's legitimate, still-
  resolving connect attempt; a wait can only let something already
  destined to finish, finish, before mqtt_as's own connect call runs.
  Deliberately gated to `sys.platform == "esp32"` -- the underlying race
  is an ESP-IDF-specific behavior, and `network.STAT_CONNECTING` isn't
  confirmed present on every MicroPython port this project targets (the
  vendored file's own code only ever references that constant inside its
  own `if ESP32:` branches). Verified against the real reproducing flow:
  compiled `mqtttest.flow.json`'s equivalent graph and confirmed the
  precheck statement appears exactly once, ahead of the client-setup
  code, in the generated source (`ast.parse`-checked). 273/273 editor
  tests still pass (existing tests updated to look up the client-setup
  statement by content rather than a fixed array index, since the
  precheck statement is now emitted first). The vendored file itself is
  back to byte-identical-with-upstream; `device-runtime/src/vendor/
  mqtt_as/README.md`'s "Local patches" section now says so explicitly and
  points here. Filing an issue upstream (not a PR, given the history) may
  still be worth doing independent of our own fix -- Mike's call, not
  decided either way this session -- see `outstanding-items.md`.
- **2026-09-04 — `wifi_status` made the flow's sole owner of WiFi
  credentials; `udp_send`/`udp_receive`/`mqtt_publish`/`mqtt_subscribe`/
  `http_request` lose their own independent `wifiConfigId`.** Mike's own
  real-hardware finding: nothing stopped a flow's `wifi_status` node
  being set to `"unmanaged"` while an `mqtt_publish` node in the same
  flow independently referenced a different WiFi config with real
  credentials -- two disagreeing claims about the one physical radio.
  Fixed via a new `ctx.findNodesOfType()` (`node-definition.ts`/
  `compile.ts`) and `wifi-status.ts`'s `resolveFlowWifiCredentials()`,
  which every other network node type now calls instead of resolving its
  own config reference; requires exactly one `wifi_status` node per flow
  (Mike's explicit "assume one interface for now"), a `CompileError` for
  zero or more than one. Deliberately not a one-way door against a later
  multi-interface extension (CLAUDE.md's dead-end principle) -- see full
  reasoning in `outstanding-items/wifi-single-owner-fix.md`. `wifi_status`
  itself keeps its name and its own `wifiConfigId` unchanged -- Mike's
  explicit call not to rename it this session. No real-hardware pass of
  this specific change yet -- flagged, not assumed safe.
- **2026-09-05 -- runtime/editor version-check gap closed with two
  layers, both kept, neither replacing the other: the existing manually-
  bumped semver stays (with a new CLAUDE.md rule for when to bump it),
  plus an automatic git-SHA marker as a non-blocking backstop -- a raw
  content hash rejected outright.** Surfaced by a real hardware failure:
  `register_trigger` landed in `runtime.py` (2026-09-02) without
  `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` being bumped, so a stale
  RP2040 board's HELLO still read `0.1.0`, `decideDeploy` said
  "compatible," and the flow crashed with `AttributeError: 'module'
  object has no attribute 'register_trigger'`. Mike's own explicit call,
  having been offered a hash-only option: a content hash can't
  distinguish a real behavioral change from a harmless comment/rename
  edit (both would just read "different"), so it was rejected in favor
  of keeping semver as the actual compatibility decision, backed by a
  documented rule for deciding when a `device-runtime/src` change is
  breaking (CLAUDE.md's "Device-runtime version bump discipline" --
  given `decideDeploy` only gates on `major`, the rule is blunter than
  textbook semver: any codegen-visible change gets a `major` bump, not a
  `minor` one, since `minor`/`patch` bumps give zero actual protection
  today). Mike also asked for the git-SHA marker "for belt and braces" on
  top of the rule, not instead of it -- `test-flows/deploy_runtime.py`
  now stamps a board with `device-runtime/src`'s git SHA at push time;
  HELLO gains an optional `runtimeBuild` field echoing it; `version.ts`'s
  `checkRuntimeBuild` compares it to the editor's own build-time SHA
  (`vite.config.ts`'s `define`) and logs a warning, never blocks a
  DEPLOY. `messages.py`/`messages.ts`, `codec.ts`, `listener.py`,
  `deploy_runtime.py`, `vite.config.ts`, `main.ts`.
- **2026-09-05 -- new `HELLO_REQUEST` message (editor -> device, number
  10) added specifically to solve "get the editor to a known state after
  connecting/reconnecting, with no reset," kept deliberately separate
  from `reset-before-deploy.md`'s bigger, still-unscoped idea.** Surfaced
  by the RP2040 hardware pass: the Pico W has no reset button, and
  `_send_hello()` only ever runs once, at boot -- a reconnecting editor
  (or a board that's simply been running a while) had no way to learn
  the device's current version/build/free-memory state without a
  physical reset. Mike's own framing, correcting an earlier version of
  this idea from me that conflated two different problems: this is
  explicitly NOT about getting newly-pushed `runtime.py` code running
  (that genuinely needs a reboot, and native-USB boards drop their
  connection on any real reset regardless of what triggers it -- a
  separate, harder problem `reset-before-deploy.md` already flags with
  its own open protocol-shape questions); it's only about reaching a
  known state with an already-running device, no side effects at all (no
  redeploy, no runtime reload). Device-side: `listener.py`'s dispatch
  just calls the same `_send_hello()` boot already uses -- deliberately
  no separate code path to keep in sync. Editor-side: the Connect handler
  now actively requests a HELLO instead of passively hoping one arrives
  (a passive wait could only ever catch a boot-time HELLO by lucky
  timing), plus a standalone "Check status" button for use any time.
  Numbered after `TRIGGER`, same append-only convention -- an old
  listener.py just logs `LISTENER_IGNORED`, no version bump needed
  (matches `TRIGGER`'s own precedent, CLAUDE.md's bump-discipline rule
  doesn't apply to protocol additions an old device degrades safely on).
  `messages.ts`/`messages.py`, `codec.ts`, `listener.py`, `main.ts`,
  `index.html`.
- **2026-09-05 -- boot-time flow auto-resume built: a persisted flow
  (`/_flow.mpy`) now restarts on any cold boot, not only on a live
  DEPLOY.** Mike's own explicit, unambiguous call, surfaced while
  scoping how far to take a flow-triggered reset-node idea (itself
  prompted by a real RP2040 finding -- stuck `wifi_status` oscillation
  under invalid-then-corrected credentials, clearing only on a power
  cycle, never a redeploy): "not persisting flows to survive reset or
  power cycle is pretty fundamental. fix it." Before this, every
  reset/power-cycle silently lost the running flow until a human
  noticed and manually redeployed, even though the compiled bytecode
  itself survived on flash the whole time -- `_handle_deploy` only ever
  ran `import _flow` in response to a live DEPLOY message arriving over
  an already-open connection, never at boot. Fixed with a new
  `listener.py` function, `_resume_flow()`, called once from `main()`
  before `run_forever()` starts (same synchronous-task-scheduling timing
  `_listener()`/`_heartbeat()`/`_send_hello()` already use): checks
  `_FLOW_PATH` for a persisted flow and imports it exactly the way
  `_handle_deploy` does, degrading to a logged no-op (never a boot
  failure) when the file is absent or corrupt/incompatible. Deliberately
  not routed through `_handle_deploy()` itself -- no incoming DEPLOY
  message to acknowledge, nothing running yet to cancel, no live
  connection this early in boot to send a DEPLOY_ACK to anyway.
  Confirmed against a real MicroPython unix-port build + real
  mpy-cross-compiled flows (not just `py_compile`):
  `test_listener_integration.py`'s `test_boot_time_flow_auto_resume`
  deploys once, kills that listener process, starts a brand new one
  against the same on-disk flow file with no second DEPLOY sent, and
  confirms the flow runs again; a second test confirms a corrupt
  persisted flow file doesn't block boot. Explicitly does NOT resolve
  `reset-before-deploy.md`'s own bigger, still-unscoped idea (DEPLOY_ACK
  semantics across a reset, host tooling tolerating a connection drop) --
  it closes exactly the one prerequisite that idea's own "not a
  one-liner" list already named, and separately makes the reset-node
  idea viable (a reset no longer loses the running flow). See
  `reset-before-deploy.md`'s 2026-09-05 update. `listener.py`,
  `test_listener_integration.py`.
- **2026-09-05 -- `messages.encode_message_body` now drops any
  `None`-valued key before CBOR-encoding, instead of passing it through
  to `cbor.encode` verbatim.** Found while building the real MicroPython
  toolchain to verify the auto-resume work above: `cbor.py` has no
  null/undefined support at all (by design -- its own header says this
  protocol's optional fields are meant to be omitted from the map
  entirely, never encoded as CBOR null), but `_send_hello()` was
  unconditionally sending `"runtimeBuild": _RUNTIME_BUILD`, which is
  `None` on any board with no `_runtime_build.txt` marker file. That
  raises `TypeError` inside `cbor.encode`, silently swallowed by
  `_send_message_safe` -- HELLO would never have actually reached the
  wire on exactly the boards this field was least tested against
  (anything bootstrapped before 2026-09-05, or pushed without git
  available). Fixed at the general encode path rather than patched
  around at the one call site, symmetric with the read side's own
  `_expect_optional_string`/`expectOptionalString`, which already treat
  "missing key" and "explicit None" as the same "not provided" case.
  Caught only because this session ran the actual off-device test suite
  against a real build rather than relying on `py_compile` alone -- see
  `learnings.md`. `messages.py`.

- **2026-09-05 -- flow identity: a stable, user-edited `flowName` (flow
  file + wire protocol) plus a per-deploy `deployId` (uuid, wire protocol
  only) -- deliberately two different kinds of identifier, not one.**
  Direct follow-on to boot-time flow auto-resume: once a flow can survive
  a reset, "is the flow running on this board the one I have open"
  becomes a real, recurring question, not hypothetical. Mike's own
  explicit call, correcting my initial framing (which had the uuid as the
  stable identity and the name as derived): "stable name, per deploy
  uuid. otherwise how do I know which flow to load in the editor?
  matching uuid against flow files would be painful" -- there's no index
  of flow files by uuid to search, so the field meant to be read by a
  human (which flow is this) has to be the human-chosen name, not an
  opaque generated id. `flowName` lives in the flow file itself
  (flow-file.ts, new `DEFAULT_FLOW_NAME`-backed field, a new toolbar text
  input in `index.html`/`main.ts`) and travels with every DEPLOY;
  `deployId` is a fresh `crypto.randomUUID()` main.ts generates on every
  single Deploy click, identifying *that one deploy action* -- redeploying
  the identical, unchanged flow twice still gets two different deployIds.
  Both come back out in HELLO as `currentFlowName`/`currentFlowDeployId`
  (null together = no flow has successfully started this boot), purely
  informational like `runtimeBuild`'s own check -- never gates a DEPLOY.
  Device-side: `listener.py` persists both to a new sidecar file
  (`_flow_meta.json`, alongside `_flow.mpy`/`_flow_static.bin`) on a
  successful deploy, recovers it in `_resume_flow()` on boot, and
  explicitly clears it (`_set_current_flow(None, None)`) right after
  `cancel_running()` in `_handle_deploy` -- a fixed pre-existing gap found
  while building this: a failed redeploy used to leave the OLD flow's
  identity looking "current" even though it had already been cancelled.
  Both new DEPLOY fields are optional/nullable on decode (an old editor
  that predates this feature still deploys fine against a new
  device-runtime), same additive-field convention as `runtimeBuild` --
  no version bump needed. Verified against the real MicroPython
  toolchain, not just `py_compile`: a new integration test deploys a
  named flow, kills that listener process, starts a brand new one, and
  confirms the SAME name/deployId come back in the boot HELLO with no
  second DEPLOY sent; a second new test confirms a failed redeploy
  reports no flow running, not the stale old one.
  `flow-file.ts`, `messages.ts`/`messages.py`, `codec.ts`, `listener.py`,
  `main.ts`, `index.html`.
