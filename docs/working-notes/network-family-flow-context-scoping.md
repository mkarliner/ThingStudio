# Network family flow-context parity — scoping

Status: scoping, 2026-10-18. **On hold pending the compile-hook spike:** Mike approved the hook direction the same
day (`package-compile-hooks-scoping.md`, gated on its §8 spike), and `reviews/2026-10-18-node-parity-architecture.md`
holds this vocabulary line until the spike reports. If the spike says go, most of this note is replaced by the hook
(the inventory stays useful); if no-go, these forms are the fallback. **`ts_wifi` is approved independently** — a
package still needs the on-device WiFi bring-up either way — but it lands with the flips, not before the decision.
Proposes; does not commit. Every descriptor/schema addition below needs Mike's explicit OK in the session that lands
it (`AGENTS.md`, "Interface specs"). Extends `node-context-parity-scoping.md` (phase 2) and
`node-parity-remaining-nodes-briefing.md` (the eight blocked nodes).

## 1. What is already expressible

Two pieces the briefing listed as blockers are simpler than they look:

- **WiFi credentials.** A custom/core package can already get the flow's one WiFi config:
  `{ kind: "configRef", configType: "thingstudio/config/wifi", singleton: true }` resolves the flow's singleton
  config through `ctx.findConfigsOfType` and inlines its properties (`custom-node.ts`'s `singletonConfigLiteral`,
  in `custom-node.schema.json` since phase 2a). `main.ts` merges the credential bundle into the in-memory config
  before compile, so `ssid`/`password`/`security` arrive with the package's other properties. No new facility.
- **The MQTT broker config** already works through an ordinary named `configRef`.

So the flow-context gap for these nodes is narrower than "eight nodes need a context API":

| Node | Needs |
|---|---|
| `wifi-gate`, `http-request`, `ntp`, `udp-send`, `udp-receive`, `mqtt-publish`, `mqtt-subscribe` | a **node-presence query** (`flowHasMqttNodes`) + the shared **WiFi bring-up** behaviour |
| `http-in` | the above, plus a **sibling scan with properties** and per-port shared server setup |
| (`adc`, out of this family, separately) | the same presence query ("does this flow use WiFi?") |

## 2. The one missing query: node presence

`flowHasMqttNodes(ctx)` is `ctx.findNodesOfType("thingstudio/mqtt_*").length > 0`. Proposal — one data form,
following the `target`/`nodeId` precedent (a property field whose Python value is compiler-derived):

```ts
{ name: "deferToMqtt", label: "defer to mqtt", kind: "hasNode",
  nodeTypes: ["thingstudio/mqtt_publish", "thingstudio/mqtt_subscribe"] }
```

- Serializable, one-vocabulary, resolved by `pyPropertiesLiteral` → `true`/`false`.
- Any node type list, so `adc`'s later WiFi guard and any user package can use it.
- A missing `ctx.findNodesOfType` (hand-rolled test mocks) can degrade to `false` the way `flowHasMqttNodes`
  does, or throw; recommend **throw** (a real compiler always has it; silent `false` reintroduces the flapping bug
  in a mock-only path).

## 3. The shared WiFi bring-up

`wifiSetupStatement()` is more than credentials: it decides between `connect`, `unmanaged` (active only), and
`deferToMqtt` (no `connect`, plus the ESP32 import-time first join), and its generated statement is deduped across
every network node under the one `wifi-sta` merge key. A package's Python cannot see another package's generated
statements, so the dedup has to move on-device.

Proposal — a small **Thingstudio-owned vendored library**, `ts_wifi.py` (`device-runtime/src/vendor/`, listed in
`runtime_manifest.py`'s `DEPENDENCIES`), imported by the package's `.node.py`:

```python
ts_wifi.ensure_station(ssid, password, security, defer_to_mqtt)
```

- Idempotent via module-level state (the on-device replacement for the `wifi-sta` compile-time key), so two
  network packages at import bring the interface up once.
- Same three behaviours as `wifiSetupStatement()`; the ESP32 first-join and the "managed by mqtt_as" comment carry
  over.
- A flow dependency, not a runtime API: installed into `/lib` by DEPLOY like `bme280_float`, so **no
  `_RUNTIME_VERSION` change** (any runtime that supports flow dependencies can run it). It is also importable by
  a user's custom package, which is the plugin rule applied.
- Licence ledger line for it (Thingstudio's own, Apache-2.0) and its tests in the unit suite (`test_deps.py`-style
  loading, `ensure_station` behaviour against a fake `network` module).

**Accepted difference:** the built-in's WiFi checks (non-empty SSID unless `unmanaged`, non-empty password when
`security` is `password`) happen at **compile** time; in a package they happen in `ensure_station` at **import**
time, failing the deploy with a `ValueError` naming the field. This is the same class of accepted package-vs-built-in
difference as encoder's dropped bounds check (`decisions/node-authoring.md`, 2026-10-16). If Mike wants compile-time
parity, the alternative is a `wifiConfig`-specific field kind that validates during codegen — more surface, less
general.

