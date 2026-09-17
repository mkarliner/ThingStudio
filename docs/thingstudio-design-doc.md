# Thingstudio — Design Document

**A drag-and-drop, low-code environment for programming microcontrollers**

Status: draft v0.1 · 2026-08-09

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
- [13. Wire protocol (v1 sketch)](#13-wire-protocol-v1-sketch)
- [14. Project license and governance](#14-project-license-and-governance)
- [15. Proof-of-concept validation](#15-proof-of-concept-validation)
- [Sources](#sources)

## 1. Vision

Thingstudio is a browser-based, node-and-wire visual programming environment, in the spirit of Node-RED, whose output runs directly on a microcontroller rather than on a server. A user drags nodes onto a canvas — sensors, GPIO, timers, logic, math, network — wires them together, and pushes the resulting flow to a physically connected or networked device. The device runs the flow autonomously, with no host machine required afterward.

Flows are interpreted live by a small on-device virtual machine rather than compiled to native firmware. A running system can be edited without a flash-and-reboot cycle; live values are visible on the wires; a flow swaps in under a second.

## 2. Target audience

The same demographic Node-RED itself serves — home-automation tinkerers and IoT/automation professionals already comfortable with flow-based tools, MQTT, and JSON, who want a fast test/modify/deploy loop — not the education/beginner-programming audience that Scratch-derived block tools like MicroBlocks primarily serve. That framing has a direct design consequence already reflected in §5: a compile-and-flash cycle (XOD's and node-red-mcu's approach) is a worse fit for this audience's iteration-speed expectations than a live interpreter, even at the cost of some runtime performance.

## 3. Target hardware

At least:

- ESP32, all models
- Raspberry Pi 2040 and 2530
- RISC-V
- STM32

## 4. System architecture

Three components, talking over a swappable transport:

**Editor** — a browser-based canvas application where flows are built, node values are inspected live, and deploys are triggered. A thin local backend owns serial I/O, flow-file I/O, and static serving; the compiler and the `mpy-cross` WASM build stay client-side.

Two connection modes, chosen explicitly by the user rather than auto-detected: **direct** (WebSerial, local-only, no remote access, no auth) and **via backend** — network-secured (localhost behind a VPN) by default, or app-secured (LAN-exposed) as an explicit opt-in. See `working-notes/rete-migration-decision.md`, `working-notes/deployment-and-distribution-notes.md`.

Flows save to an ordinary file the user can `git init` and commit (§6) — the backend's own filesystem access under the backend-mediated path, or the browser's File System Access API (Chrome/Edge, manual export/import elsewhere) under direct/WebSerial.

**Transport** — the link between editor and device: USB serial (WebSerial in-browser, no drivers on Chrome/Edge) for the primary bring-up experience, with BLE (Web Bluetooth) and WiFi (local mDNS-discovered device, HTTP/WebSocket) as later additions for untethered deployment.

**Device runtime** — the on-device virtual machine: a bytecode interpreter, a fixed table of native node implementations (GPIO, timers, math, I2C/SPI, network, etc.), a scheduler for concurrent flow execution, and a thin protocol handler that accepts flow updates and streams live values back.

```
 ┌─────────────────────┐        serial / BLE / WiFi        ┌───────────────────────┐
 │   Browser Editor     │ ───────────────────────────────▶  │   Device Runtime (MCU) │
 │  canvas + node       │ ◀─────────────────────────────── │  VM + scheduler +      │
 │  palette + inspector │     live values, logs, status     │  native node table     │
 └─────────────────────┘                                    └───────────────────────┘
```

## 5. Execution model: on-device VM

The device ships a single runtime image once, flashed like any firmware. After that, flows are pushed as data (a compact bytecode/graph representation), not as new firmware, so redeploying a flow is a protocol message, not a flash cycle.

MicroPython is the on-device interpreter. It has ports for both target chip families (ESP32, RP2040/RP2350), a driver ecosystem for I2C/SPI sensors and peripherals, and `uasyncio`, a built-in async/await scheduler — each node or triggered subgraph is a coroutine/task on the event loop. The editor compiles the graph to Python source targeting a constrained subset, then precompiles it with `mpy-cross` into `.mpy` bytecode before sending it to the device; the device never runs the Python compiler itself. On-device compilation isn't an option at scale: MicroPython's own compiler needs RAM on top of whatever the resulting code needs, so it can fail outright (OOM) on a memory-constrained board even when the identical code runs fine once it's bytecode.

`mpy-cross` runs client-side as WebAssembly. The editor bundles a WASM build of `mpy-cross` and runs the compile step client-side; no local helper process or native binary is required. The WASM build needs rebuilding and testing against each MicroPython version bump.

The scheduler is `uasyncio`'s event loop directly: each node (or each independently-triggered subgraph — a timer, a GPIO interrupt, a network message) is a coroutine that runs to its next `await` and yields control. `uasyncio`'s own RAM/flash footprint is roughly 16–64KB depending on port and configuration, negligible against available RAM on both target platforms.

Live values: when the editor has a flow open, the device streams a throttled sample of tagged node outputs back over the transport, and wires show real data.

Fault isolation: an uncaught exception inside a node's coroutine is caught at the per-task boundary (`uasyncio` surfaces exceptions on task completion rather than letting them propagate) instead of crashing the whole event loop. The failing subgraph's task stops and reports a structured error back over the transport (node ID, exception type and message) for the editor's inspector (§8); the rest of the flow keeps running. A device-side watchdog resets the device if the VM itself wedges — an infinite loop that never hits an `await` — and the last-deployed flow resumes from flash, same as any power-cycle recovery.

The listener task — owning the raw transport stream, and per §9 disabling the interrupt-character escape hatch while it does — needs the same fault isolation: its dispatch loop must never exit on an unhandled exception (every phase wrapped, logged as a structured error, loop continues), and every blocking read within it is time-bounded rather than able to hang indefinitely on a partial or garbled transfer. A boot-time window (a few seconds) keeps the interrupt character live before the runtime commits to taking over the transport, as a fallback independent of the above.

Persistence covers two things. The last-deployed flow's bytecode and static data live in flash, so the device resumes the flow after power loss without the editor connected. Separately, user-facing runtime state — the value held by a variable get/set node, a calibration constant a node keeps — lives in its own flash-backed key/value area, keyed by node ID, distinct from the flow bytecode. This state survives a flow redeploy by default; a node can opt out and request its state be cleared on every deploy. The editor can read this store back over the transport for inspection.

Updating the runtime image itself (MicroPython plus the node library) is separate from redeploying a flow. v1 does this via a standard USB reflash (`esptool`/MicroPython's normal firmware-update flow). OTA is deferred to v2; the ESP32 build already lays out OTA-capable partitions (`ota_0`/`ota_1` plus OTA-data, with rollback on boot failure), so no already-deployed device needs a manual reflash later to become OTA-eligible. RP2040/RP2350 has no equivalent standard dual-partition scheme in the Pico SDK. A major-version runtime update may wipe the deployed flow and persisted state; recovery is redeploying the flow file from git. Minor/patch updates preserve the deployed flow.

## 6. Flow / graph representation

Flows are authored as a JSON graph — nodes with typed properties, edges connecting an output port on one node to an input port on another — close to Node-RED's own `flows.json` shape. The editor's in-browser compiler walks this graph and emits the compact bytecode/table representation the device actually consumes; the JSON graph is the thing saved, versioned, and diffed, never sent to the device directly. The compiled `.mpy` bytecode is a build artifact, not something checked in.

The flow file splits `nodes`/`edges` (changes only when behavior changes) from a separate `layout` section (positions, canvas viewport, visual grouping; changes only when someone rearranges the canvas). Serialization is deterministic — stable key ordering, stable node ordering by ID, consistent indentation — so re-saving an untouched flow produces a zero-diff. A project directory holds as many flow files as needed; a fleet of devices is a directory of flow files, each independently diffable.

Node categories for v1: GPIO in (interrupt/pin-change via `machine.Pin.irq()`, bridged into `uasyncio`, with a debounce cooldown property) and GPIO out/PWM; timers/intervals; I2C/SPI peripheral nodes (a handful of common sensors); simple state (variable get/set); WiFi status; HTTP request; MQTT publish/subscribe; UDP send/receive and TCP send/listen-receive; inject and debug; filter/event compression (change-only forwarding, rate-limiting). There's no dedicated boolean/arithmetic/comparator node and no ADC node — both reduce to a one-line function-node body (`payload > threshold`, `machine.ADC(pin).read_u16()`).

UDP send/receive is connectionless; receive is event-driven, not polled. TCP send is one-shot request/response with a lazy-expiry connection-reuse cache; TCP listen-receive is event-driven via `uasyncio.start_server`, bounded by a `maxConnections` property. Neither validates payload content; an open listening port is a known attack surface.

The function node runs actual (precompiled) MicroPython, not an invented expression language. It isn't sandboxed against its own author. The same watchdog that catches a wedged native node also catches a function node stuck in a loop that never yields.

Message model: wires carry a `msg` envelope — `payload` (the primary value), `topic` (a routing/identification string), and arbitrary extra properties a node can attach. `payload` is typed from a fixed set — `int`, `number` (float), `bool`, `string`, `bytes`, `any` — and the editor checks type compatibility at wire-connect time (an `int` output can feed a `number` input; a `bytes` output can't feed a `string` input without an explicit conversion node); an incompatible connection is refused outright.

Config nodes follow Node-RED's "Server" dropdown pattern: a config object is defined once per flow file (in a `configs` array, sibling to `nodes`/`edges`, sorted deterministically by id) and referenced by string id from consuming nodes. `CodegenContext.resolveConfig(id)` resolves a referenced config's properties or throws `CompileError` naming the missing id. Configs are referenced, never wired — they don't enter the compiler's node bookkeeping (`nodesById`/`childrenOf`/`sources`/reachability).

Two config types: `thingstudio/config/wifi` (`security` plus a `credentialName`) and `thingstudio/config/mqtt-broker` (just a `credentialName`). A node can reference both independently (`wifiConfigId`, `brokerConfigId`). `wifi_status`, `udp_send`, `udp_receive`, `mqtt_publish`, and `mqtt_subscribe` reference configs this way; `http_request` still reads raw `ssid`/`password` node properties directly (§10). A config value is shared by every node in a flow that references it; there is no per-device override/template layering yet (§10).

The real secret values — `ssid`/`password` for WiFi, `broker`/`port`/`username`/`password` for an MQTT broker — live in a named credential in the backend's own store (`~/.thingstudio/credentials/{wifi,mqtt-broker}/<name>.json`), not in the config node or the flow file. A config's `credentialName` is resolved to its backend-stored bundle once, at flow-load time, and merged into the in-memory config properties `resolveConfig()` reads; only the `credentialName` (and, for WiFi, `security`) round-trip back into a saved `.flow.json`. A credential is shared by name across every flow/config that references it, the same as any other config value. Renaming or deleting a saved credential is out of scope for v1.

Deferred past v1: a catch/error node the flow can react to; a self-hosted mini dashboard (gauge/switch/chart served from the device's own HTTP stack, needing an on-device HTTP server and a new UI-node category); Home Assistant auto-discovery on top of the MQTT node; on-demand log retrieval from a disconnected device; a Tasmota-style AP/captive-portal mode for boards with no configured WiFi credentials.

Single flow per device is a v1 scope choice. Every node/subgraph is a coroutine on one shared event loop (§5); the scheduler doesn't distinguish between two flows' tasks and one flow's tasks. MicroPython's `uasyncio` has a single global event loop with no multi-loop or per-`Runner` isolation, and RP2040/RP2350's second core can't host its own loop under standard `uasyncio`. If the second core is used for offloading blocking work via `_thread`, Peter Hinch's `micropython-async` project has threadsafe primitives (`ThreadSafeQueue`, `ThreadSafeEvent`) for it.

Multiple independently-deployed flows (deferred to v2, §10) need: node IDs globally unique across every flow on a device, not just within one; `DEPLOY` scoped to which node IDs it's replacing; and the editor tracking cumulative RAM/flash budget across every flow already deployed. Pin/peripheral conflicts between independently-authored flows are also not caught until runtime.

## 7. Extensibility

Node definitions have two halves: a small JSON descriptor for the editor (palette entry, ports, property UI) and a Python module implementing the node's behavior. Adding a new node type means pushing a new `.mpy` module to the device's filesystem alongside the flow, not rebuilding and reflashing the runtime. Existing MicroPython drivers for I2C/SPI sensors can generally be wrapped as a node with a thin adapter.

Performance- or timing-critical nodes (tight PWM/bit-banging, high-rate sampling) can use MicroPython's C-native modules and the `@micropython.native`/viper code emitters instead of pure Python.

v1's node set is fixed at flash time as part of the runtime image; there's no separate node distribution/version-skew mechanism yet. The node table's version is the runtime image's version, carried by `HELLO`'s major.minor.patch (§13). Post-v1, pushing a node without reflashing would add: the compiler emitting an `import` of a separately-pushed module, a module-push message, and a version/hash field in `HELLO`. Timing-critical nodes needing C-native modules generally still need a firmware rebuild, unless built on MicroPython's native `.mpy` loadable-module feature.

See `working-notes/node-definition-model.md` for the node-authoring contract.

## 8. Deployment and live debugging

Deploy is a diff where avoidable: on "Deploy," the editor compiles the graph, and (at least for small edits) the device can patch only what changed rather than reloading the whole flow. v1 can start with "replace the whole flow" and optimize later. The status/log/inspector panel shows connection state, per-node errors, and live port values.

## 9. Security considerations

The transport authenticates before accepting a flow write. The direct/WebSerial-only connection mode is gated by physical access; the backend-mediated path is not, since the backend can be reached remotely — board-runtime auth applies to both connection modes regardless. WiFi deployment (once built) requires a pairing step (e.g. a code shown on-device, or a first-use-over-USB provisioning flow).

**v1 mechanism**: HMAC-SHA256 over a shared secret, with a persisted monotonic counter in place of a random challenge nonce. `HELLO` reserves `authRequired`/`authScheme` fields even though v1 ships `authRequired: false`. Full mechanism and what's deferred (WiFi pairing/provisioning, the backend's own editor-facing auth, confidentiality/TLS): `working-notes/transport-auth-design.md`.

WiFi self-provisioning (built 2026-09-14): a flow whose WiFi config is set to "unmanaged" makes the device open its own soft-AP captive portal on first boot to collect real network credentials, instead of the flow needing them baked in. That portal doesn't reopen on its own if the saved credential later stops working — an opt-in per-config flag is needed for that — because reopening an unauthenticated AP any time WiFi drops is itself an attack surface: anyone in radio range during the drop could connect and redirect the device to a different network. Detail: `working-notes/outstanding-items/wifi-provisioning-captive-portal.md`.

The function node (§6) is unsandboxed; it sits inside the same deploy-access trust perimeter as any native node.

## 10. Phased roadmap

Before v1: three independent proof-of-concept spikes de-risked the core assumptions this roadmap depends on, followed by a fourth integration spike proving the full pipeline end-to-end — see §15.

v1 (bring-up): ESP32-C3 (or a higher-spec ESP32-family member) only, USB serial (WebSerial) transport, the v1 node set (§6), full-flow redeploy (no diffing), live value streaming, flow persistence across power cycles.

v2 candidates, roughly in order of likely value: RP2040/RP2350 support; BLE and WiFi transport with pairing/auth; per-device override for config nodes; a catch/error node; Home Assistant auto-discovery; `http_request` config-node coverage; MQTTS (MQTT over TLS) for `mqtt_publish`/`mqtt_subscribe`; incremental flow updates instead of full redeploy; mDNS device/service discovery; a TCP client node's proactive connection expiry.

v3+: a self-hosted mini dashboard (§6), multi-device flows (one flow spanning devices via network nodes), a companion server for team libraries and fleet deployment.

## 11. Open questions

~~Open: whether to adopt Peter Hinch's `micropython-async` — hardware driver primitives (switches/buttons/ADC/encoders), `ThreadSafeQueue`/`ThreadSafeEvent`, a cron-like scheduler, `aiorepl`, and `asyncio_alt` (a low-latency/lightsleep event loop variant). Not evaluated yet.~~ **Partially resolved, 2026-09-17:** adopted for switches/buttons. `thingstudio/eswitch`/`thingstudio/ebutton` vendor his `ESwitch`/`EButton`/`WaitAny`/`Delay_ms` classes (`device-runtime/src/vendor/primitives_events/`) verbatim, same vendoring convention as `ThreadSafeEvent`/`mqtt_as`. Still open for ADC (his §5 `AADC` driver, deferred as a follow-up item) and for encoders, `ThreadSafeQueue`, the cron-like scheduler, `aiorepl`, and `asyncio_alt` — none of those evaluated yet. `docs/working-notes/decisions/node-authoring.md` has the full reasoning.

## 12. Licensing and open-source suitability

Every third-party component this project depends on should carry an OSI-approved license, permissive (MIT/BSD/Apache-2.0) by default:

| Component | Role | License | Notes |
|---|---|---|---|
| MicroPython (core VM, `uasyncio`, `mpy-cross`) | on-device runtime | MIT | permissive, no concerns |
| ESP-IDF | ESP32 port substrate | Apache-2.0 | see caveat below on WiFi/BT binary blobs |
| FreeRTOS | RTOS underlying the ESP32 port | MIT | permissive since the v10.4+ relicense |
| lwIP | TCP/IP stack (ESP-IDF, RP2040 WiFi) | modified BSD | permissive |
| Raspberry Pi Pico SDK | RP2040/RP2350 port substrate | BSD-3-Clause | permissive |
| rete | browser canvas/node-editor library — headless core | MIT | replaces Litegraph.js (§15); release hiatus but not a maintenance hiatus (10 open issues against 12k stars) |
| rete-area-plugin | canvas rendering surface (pan/zoom/drag) | MIT | peer of `rete` above |
| rete-connection-plugin | wire drag gesture | MIT | peer of `rete` above |
| rete-render-utils | shared rendering utilities | MIT | peer of `rete-vue-plugin` |
| rete-vue-plugin | Vue 3 node/control renderer | MIT | sole maintainer `ni55an` — a bus-factor risk |
| vue | UI framework, peer dependency of `rete-vue-plugin` | MIT | |
| WebSerial / Web Bluetooth | browser transport APIs | n/a (browser platform APIs, not distributed code) | no license implication |

Caveat: Espressif distributes the ESP32 WiFi/Bluetooth and RF-calibration libraries as precompiled binary blobs bundled inside ESP-IDF, under Apache-2.0 redistribution terms — no license-obligation conflict, but not source-auditable at the radio-stack layer. Platform-wide ESP-IDF limitation, not specific to this design. RP2040/RP2350 builds don't have this issue for WiFi.

Before any public release: run an automated license scan (e.g., SPDX-based) over the pinned dependency tree, including indirect dependencies (npm packages, etc.) not audited above; treat this section as engineering due diligence, not legal advice — get an actual legal review, particularly for the ESP-IDF blob question.

## 13. Wire protocol (v1 sketch)

Concrete enough to build against, not a frozen spec. Framing: length-prefixed frames over the raw transport — a 2-byte length header plus payload, identical across serial/BLE/WiFi — with a 1-byte message type and a CBOR-encoded body.

Message types: `HELLO` (chip type, MicroPython/runtime version as major.minor.patch, free flash/RAM, `authRequired`/`authScheme`); `DEPLOY` (full flow bytecode plus static data, replacing whatever's currently deployed); `DEPLOY_ACK` / `DEPLOY_ERROR`; `VALUE_STREAM` (device → editor, throttled live port values); `NODE_ERROR` (device → editor, node ID plus exception type/message); `STATE_READ` / `STATE_WRITE` (the persisted variable store, §5).

Generated flow code is human-readable Python (named per-node functions/variables tied to node IDs), not a compact intermediate form.

The `auth` payload on `DEPLOY`/`STATE_WRITE` (scheme, counter, MAC) isn't fixed yet. WiFi pairing's handshake fields remain deferred, pending §9's WiFi pairing design.

## 14. Project license and governance

The project ships under a single, permissive license: Apache-2.0, for the explicit patent grant, matching ESP-IDF's own license.

Repo structure: a single monorepo (editor, device runtime glue, node library). Splitting into separate repos is a possible v2 move. Vendored third-party code keeps its own upstream license file (§12).

## 15. Proof-of-concept validation

Four proof-of-concept spikes de-risked this design's core assumptions before v1 work began, each testing a separate risk with no dependency on the others finishing first:

- **POC-A** (core runtime + redeploy loop): a live MicroPython/`uasyncio` runtime on real ESP32-C3 hardware, driven from a browser. Deploy-to-observable-change latency: ~99ms; 50 consecutive redeploys with no crash or memory creep.
- **POC-B** (`mpy-cross`-to-WASM toolchain): `mpy-cross` cross-compiled to WebAssembly, running client-side in a real Chrome tab with no special hosting requirements. Compile latency averaged under 1ms; output was byte-identical (SHA-256) to a native `mpy-cross` build.
- **POC-C** (canvas library feel): a side-by-side of Litegraph.js and Drawflow settled §4's canvas library choice at the time — Litegraph needed no custom infrastructure for type-checked wiring, live value propagation, or multi-select, where Drawflow needed all three hand-rolled. (The canvas library was later changed again, from Litegraph.js to Rete.js — see §12.)
- **POC-D** (canvas → compile → deploy → run): the full pipeline, authoring a flow on-canvas, compiling and cross-compiling it client-side, and deploying it to run correctly on real ESP32-C3 hardware — end to end, in one click. Surfaced the hardware-only fault-isolation gaps now folded into §5 and §9 (a listener task that must survive an unhandled exception, a client/device timeout mismatch, a `sys.stdin.read(n)` call that hangs the event loop outright).

Full methodology, measurements, and hardware-debugging detail: each spike's own README (`pocs/poc-a/` through `pocs/poc-d/`).

## Sources

- [MicroBlocks](https://microblocks.fun) — live block programming for microcontrollers; on-device VM, ESP32/ESP8266/RP2040/micro:bit support — via [Make: overview](https://makezine.com/article/technology/iot/microcontrollers-meet-microblocks/), [CNX Software](https://www.cnx-software.com/2023/01/30/microblocks-visual-programming-interface-for-32-bit-microcontrollers/), [Seeed Studio Wiki (XIAO ESP32-C3)](https://wiki.seeedstudio.com/xiao_esp32c3_microblocks/)
- [XOD](https://xod.io/) — node-based dataflow language for Arduino/microcontrollers, compiles to native code — via [Wikipedia](https://en.wikipedia.org/wiki/XOD_(programming_language)), [Hackaday](https://hackaday.com/2017/08/13/visual-development-with-xod/)
- [node-red-mcu (phoddie)](https://github.com/phoddie/node-red-mcu) — Node-RED for microcontrollers via the Moddable XS engine — via [Node-RED flow library listing](https://flows.nodered.org/node/@ralphwetzel/node-red-mcu-plugin)
- [MicroPython](https://micropython.org/) RAM/flash footprint on ESP32/RP2040 — via [MicroPython docs: constrained devices](https://docs.micropython.org/en/latest/reference/constrained.html), [ESP32 port README](https://github.com/micropython/micropython/blob/master/ports/esp32/README.md)
- [Litegraph.js](https://github.com/jagenjo/litegraph.js/) and [Drawflow](https://github.com/jerosoler/Drawflow) — lightweight JS node-graph editor libraries, both MIT-licensed — via [LibHunt comparison](https://js.libhunt.com/compare-litegraph-js-vs-blockly), [Drawflow LICENSE](https://github.com/jerosoler/Drawflow/blob/master/LICENSE), [litegraph.js LICENSE](https://github.com/jagenjo/litegraph.js/blob/master/LICENSE)
- ESP-IDF WiFi/Bluetooth binary blob licensing — Apache-2.0 redistribution terms, closed-source blobs — via [esp-coex-lib](https://github.com/espressif/esp-coex-lib), [Tarlogic: Liberating Bluetooth on the ESP32](https://www.tarlogic.com/blog/liberating-bluetooth-on-the-esp32/)
- MicroPython-to-WebAssembly precedent, including an `mpy-cross`-specific in-browser compile demo — via [MicroPython `ports/wasm`](https://github.com/micropython/micropython/tree/master/ports/wasm), [micro:bit Foundation browser-compiler-playground](https://github.com/microbit-foundation/micropython-browser-compiler-playground)
- MicroPython `uasyncio` single-global-event-loop limitation, no per-thread/per-core loop support — via [micropython/micropython issue #5947](https://github.com/micropython/micropython/issues/5947), [micropython discussion #12423](https://github.com/orgs/micropython/discussions/12423)
- [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async) — MIT-licensed docs, tutorials, synchronization primitives, drivers, and tooling built on stock MicroPython `asyncio` v3 — via [repo README](https://github.com/peterhinch/micropython-async/blob/master/README.md), [v3 README](https://github.com/peterhinch/micropython-async/blob/master/v3/README.md), [LICENSE](https://github.com/peterhinch/micropython-async/blob/master/LICENSE)
