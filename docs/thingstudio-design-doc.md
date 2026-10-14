# Thingstudio — Design Document

**A drag-and-drop, low-code environment for programming microcontrollers**

Status: draft v0.2 · revised 2026-10-14 (v0.1 was 2026-08-09)

This revision updates the doc to match the shipped v0.2.0 system (runtime 10, editor release 2026-10-13): the
backend-first connection model and WiFi transport that replaced WebSerial-only talk, the board/processor
definition system, the display/GUI/touch and adc/encoder/neopixel node families, per-flow dependency delivery
(DEP_PUT/DEP_COMMIT), the security reality (board password + random-nonce session auth, not the never-built
monotonic-counter mechanism v0.1 described), and the roadmap as it actually stands. Sections whose content has
not changed carry forward largely untouched; the wire-protocol sketch (§13) and roadmap (§10) have drifted the
farthest and are the most rewritten. Working-notes pointers use the current paths under `docs/working-notes/`.

## Contents

- [1. Vision](#1-vision)
- [2. Target audience](#2-target-audience)
- [3. Target hardware](#3-target-hardware)
- [4. System architecture](#4-system-architecture)
- [5. Execution model: on-device VM](#5-execution-model-on-device-vm)
- [6. Flow / graph representation](#6-flow--graph-representation)
- [7. Extensibility](#7-extensibility)
- [8. Deployment and live debugging](#8-deployment-and-live-debugging)
- [9. Security considerations](#9-security-considerations)
- [10. Phased roadmap](#10-phased-roadmap)
- [11. Open questions](#11-open-questions)
- [12. Licensing and open-source suitability](#12-licensing-and-open-source-suitability)
- [13. Wire protocol (v1, shipped)](#13-wire-protocol-v1-shipped)
- [14. Project license and governance](#14-project-license-and-governance)
- [15. Proof-of-concept validation](#15-proof-of-concept-validation)
- [Sources](#sources)

## 1. Vision

Thingstudio is a browser-based, node-and-wire visual programming environment, in the spirit of Node-RED, whose
output runs directly on a microcontroller rather than on a server. A user drags nodes onto a canvas — sensors,
GPIO, timers, logic, math, network — wires them together, and pushes the resulting flow to a physically
connected or networked device. The device runs the flow autonomously, with no host machine required afterward.

Flows are interpreted live by a small on-device virtual machine rather than compiled to native firmware. A
running system can be edited without a flash-and-reboot cycle; live values are visible in the editor; a flow
swaps in under a second.

## 2. Target audience

The same demographic Node-RED itself serves — home-automation tinkerers and IoT/automation professionals already
comfortable with flow-based tools, MQTT, and JSON, who want a fast test/modify/deploy loop — not the
education/beginner-programming audience that Scratch-derived block tools like MicroBlocks primarily serve. That
framing has a direct design consequence already reflected in §5: a compile-and-flash cycle (XOD's and
node-red-mcu's approach) is a worse fit for this audience's iteration-speed expectations than a live
interpreter, even at the cost of some runtime performance.

## 3. Target hardware

The "at least" list from v0.1 — ESP32 all models, RP2040/RP2350, RISC-V, STM32 — has become a concrete,
definition-driven support matrix rather than a wish list:

- **ESP32 family (ESP32, S2, S3, C3), RP2040, RP2350** are supported and tested. Named tested boards include
  the Raspberry Pi Pico (RP2040), Pico W (RP2040 + WiFi), Pico 2 (RP2350), LOLIN S2 Mini (ESP32-S2), LuatOS
  ESP32C3-CORE (ESP32-C3), the classic CYD ESP32-2432S028 (ESP32, display), and the Freenove ESP32-S3 Display
  4.0" FNK0104S (ESP32-S3, display + touch). See `docs/user-guide/supported-hardware.md` for the full tested
  table.
- Any MicroPython board can be used by picking its **processor** from the Board menu; named **board**
  definitions additionally label the board's own pins. `ui`/`pin-check` and compile (`-march`, pin
  reservation checks) read from hand-editable JSON definition files, merged built-ins plus user files in
  `~/.thingstudio` (see `docs/working-notes/decisions/chip-board-definitions.md`).
- **RISC-V** ESP32 variants (C6/H2/P4): an open bug — they resolve to the classic ESP32 processor by substring
  match, getting wrong pin checks and `-march`. Not an MVP chip, tracked in `outstanding-items.md`.
- **STM32/F4 pyboard**: a built-in `stm32f405` processor and `pyboard-v10` board definition (named pins,
  `X1`/`Y1`), and the runtime now builds every persisted path from the board's filesystem root (`os.getcwd()`,
  `/flash` on stm32) instead of a hardcoded `/`. Not yet verified on real hardware; tracked as
  `outstanding-items/stm32-pyboard-support.md`.

The design consequence of "expect any MicroPython board" is stated in the project rules: docs and console
messages do not assume the board is on the supported list, and the runtime install step says which chips are
covered and points everything else at the MicroPython docs.

## 4. System architecture

Three components, talking over a swappable transport:

**Editor** — a browser-based canvas application where flows are built and deploys are triggered. It compiles the
flow itself: to MicroPython source, then to `.mpy` bytecode with a WebAssembly build of `mpy-cross` running
client-side. It talks to a local backend over one multiplexed WebSocket plus an HTTP admin API.

**Backend** — a thin local Python (`aiohttp`) program, the primary connection path. It relays board traffic
(USB serial and WiFi TCP), owns the `~/.thingstudio` data store (credentials, custom nodes, presets,
definitions), installs the device runtime over raw REPL, and serves the built editor and user docs. It binds to
loopback only (`__main__.py`) until a remote-access auth posture is built.

How the editor connects, two modes — **via backend** (default) and **direct/WebSerial** (kept as a working but
hidden fallback since the backend became the owner of persisted data, 2026-09-06; see
`docs/working-notes/decisions/backend.md`). The user picks explicitly; neither is auto-detected. Flows save to
an ordinary file the user can `git init` and commit (§6) — via the browser's File System Access API
(Chrome/Edge; manual export/import elsewhere), **not** through the backend's filesystem.

**Device runtime** — the on-device virtual machine: MicroPython, a protocol listener, a small scheduler glue
over `uasyncio`, and a fixed API surface (`runtime.py`) that generated flow code calls; the node
"implementations" themselves are the generated Python, delivered per-deploy (§6, §7).

```
 ┌─────────────────────┐   WebSocket / HTTP   ┌────────────────────┐   serial (F64 lines)   ┌───────────────────────┐
 │   Browser Editor     │ ───────────────────▶ │  Local backend      │ ─────────────────────▶ │  Device Runtime (MCU) │
 │  canvas + palette +  │ ◀─────────────────── │  relay + ~/.thing-  │ ◀───────────────────── │  listener + runtime + │
 │  compiler + mpy-cross│  F64 frames, debug   │  studio store       │  F64 frames, print()   │  generated _flow      │
 │  (WASM)              │                     │                     │  WiFi TCP:7462 (auth)  │                       │
 └─────────────────────┘                      └────────────────────┘                        └───────────────────────┘
```

## 5. Execution model: on-device VM

The device ships a single runtime image once, flashed like any firmware. After that, flows are pushed as data
(compiled bytecode plus any libraries they import), not as new firmware, so redeploying a flow is a protocol
message, not a flash cycle.

MicroPython is the on-device interpreter. It has ports for both target chip families (ESP32, RP2040/RP2350), a
driver ecosystem for I2C/SPI sensors, and `uasyncio`, a built-in async/await scheduler — each node or triggered
subgraph is a coroutine/task on the event loop. The editor compiles the graph to Python source targeting a
constrained subset, then precompiles it with `mpy-cross` into `.mpy` bytecode before sending it to the device;
the device never runs the Python compiler itself. On-device compilation isn't an option at scale: MicroPython's
own compiler needs RAM on top of whatever the resulting code needs, so it can fail outright (OOM) on a
memory-constrained board even when the identical code runs fine once it's bytecode. This is unchanged from v0.1
and has held.

`mpy-cross` runs client-side as WebAssembly, bundled with the editor (`mpy-cross-wasm/`); the compile is
`-march`-aware per board/processor target. The WASM build needs rebuilding and testing against each MicroPython
version bump.

The scheduler is `uasyncio`'s event loop directly: each independently-triggered subgraph — a timer, a GPIO
interrupt, a network message — is a coroutine that runs to its next `await` and yields. The listener's tasks
(protocol receive loop, heartbeat, HELLO sender, WiFi session watcher) share the same loop.

Fault isolation, shipped: an uncaught exception inside a node's coroutine is caught at the per-task boundary
instead of crashing the whole event loop. Every generated node call is wrapped so the failure is attributed to
the exact node (`raise runtime.NodeError(nodeId, e)`); the failing subgraph's task reports `NODE_ERROR` (node
ID, exception type and message) and stops, while the rest of the flow keeps running. The listener's own
receive loop never exits on an unhandled exception, every read is time-bounded, and a `MemoryError` while
receiving answers `DEPLOY_ERROR` rather than leaving the editor to time out. A boot-time window (a few seconds)
keeps the interrupt character live before the runtime commits to taking over the transport.

Boot-loop protection, shipped: if the deployed flow fails to stay up for ~10 s on three boots in a row, the
runtime enters safe mode and does not resume the flow, so a bad flow can't brick a board into a reset loop. A
device-side watchdog for a wedged flow that never hits `await` is **not** built — tracked under §10.

Persistence covers one thing today: the last-deployed flow's bytecode and identity survive power loss — the
device writes `/_flow.mpy` and `/_flow_meta.json` on deploy and `import _flow` resumes the flow at boot,
including through safe mode decisions. Also on flash: the boot counter, board settings (`/_board.json` —
hostname, password salt+derived key), WiFi provisioning credentials, and the flow-dependency index (`/lib`).
The v0.1 §5 flash-backed **state store** (a node-ID-keyed key/value area surviving redeploys, read/write over
`STATE_READ`/`STATE_WRITE`) is **not built** and deliberately deferred (§10); those message types exist on the
wire but the listener logs them as ignored Tier 2.

Hardware resources are **keyed singletons** — every unique resource (GPIO pin, ADC channel, PWM, SPI/I2C bus,
touch panel) is claimed at compile time (`claimResource`: a second node wanting a different use of the same pin
is a `CompileError` naming both nodes) and obtained on the board through `runtime.shared(kind, key, signature,
factory)`, Peter Hinch's functor-singleton pattern with a stricter rule: a later user with different settings
is an error, never silently ignored. Singletons are cleared on every redeploy. See
`docs/working-notes/decisions/hardware-singletons.md`.

Updating the runtime image itself is separate from redeploying a flow, and no longer happens via a manual
`esptool` step: the editor's **Tools → Install runtime…** pushes the whole `device-runtime/src` package over
USB serial through the backend's raw-REPL path (base64-chunked file writes, then reset), with the version being
a git-SHA build stamp plus the semver `_RUNTIME_VERSION`. OTA is still deferred: the ESP32 build's OTA-capable
partition layout remains tracked (`outstanding-items/ota-partition-table.md`) but Mike deferred building it past
MVP — no field devices exist yet, so a manual reflash of early boards is the cheaper call.

## 6. Flow / graph representation

Flows are authored as a JSON graph — nodes with typed properties, edges connecting an output port on one node
to an input port on another — close to Node-RED's own `flows.json` shape. The editor's in-browser compiler
walks this graph and emits the Python source the device actually runs; the JSON graph is the thing saved,
versioned, and diffed, never sent to the device directly. The compiled `.mpy` bytecode is a build artifact, not
something checked in.

The flow file splits `nodes`/`edges` from a separate `layout` section (positions, canvas viewport, pane
membership), configs into their own `configs` array, and GUI screens into `screens` — so "moved a node" diffs
separately from "changed behavior". Serialization is deterministic (stable key ordering, stable node ordering
by ID, consistent indentation): re-saving an untouched flow is a zero-diff; a project directory holds as many
flow files as needed, each independently diffable. Node IDs are stable UUIDs, never renumbered.

The current node library (registry in `editor/src/node-library/registry.ts`, ~37 types) covers:

- **GPIO/timing**: `gpio_out`, `pwm_out`, `interrupt` (raw pin-change event source), `eswitch`/`ebutton`
  (Peter Hinch's debounced async switch/button primitives), `timer` (interval/poll source), `startup` (fires
  once at flow start, after deploy or boot resume), `inject`, `delay`.
- **Displays/GUI/touch** (v0.2.0's headline): `display_spi` and `display_i2c` (ST7789/ST7796 color TFTs,
  SSD1306 OLED, with `rgb565`/`gs4`/`gs2`/`mono` framebuffer depths), a GUI family — `gui_screen`,
  `gui_label`, `gui_readout`, `gui_bar`, `gui_trend`, `gui_led`, `gui_button`, `gui_navigator`, `gui_modal` —
  driven by the vendored `thingstudio_gui` subsystem, plus `touch_i2c` (FT6336U first) and `i2c_generic`.
- **Sensors/analog**: `adc` (async sampled), `encoder` (Hinch's quadrature), `bme280` (I2C), `neopixel`
  (WS2812).
- **Network**: `wifi_status`, `wifi_gate`, `http_request`, `http_in`/`http_response` (exact-path-match v1
  server), `mqtt_publish`/`mqtt_subscribe` (vendored `mqtt_as`), `udp_send`/`udp_receive`, `ntp` (sets the RTC, sends the time). TCP send/listen-
  receive were scoped but **never built** — deferred (§10).
- **Logic/state**: `function` (runs actual precompiled MicroPython, single or multiple outputs), `variable_get`/
  `variable_set` (in-RAM `_flow_vars` store; the dedicated canvas nodes are hidden pending a Node-RED-style
  context model), `filter` (change-only/rate-limiting event compression), `journal` (ring-buffer time series for
  the trend widget), `debug` (prints to the device console), `inject`.
- No dedicated boolean/arithmetic/comparator/ADC node: those reduce to a one-line function-node body
  (`payload > threshold`, `machine.ADC(pin).read_u16()`). Mike's 2026-08-21 call on that held.

Config nodes follow Node-RED's "Server" dropdown pattern: config objects live in the `configs` array, sorted
deterministically, and are referenced by string id from consuming nodes — never wired. `CodegenContext.resolveConfig(id)`
resolves a referenced config's properties or throws `CompileError` naming the missing id. Config types shipped:
`thingstudio/config/wifi` (a singleton — a board has one radio), `thingstudio/config/i2c-bus` (a **keyed**
singleton, one per bus number), `thingstudio/config/touch-panel` (controller, I2C bus ref, geometry and
orientation, with presets), and `thingstudio/config/mqtt-broker`. `http_request` migrated from raw
ssid/password node properties onto the WiFi config.

The real secrets — `ssid`/`password` for WiFi, `broker`/`port`/`username`/`password` for an MQTT broker, and
the board's WiFi-transport password — live in a named credential in the backend's own store
(`~/.thingstudio/credentials/{wifi,mqtt-broker,board}/<name>.json`), not in the config node or the flow file. A
config's `credentialName` is resolved (fetched from the backend) at flow-load time and merged into the
in-memory config properties `resolveConfig()` reads; only the name round-trips into a saved `.flow.json`. A
credential is shared by name across every flow/config that references it. Renaming/deleting saved credentials
is out of scope.

Message model: wires carry a `msg` envelope — `payload` (the primary value), `topic` (a routing/identification
string, required on every message), and arbitrary extra properties a node can attach. `payload` is typed from a
fixed set — `int`, `number` (float), `bool`, `string`, `bytes`, `any` — and the editor checks compatibility at
wire-connect time (an `int` output can feed a `number` input; a `bytes` output can't feed a `string` input
without an explicit conversion; an incompatible connection is refused outright). Generated code treats `msg` as
a plain dict: sources build it, transforms return a (possibly new) `msg`, fan-out clones per branch
(`dict(msg)`) so branches can diverge, sinks read `msg.get('payload')`.

Single flow per device is a v1 scope choice. Every node/subgraph is a coroutine on one shared `uasyncio` event
loop; the scheduler doesn't distinguish between two flows' tasks and one flow's tasks. Multiple independently-
deployed flows (deferred to v2, §10) need: globally unique node IDs across flows, `DEPLOY` scoped to which node
IDs it replaces, and per-flow RAM/flash budget tracking; pin conflicts across independently-authored flows
remain runtime-only even then.

## 7. Extensibility

v0.1's "node set fixed at flash time" is superseded. The device runtime ships a small, stable API surface
(`runtime.py`: `spawn`, `shared`, `NodeError`, `register_cleanup`, `register_trigger`/`fire_trigger`,
`report_status`, `cancel_running`, `start_reason`); **every node's device-side behavior is generated Python
code, authored as a TypeScript codegen module in the editor** and shipped inside the deployed flow. Adding a
node type means adding a `NodeDefinition` to `editor/src/node-library/` (descriptor: kind, ports, property UI;
codegen half: Python template strings), registering it, and documenting it in the nodes catalog — no runtime
reflash.

Two additional delivery mechanisms land on top of that:

- **Flow dependencies** (runtime ≥ 7): libraries a flow imports — vendored drivers (`mqtt_as`, display
  drivers, GUI + fonts, sensor drivers) — are not baked into the runtime image; the editor scans the compiled
  Python for imports, compiles the needed libraries to `.mpy`, and ships them per-deploy into `/lib` via
  `DEP_PUT`/`DEP_COMMIT`, so a board only ever carries what its flows use. The dep catalog lives in
  `device-runtime/src/runtime_manifest.py` and is served at `/api/dependencies`. See
  `docs/working-notes/decisions/flow-dependencies.md`.
- **Custom nodes**: a package is two files — `<name>.node.json` (inert descriptor) + `<name>.node.py` (opaque
  MicroPython spliced into generated source inside a per-instance closure) — stored in `~/.thingstudio` and
  merged into the registry at compile; no compiler-core changes. See `docs/working-notes/node-definition-model.md`.
- **Headless compile**: `thingstudio-compile` (`editor/src/cli/`) runs the same compiler and the same
  vendored `mpy-cross` WASM outside the browser, so an AI authoring agent can validate a flow file before a
  deploy. `--describe` generates the nodes catalog (`docs/user-guide/nodes-catalog.md`).

Performance- or timing-critical code can use MicroPython's native emitters (`@micropython.native`/`viper`) —
already shipped inside the display-framebuffer expansion loops — and native modules generally need a firmware
rebuild. Timing-critical nodes needing C-native modules still carry that cost.

## 8. Deployment and live debugging

Deploy is full-flow replacement: on "Deploy," the editor type-checks nothing new (wires were checked at connect
time), compiles the canvas to Python, then to `.mpy` via mpy-cross WASM, computes the flow's dependency set,
ships missing libraries (`DEP_PUT`/`DEP_COMMIT`), and sends one `DEPLOY` message with the bytecode. The device
verifies dependencies before touching the running flow, cancels the running flow's tasks, writes `/_flow.mpy`,
and `import _flow`s the new one. Incremental/diff deploys remain a v2 candidate (§10).

The status/log/inspector panel shows: connection state (backend/serial/WiFi), the board's HELLO identity and
version checks (major-mismatch gating, §9/§13), **per-node status dots** (`NODE_STATUS`: connected/
disconnected/connecting/error — for `wifi_status` and MQTT nodes), **per-node errors** (`NODE_ERROR` red-
highlighting the failing node), and the device's plain `print()` console output (including `debug` node lines).
**Wire-level live value streaming (`VALUE_STREAM`) was not built** — Mike's call: not actually asked for; the
near-term bar was the connection-status indicator, shipped 2026-09-10. **2026-10-14: decided not to build it** —
live value streaming targets real-time events and would slow flows, and Node-RED has no equivalent. `VALUE_STREAM`
stays reserved on the wire (§13) with validators on both sides; the `debug` node documents that emitting it later is
additive.

## 9. Security considerations

The transport authenticates before accepting a flow write where the transport can be reached remotely. Two
different mechanisms apply:

- **Serial (USB)**: unauthenticated in v1 — gated by physical access.
- **WiFi transport (shipped 2026-09-24)**: a **board password** set over USB (Board settings…) is the pairing
  step. Each session opens with a **random-nonce HMAC-SHA256 challenge** (the radio is up, so the RNG is real)
  — the board sends `TSAUTH1 <hostname> <nonce> <salt> <iterations>`, the backend answers with
  `HMAC-SHA256(derived_key, nonce)`; the password itself never crosses the wire. A board with no password set
  opens no network listener at all. `HELLO.authRequired`/`authScheme` carry the state. Detail:
  `docs/working-notes/decisions/wifi-transport.md`, `docs/working-notes/transport-auth-design.md`.

This **replaces** v0.1 §9's "HMAC-SHA256 over a shared secret with a persisted monotonic counter" — that
mechanism was never built; designing around a counter assumed no trustworthy on-chip RNG, which the WiFi path
does not need (§13 notes the change).

WiFi self-provisioning (built 2026-09-14): a flow whose WiFi config is "unmanaged" makes the device open its
own soft-AP captive portal on first boot to collect real network credentials. The portal does **not** reopen on
its own if the saved credential later stops working — reopening an unauthenticated AP any time WiFi drops is
itself an attack surface (anyone in radio range could connect and redirect the device); reopening is an opt-in
per-config flag (`allowReprovisioning`). Detail: `docs/working-notes/outstanding-items/wifi-provisioning-captive-portal.md`.

Backend posture: binds loopback-only; a Host-header allowlist middleware (DNS-rebinding defense) 403s anything
outside `localhost`/`127.0.0.1`/`[::1]` by default, and CORS reflects the request's Origin (the editor is
served from the same backend by default). A remote-access posture (opt-in, authenticated) is out of scope for
now; remote use goes through a loopback tunnel.

The function node (§6) is unsandboxed; it sits inside the same deploy-access trust perimeter as any native
node.

## 10. Phased roadmap

Where v0.1 had a plan, this is the record. The pre-v1 spikes (§15) de-risked the core bets; v1 was then
deliberately grown past its original "ESP32-C3 + WebSerial only" scope as the backend relay and board-support
work landed.

**Shipped (v0.2.0, released 2026-10-13, runtime 10):**

- Backend relay (serial + WiFi TCP) with the multiplexed WebSocket and HTTP admin API; editor served by the
  backend; WebSerial kept as a hidden fallback.
- WiFi transport with board-password/random-nonce auth, UDP probe discovery, board settings (hostname,
  password) — the original `HELLO`/pairing requirements.
- Editor-driven runtime install over serial (Tools → Install runtime) and Remove flow / board recovery.
- Board/processor definition system (named boards, per-board pins, `-march`-aware compile, Pins… page).
- Flow dependencies (libraries shipped per-deploy into `/lib`, runtime 7+), full-flow redeploy, boot-time
  flow auto-resume, safe mode, NODE_STATUS dots, EXEC/STOP_TO_PROMPT/RESTART tool commands.
- Display/GUI/touch family (display-spi/i2c, gui screen + widgets, touch-i2c, journal/trend, clock) —
  the v0.2.0 headline; plus `adc`, `encoder`, `neopixel`, `eswitch`/`ebutton`, `filter`, `startup`, `wifi_gate`,
  HTTP server nodes (`http_in`/`http_response`).
- Headless `thingstudio-compile` CLI and AI-authoring docs/catalog.
- Hardware singletons (`runtime.shared` + compile-time `claimResource`).

**v2 / post-MVP candidates** (from `docs/working-notes/outstanding-items.md`, roughly in value order, all
Mike-prioritized): Home Assistant auto-discovery (proposed first post-launch); a catch/error node; **flash-
backed state store** (`STATE_READ`/`STATE_WRITE` — deferred design work, §5); **wire-level live value
streaming** (`VALUE_STREAM`); MQTTS (MQTT over TLS); incremental flow updates; BLE transport; per-device config
override; TCP send/listen-receive nodes (scoped, never built); OTA-capable ESP32 partitions (deferred: no field
devices yet); device-side watchdog; a Node-RED-style context model for `variable_get`/`variable_set`; parallel
multicore support; `touch_spi` for classic CYDs; GT911/CST820 touch controllers; install-MicroPython-from-the-
editor (deferred: too many firmware variants).

**v3+**: multi-device flows (one flow spanning devices via network nodes), a companion server for team
libraries and fleet deployment.

## 11. Open questions

Many of v0.1's open questions have since resolved in place; these are the live ones.

- ~~Whether to adopt Peter Hinch's `micropython-async`~~ **Resolved in stages (2026-09-17, 2026-10-11):**
  switches/buttons (`eswitch`/`ebutton`, vendored `primitives_events/`), async ADC (`adc`, vendored `aadc`),
  and quadrature encoder (`encoder`, vendored `primitives_encoder`) are adopted; `ThreadSafeEvent` and
  `mqtt_as` are vendored. Still open: `ThreadSafeQueue`, the cron-like scheduler, `aiorepl`, and `asyncio_alt`,
  none evaluated yet. `docs/working-notes/decisions/node-authoring.md` has the full reasoning.
- **The flash-backed state store's design** (scope, storage format, opt-out-on-deploy semantics) is the largest
  open architecture item; it connects to the un-scoped Node-RED-style context model (`stateful-nodes-join.md`).
- **Networking races across boards** are accepted limitations, not chases: the `wifi_status`-vs-`mqtt_as`
  ordering race holds on RP2040 but not ESP32, and the ESP32 WLAN state isn't torn down on redeploy — both
  documented per the project rule ("make the failure legible" over playing whack-a-mole).
- **RISC-V ESP32 variants** (C6/H2/P4) misidentify as classic ESP32; **STM32** filesystem support is open.
- Whether to file an upstream issue for the `mqtt_as` WiFi-reconnect race: undecided, Mike's call (the same
  fix class has been raised upstream before without landing; Thingstudio fixed it locally).

## 12. Licensing and open-source suitability

Every third-party component this project depends on should carry an OSI-approved license, permissive
(MIT/BSD/Apache-2.0) by default. The authoritative running ledger is `docs/third-party-licenses.md`; the core
components:

| Component | Role | License | Notes |
|---|---|---|---|
| MicroPython (core VM, `uasyncio`, `mpy-cross`) | on-device runtime / toolchain | MIT | permissive, no concerns |
| ESP-IDF | ESP32 port substrate | Apache-2.0 | see caveat below on WiFi/BT binary blobs |
| FreeRTOS | RTOS underlying the ESP32 port | MIT | permissive since the v10.4+ relicense |
| lwIP | TCP/IP stack (ESP-IDF, RP2040 WiFi) | modified BSD | permissive |
| Raspberry Pi Pico SDK | RP2040/RP2350 port substrate | BSD-3-Clause | permissive |
| rete / rete-area / rete-connection-plugin / rete-render-utils / rete-vue-plugin | canvas/node-editor (replaced Litegraph.js, §15) | MIT | `rete-vue-plugin`'s sole maintainer remains a bus-factor risk |
| vue | UI framework, peer of `rete-vue-plugin` | MIT | |
| peterhinch/micropython-async (mqtt_as, ThreadSafeEvent, primitives) | vendored flow dependencies | MIT | vendored under `device-runtime/src/vendor/` |
| mqtt_as (MIT), ssd1306 (MIT), st7789py-st7796 (MIT), bme280 (MIT), ft6336u (Thingstudio's own) | vendored drivers | MIT | per-flow deps, see the ledger |
| Atkinson Hyperlegible + DSEG7 bitmap fonts | GUI fonts | OFL | generated by `tools/vendor/font_to_py/` |
| WebSerial / Web Bluetooth | browser transport APIs | n/a (browser platform APIs) | no license implication |

Caveat: Espressif distributes the ESP32 WiFi/Bluetooth and RF-calibration libraries as precompiled binary blobs
bundled inside ESP-IDF, under Apache-2.0 redistribution terms — no license-obligation conflict, but not
source-auditable at the radio-stack layer. Platform-wide ESP-IDF limitation, not specific to this design.

Before any public release: run an automated license scan (e.g., SPDX-based) over the pinned dependency tree,
including indirect dependencies not audited above; treat this section as engineering due diligence, not legal
advice.

## 13. Wire protocol (v1, shipped)

Concrete and built, not a sketch. Framing: a frame is a 2-byte big-endian length header (counting the type byte
plus body) + a 1-byte message type + a CBOR-encoded body, bounded at 64 KB. Over the transport each complete
frame is base64-encoded into one `F64:`-prefixed text line — identical on serial and WiFi TCP — a deliberate
workaround for a real hardware bug (partial `read(n)` returns on some USB-UART bridges). Plain `print()` lines
from the device ride the same stream un-prefixed and are surfaced to the editor as debug text. The backend
relays frame bytes verbatim between WebSocket binary messages and `F64:` lines; it never decodes CBOR. The
device's CBOR is hand-rolled (no arrays/tags/indefinite lengths) and editors encode canonically, dropping
`null` keys — a `None`-encoding bug broke live messages once (2026-09-05); see `learnings/micropython-device-runtime.md`.

Message types, shipped (20; appended, never renumbered):

| Type | Direction | Purpose |
|---|---|---|
| `HELLO` | board → editor | chip, `runtimeVersion` (major.minor.patch), `runtimeBuild` (git SHA stamp), flow identity, free flash/RAM (+ ESP-IDF heap on ESP32), `safeMode`, `hostname`, `authRequired`/`authScheme`, `hasWifi`/`networkAddress`, dependency inventory |
| `HELLO_REQUEST` | editor → board | ask for a fresh HELLO without resetting |
| `DEPLOY` | editor → board | full flow: `bytecode` (the compiled `.mpy`), `staticData` (reserved, empty today), `flowName`/`deployId`, optional `wifiProvision` marker, optional `dependencies` map |
| `DEPLOY_ACK` / `DEPLOY_ERROR` | board → editor | result with memory figures, or a code+message (missing dependency → old flow keeps running) |
| `DEP_PUT` / `DEP_ACK` / `DEP_COMMIT` / `DEP_RESULT` | both | per-deploy library delivery: libraries split into 1 KB pieces, each acked, then committed into `/lib` |
| `NODE_ERROR` | board → editor | node ID + exception type/message (fault attribution) |
| `NODE_STATUS` | board → editor | per-node connection/state dot (`connected`/`disconnected`/`connecting`/`error`) |
| `TRIGGER` | editor → board | live-fire an inject node from the canvas |
| `EXEC` / `STOP_TO_PROMPT` / `RESTART` | editor → board | tool commands (run a snippet, drop to REPL, soft/hard reset) |
| `SET_BOARD_SETTINGS` / `BOARD_SETTINGS_RESULT` | both | hostname, WiFi-transport password |
| `VALUE_STREAM` | board → editor | reserved, validated on both sides, **not emitted yet** (Tier 2, §8) |
| `STATE_READ` / `STATE_WRITE` | both | reserved, validated, **explicitly ignored** by the listener (state store unbuilt, §5/§10) |

Generated flow code is human-readable Python (named per-node functions/variables tied to node IDs), not a
compact intermediate form. Auth moved from per-message payloads to the **session level**: the WiFi transport
authenticates the session (TSAUTH1, §9) and every subsequent message on it is trusted; serial carries no auth.
HELLO's `authRequired`/`authScheme` reflect whether the board has a password set.

The byte-level authority for this section is `interfaces/protocol/SPEC.md` (with `interfaces/protocol/messages.json`
and the conformance vectors in `interfaces/protocol/vectors/`), which the editor, device runtime and backend all run
as a shared test; this section remains the design-level narrative.

## 14. Project license and governance

The project ships under a single, permissive license: Apache-2.0, for the explicit patent grant, matching
ESP-IDF's own license.

Repo structure: a single monorepo (editor, backend, device runtime, docs, test-flows, POCs). Splitting into
separate repos is a possible v2 move. Vendored third-party code keeps its own upstream license file (§12).

## 15. Proof-of-concept validation

Four proof-of-concept spikes de-risked this design's core assumptions before v1 work began, each testing a
separate risk with no dependency on the others finishing first:

- **POC-A** (core runtime + redeploy loop): a live MicroPython/`uasyncio` runtime on real ESP32-C3 hardware,
  driven from a browser. Deploy-to-observable-change latency: ~99ms; 50 consecutive redeploys with no crash or
  memory creep.
- **POC-B** (`mpy-cross`-to-WASM toolchain): `mpy-cross` cross-compiled to WebAssembly, running client-side in
  a real Chrome tab with no special hosting requirements. Compile latency averaged under 1ms; output was
  byte-identical (SHA-256) to a native `mpy-cross` build.
- **POC-C** (canvas library feel): a side-by-side of Litegraph.js and Drawflow settled the canvas library
  choice at the time — Litegraph needed no custom infrastructure for type-checked wiring, live value
  propagation, or multi-select. (The canvas library was later changed again, from Litegraph.js to Rete.js —
  see `docs/working-notes/decisions/editor-canvas.md`.)
- **POC-D** (canvas → compile → deploy → run): the full pipeline end to end on real ESP32-C3 hardware.
  Surfaced the hardware-only fault-isolation gaps now folded into §5 and §9 (a listener task that must survive
  an unhandled exception, a client/device timeout mismatch, a `sys.stdin.read(n)` call that hangs the event
  loop — the direct ancestor of today's `F64:` line framing, §13).

Full methodology, measurements, and hardware-debugging detail: each spike's own README (`pocs/poc-a/` through
`pocs/poc-d/`).

## Sources

- [MicroBlocks](https://microblocks.fun) — live block programming for microcontrollers; on-device VM, ESP32/ESP8266/RP2040/micro:bit support — via [Make: overview](https://makezine.com/article/technology/iot/microcontrollers-meet-microblocks/), [CNX Software](https://www.cnx-software.com/2023/01/30/microblocks-visual-programming-interface-for-32-bit-microcontrollers/), [Seeed Studio Wiki (XIAO ESP32-C3)](https://wiki.seeedstudio.com/xiao_esp32c3_microblocks/)
- [XOD](https://xod.io/) — node-based dataflow language for Arduino/microcontrollers, compiles to native code — via [Wikipedia](https://en.wikipedia.org/wiki/XOD_(programming_language)), [Hackaday](https://hackaday.com/2017/08/13/visual-development-with-xod/)
- [node-red-mcu (phoddie)](https://github.com/phoddie/node-red-mcu) — Node-RED for microcontrollers via the Moddable XS engine — via [Node-RED flow library listing](https://flows.nodered.org/node/@ralphwetzel/node-red-mcu-plugin)
- [MicroPython](https://micropython.org/) RAM/flash footprint on ESP32/RP2040 — via [MicroPython docs: constrained devices](https://docs.micropython.org/en/latest/reference/constrained.html), [ESP32 port README](https://github.com/micropython/micropython/blob/master/ports/esp32/README.md)
- [Litegraph.js](https://github.com/jagenjo/litegraph.js/) and [Drawflow](https://github.com/jerosoler/drawflow) — lightweight JS node-graph editor libraries, both MIT-licensed — via [LibHunt comparison](https://js.libhunt.com/compare-litegraph-js-vs-blockly), [Drawflow LICENSE](https://github.com/jerosoler/Drawflow/blob/master/LICENSE), [litegraph.js LICENSE](https://github.com/jagenjo/litegraph.js/blob/master/LICENSE)
- ESP-IDF WiFi/Bluetooth binary blob licensing — Apache-2.0 redistribution terms, closed-source blobs — via [esp-coex-lib](https://github.com/espressif/esp-coex-lib), [Tarlogic: Liberating Bluetooth on the ESP32](https://www.tarlogic.com/blog/liberating-bluetooth-on-the-esp32/)
- MicroPython-to-WebAssembly precedent, including an `mpy-cross`-specific in-browser compile demo — via [MicroPython `ports/wasm`](https://github.com/micropython/micropython/tree/master/ports/wasm), [micro:bit Foundation browser-compiler-playground](https://github.com/microbit-foundation/micropython-browser-compiler-playground)
- MicroPython `uasyncio` single-global-event-loop limitation, no per-thread/per-core loop support — via [micropython/micropython issue #5947](https://github.com/micropython/micropython/issues/5947), [micropython discussion #12423](https://github.com/orgs/micropython/discussions/12423)
- [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async) — MIT-licensed docs, tutorials, synchronization primitives, drivers, and tooling built on stock MicroPython `asyncio` v3 — via [repo README](https://github.com/peterhinch/micropython-async/blob/master/README.md), [v3 README](https://github.com/peterhinch/micropython-async/blob/master/v3/README.md), [LICENSE](https://github.com/peterhinch/micropython-async/blob/master/LICENSE)