## 4. `http-in` needs more: siblings and a shared server

`http-in` builds its route table by scanning **every** `http_in` in the flow (`findNodesOfType` plus each node's
properties), rejects duplicate `(method, path)` per port, and shares one server setup per port under
`http-server-<port>`. Two additions would be needed:

1. A **`nodesOfType` field kind**: inlines `[{"id": ..., "properties": {...}}, ...]` for the listed node types. Data
   only (node properties never contain secrets — config references are ids), so it stays within the
   data-equivalent rule. This is the first field kind that inlines another node's data, so it deserves its own
   review.
2. Per-port sharing without compile-time dedup: each instance derives the same full route list from the inlined
   sibling data and creates/fetches the server and each sibling's queue through
   `runtime.shared('http_server', port, signature, factory)` / `runtime.shared('http_queue', node_id, (), factory)`.
   The first instance to run creates the server and every queue; later instances get the same objects back
   (identical signature). Duplicate routes are then caught at setup time, not compile time.

That is real work and a new compiler-derived field kind, and no other node needs it. Recommendation: **flip the
other seven first**; treat `http-in` as its own follow-up once the model is proven.

## 5. Wired-ness warning (`ntp`)

`ntp`'s only use is a `ctx.warn` when its output is unwired. It is not required for a package to behave correctly;
recommend dropping the warning in the package flip (or, later, a `wired` bool field kind — `ntp` is the sole
non-GUI user, so it is not worth a facility on its own).

## 6. Fault handling

- Singleton WiFi resolution (`singletonConfigLiteral`) already fails loudly: zero configs → "needs a
  `thingstudio/config/wifi` config"; many → reopen-to-merge. Same messages the built-ins get.
- Presence query: throwing on a missing compiler facility is attributable and cannot silently change behaviour.
- `ensure_station` failures: `ValueError` at setup with the node/type in the message, so the console names the
  offending node, not a bare traceback.
- Route-table conflicts (`http-in`): raised at setup naming both node ids, mirroring the built-in's message.

## 7. Blast radius

- **Touched:** `interfaces/node-descriptor/{SPEC.md,custom-node.schema.json}` (two new field kinds),
  `custom-node.ts` (`PROPERTY_KINDS`, validator, `pyPropertiesLiteral`), tests, a new vendored library +
  `runtime_manifest.py` + `docs/third-party-licenses.md`, eight package flips.
- **Not touched:** wire protocol; runtime API; `CodegenContext` (it already has `findNodesOfType`); saved flow
  files (new fields are additive; old flows compile unchanged).
- **No runtime version bump** if `ts_wifi` stays a flow dependency.

## 8. Open questions for Mike

1. **`hasNode` field kind** — approve this data form for node presence? (Recommended.)
2. **`ts_wifi` vendored library** — approve a Thingstudio-owned flow dependency as the shared WiFi bring-up, with
   WiFi validation moving from compile time to setup time? Or insist on compile-time parity (a `wifiConfig` field
   kind), or accept per-package duplicated setup code instead of a library?
3. **`nodesOfType` field kind + `http-in` later** — approve deferring `http-in` to its own change after the other
   seven flip? (Recommended; it needs a second field kind with its own review.)
4. **`ntp`'s unwired warning** — drop it in the package flip, or add a `wired` field kind now? (Recommend drop.)

## 9. Proposed order (after approval)

1. `hasNode` field kind + SPEC/schema/conformance.
2. `ts_wifi` library + tests.
3. Flip `wifi-gate` (smallest, and the node whose absence from the package set was deliberate) then `mqtt-publish`,
   `mqtt-subscribe`, `http-request`, `udp-send`, `udp-receive`, `ntp`.
4. `http-in` separately (field kind 2, runtime.shared server/queue).
