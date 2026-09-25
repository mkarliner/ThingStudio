// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/mqtt-shared.ts
//
// Shared between mqtt-publish.ts and mqtt-subscribe.ts: broker/client
// config validation, the client-construction setup statement, and the
// "make sure we're connected" snippet both node types need before doing
// anything else. Factored out (rather than duplicated per node type, or
// left to mergeSetup's ordinary dedup) for a real correctness reason, not
// just to avoid repetition: mergeSetup's dedup is "first writer under this
// key wins, later writers under the same key are silently dropped, no
// consistency check" (compile.ts's mergeSetup). If mqtt-publish.ts and
// mqtt-subscribe.ts independently generated their OWN setup code for the
// same broker, and a flow happened to compile the publish node before the
// subscribe node, the publish node's version would win -- and if it
// hadn't been written to also enable the client's event/queue interface
// (`queue_len > 0`), the subscribe node sharing that same client would
// silently get no queue at all, a real functional break, not just
// suboptimal codegen. Both node types calling this same function with the
// same config always produces byte-identical setup code regardless of
// which one compiles first, so which one "wins" the dedup race is a
// non-issue by construction rather than a documented gap to live with.
//
// mqtt_publish/mqtt_subscribe manage their OWN WiFi connection via
// mqtt_as's `connect()` (which internally calls `wifi_connect()` using the
// `ssid`/`wifi_pw` in the client's own config) rather than sharing
// wifi-status.ts's "wifi-sta" setup key. Deliberate, not an oversight:
// mqtt_as's `_keep_connected()` gives real outage recovery (the entire
// reason it was vendored over `umqtt.simple` -- see
// device-runtime/src/vendor/mqtt_as/README.md), and forcing it to share a
// plain `network.WLAN.connect()`-once statement with wifi_status.ts would
// throw that away. This does mean `ssid`/`password` may end up configured
// twice in a flow that also has a wifi_status node -- an accepted v1
// duplication, not a conflict: `network.WLAN(network.STA_IF)` returns a
// fresh Python wrapper object on each call, but every wrapper proxies to
// the same one physical station interface, so wifi_status's own handle
// still reports accurate `isconnected()`/`ifconfig()` state regardless of
// which code path actually brought the link up.
//
// Possible future enhancement, not built: the vendored mqtt_as hardcodes
// `network.WLAN(network.STA_IF)` inside its own `MQTT_base.__init__` --
// unlike wifi-status.ts/http-request.ts's interface choice (also
// hardcoded today, but only on our side), this one lives in third-party
// code we don't control. The most likely real case wanting a different
// interface is a board with WiFi plus a wired Ethernet add-on (e.g. a
// WIZnet W5500 over SPI) that wants MQTT traffic over Ethernet instead of
// WiFi. Doing that would need a fork/patch of the vendored file (or
// upstream support for it), not just a config change here -- a real
// enough lift that it's worth confirming there's an actual board/use case
// before starting, not speculatively built now.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// **behavior change, 2026-08-21** -- `parseMqttBrokerProps` no longer reads
// raw `ssid`/`password` node properties directly. Credentials came from a
// referenced `thingstudio/config/wifi` config node, via
// `properties.wifiConfigId` + `ctx.resolveConfig()`, through
// wifi-status.ts's `resolveWifiCredentials()` -- the same shared lookup
// udp-send.ts/udp-receive.ts used, so mqtt_publish/mqtt_subscribe closed
// the exact gap `outstanding-items.md`'s "Network / config nodes" section
// named ("http_request/mqtt_publish/mqtt_subscribe never got the
// config-node treatment"). `http_request` was NOT migrated by this
// change -- an explicitly flagged, separate follow-up at the time (see
// that file's own header).
//
// **Superseded, 2026-09-04** -- see wifi-status.ts's header for the full
// story: this node no longer has a `wifiConfigId` property of its own at
// all. `parseMqttBrokerProps` now calls `resolveFlowWifiCredentials()`
// (wifi-status.ts) instead of `resolveWifiCredentials()` directly, which
// derives credentials from the flow's own `wifi_status` node rather than
// from this node's own (now-removed) config reference -- fixing a real
// bug where two network nodes in one flow could independently reference
// two different, disagreeing WiFi configs. `http_request` got the same
// treatment the same day, closing that follow-up too (see that file's
// header).
//
// **One real divergence from udp-send.ts/udp-receive.ts's own treatment,
// not a smaller version of the same migration:** a config whose `security`
// is `"unmanaged"` is a CompileError here, not a supported state.
// wifiSetupStatement() (wifi-status.ts) can skip its `.connect()` call
// entirely for "unmanaged" because it's just bringing an interface up --
// but mqtt_as has no equivalent "don't manage WiFi" mode; per this file's
// own header above, it always drives its own connect/reconnect loop
// through the ssid/wifi_pw baked into its config dict, and always has,
// even before config nodes existed (`parseMqttBrokerProps` already
// required a non-empty ssid). Accepting "unmanaged" here would mean
// silently handing mqtt_as an empty ssid, and per Problem 2's "barf on
// undefined network details" precedent (`redeploy-cleanup-and-network-
// fault-detection-briefing.md`), a loud rejection is the right behavior,
// not a quiet best-effort attempt. Same reasoning now also applied to an
// empty password on a `"password"`-security config -- wifiSetupStatement()
// already rejects that combination for wifi_status/udp_send/udp_receive;
// parseMqttBrokerProps didn't check it before (there was no `security`
// field to check against until config nodes existed), so this closes a
// real, previously-unchecked gap, not just extending an existing one.
//
// Broker config (Mike's own follow-up request, same day): `broker`/`port`
// -- plus, newly, broker-level `username`/`password` auth -- also moved
// out of each node's own properties into a second referenced config,
// `thingstudio/config/mqtt-broker` (config-types.ts), via
// `properties.brokerConfigId`. Same motivation as the WiFi migration
// above: two mqtt_publish/mqtt_subscribe nodes pointed at the same broker
// no longer duplicate broker host/port (or, now, broker credentials)
// across node instances. `resolveMqttBrokerConfig()` below is the
// counterpart to wifi-status.ts's `resolveWifiCredentials()` -- a second,
// independent config reference resolved on the same node, since a node's
// WiFi network and its MQTT broker are genuinely two different things
// with two different credential pairs: the referenced WiFi config's own
// `ssid`/`password` authenticate to the WiFi network (`mqtt_as`'s
// `ssid`/`wifi_pw` config keys); the broker config's `username`/
// `password` authenticate to the broker itself (`mqtt_as`'s `user`/
// `password` config keys) -- unrelated credentials that happen to share
// the English word "password." `brokerConfigId` is mandatory, no
// optional/implicit fallback at all (unlike `wifiConfigId`, which has
// "unmanaged" as its explicit opt-out) -- there's no sensible default
// broker to silently fall back to the way an already-connected WiFi
// interface is a sensible "ride on it" fallback, so this is mandatory
// from day one rather than shipped optional and reversed later the way
// `wifiConfigId` was (`redeploy-cleanup-and-network-fault-detection-
// briefing.md`, Problem 2b).
//
// WiFi-reconnect race fix, 2026-08-21, on Thingstudio's own side rather
// than as a patch to the vendored mqtt_as: real-hardware testing
// (`mqtttest.flow.json`, a pure mqtt_publish/mqtt_subscribe flow sharing
// one wifiConfigId/brokerConfigId -- so NOT the wifi_status-vs-mqtt_as
// cross-node race this file's header above already accepts as a known
// duplication) hit `E (...) wifi:sta is connecting, cannot set config`.
// Root cause, confirmed by reading the vendored source directly: mqtt_as's
// own `wifi_connect()` (ESP32 branch) does `s.active(True)` then
// unconditionally `s.connect(self._ssid, self._wifi_pw)`, with no check
// for a connect already in progress. `s.active(True)` alone can trigger
// ESP-IDF's own NVS-cached auto-reconnect from a previous deploy's saved
// station config; if that's still resolving when the very next line fires
// its own connect, ESP-IDF refuses the second connect's config-set.
//
// A local patch to the vendored file (adding the missing guard, mirroring
// the ESP8266 branch's own existing `isconnected()` check a few lines
// above) was drafted and briefly applied, then deliberately reverted --
// this exact class of fix has already been raised against this library
// more than once (peterhinch/micropython-mqtt#59, #61, and discussed in
// #57) without landing upstream, and Mike's own call, after reviewing
// that history, was not to carry a diverging local patch against the
// maintainer's evident preference. `mqttWifiPrecheckStatement()` below is
// the fix instead, entirely on this side: a module-scope statement,
// included in every mqtt_publish/mqtt_subscribe node's own `statements`
// (deduped to one occurrence per flow, this file's own header re: mergeSetup),
// that WAITS OUT (never cancels) any in-flight connect on the station
// interface, bounded, before the event loop starts and before mqtt_as's
// own async `.connect()` ever gets a chance to run. Waiting rather than
// cancelling is what keeps this safe for a flow that also has
// wifi_status/http_request/udp_send/udp_receive (which issue their own
// real `.connect()` call in their own module-scope setup, above) --
// cancelling would risk tearing down another node's legitimate,
// currently-resolving connect attempt; waiting can only ever let
// something that was already going to finish, finish, before mqtt_as's
// own connect call runs. See `decisions.md` (2026-08-21) for the full
// reasoning and the ruled-out alternatives.
//
// **CONFIRMED BROKEN, 2026-09-04 -- superseded by the fix below.** The
// module-scope-statement design above assumed wifi_status's own connect
// (also module-scope, wifi-status.ts) would always have already run by
// the time this precheck's statement executed -- but `compile.ts` collects
// module-scope statements in plain node-array order, not any real phase
// system, so which one lands first in the compiled output is an accident
// of how a flow happens to list its nodes. `basic-mqtt.flow.json` lists
// its mqtt nodes before its wifi_status node, so this precheck ran BEFORE
// wifi_status's connect ever fired -- checking for an in-flight connect
// that hadn't started yet, then passing straight through, then colliding
// moments later exactly the way this was supposed to prevent. Confirmed
// on real hardware with both invalid and valid credentials (see
// outstanding-items/wifi-status-mqtt-connect-ordering-race.md) --
// `basic-mqtt.flow.json` did not deploy successfully at all. Fixed by
// moving this wait out of module scope entirely and into
// `mqttEnsureConnectedSnippet()` below, immediately before the actual
// `client.connect()` call it exists to protect -- see that function's own
// header for why that placement is correct regardless of node order (ALL
// module-scope code, from every node type, has already run by the time
// any coroutine executes, so there's no "which statement comes first"
// question left to get wrong). `mqttWifiPrecheckStatement()` and its
// setup-statement key are removed; nothing in `mqtt-publish.ts`/
// `mqtt-subscribe.ts` contributes this to `statements` any more.
//
// Loud network errors added, 2026-09-05 (redeploy-cleanup-and-network-
// fault-detection-briefing.md's Problem 2a, same pattern udp-send.ts/
// udp-receive.ts already had -- flagged as a judgment call for
// http_request/mqtt at the time, never done until now). The final,
// re-raised OSError out of mqttEnsureConnectedSnippet()'s bounded
// connect-retry loop below now folds this broker's own host:port into
// the message; mqtt-publish.ts's `.publish()` call and mqtt-subscribe.ts's
// `.subscribe()` call get the same treatment at their own call sites
// (not here -- unlike connect, those two calls happen inside each node's
// own file, not this shared one).
//
// MQTTS/TLS explicitly deferred, not built, not even a reserved field:
// the vendored mqtt_as's own `config` dict already has `ssl`/`ssl_params`
// keys (device-runtime/src/vendor/mqtt_as/__init__.py) this file doesn't
// touch. Checked against CLAUDE.md's "don't paint into an architectural
// dead end" principle before deferring outright, not skipped by default:
// a config's `properties` is a plain JSON blob (config-types.ts), and
// `ConfigTypeDescriptor.fields` is just what the property panel currently
// renders for it -- adding a `tls`/`ssl` field to
// `thingstudio/config/mqtt-broker` later needs no migration of
// already-saved flow files (an old config simply won't have the key, and
// new code can default it), unlike a one-way-door case such as `HELLO`'s
// reserved `authRequired`/`authScheme` fields. So there's nothing to
// reserve now -- this is the plain cheap-by-default case, not an
// exception to it. `outstanding-items.md`, `decisions.md`.

import { CompileError } from "../compiler/errors.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";
import { resolveFlowWifiCredentials } from "./wifi-status.js";

export interface MqttBrokerConfig {
  broker: string;
  port: number;
  ssid: string;
  wifiPassword: string;
  username: string;
  password: string;
}

function sanitizeIdent(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

function idSuffix(cfg: MqttBrokerConfig): string {
  return `${sanitizeIdent(cfg.broker)}_${cfg.port}`;
}

export function mqttClientVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_client_${idSuffix(cfg)}`;
}

function mqttConnectedVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_connected_${idSuffix(cfg)}`;
}

function mqttLockVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_lock_${idSuffix(cfg)}`;
}

// Per-CALLING-NODE, not per-broker -- unlike connectedVar/lockVar above,
// this tracks what THIS node has last told the editor, since two nodes
// sharing one broker client (mqtt_publish + mqtt_subscribe, or two of
// either) still each want their own accurate canvas dot (nodes.ts's
// `status` field is per-node-instance). `nodeId` is already flow-wide
// unique, so no broker suffix is needed the way the shared vars above
// need one.
function mqttLastStateVar(nodeId: string): string {
  return `_mqtt_last_state_${sanitizeIdent(nodeId)}`;
}

export function mqttSetupKey(cfg: MqttBrokerConfig): string {
  return `mqtt-client-${cfg.broker}-${cfg.port}`;
}

/** Per-node module-scope statement (connection-status-indicator feature,
 * 2026-09-10) -- keyed by the calling node's own id, so it's never
 * deduped away by mergeSetup even when several nodes share one broker's
 * `mqttSetupStatement()` (broker-keyed, deduped on purpose, this file's
 * own header). Initialized to `None`, not `False`: `mqttEnsureConnectedSnippet()`
 * below diffs against this on every call, and `None` deliberately never
 * equals real `True`/`False`, so the very first call always reports
 * whatever the real current state is, positive or negative -- matching
 * wifi-status.ts's own "always report on the first poll" convention. */
export function mqttNodeStatusSetupStatement(nodeId: string): { key: string; code: string } {
  return { key: `mqtt-status-${nodeId}`, code: `${mqttLastStateVar(nodeId)} = None` };
}

/** Resolves `properties.brokerConfigId` via `ctx.resolveConfig()` -- a
 * referenced `thingstudio/config/mqtt-broker` config's own `broker`/
 * `port`/`username`/`password` (config-types.ts). `context` is prefixed
 * onto error messages, same convention `resolveWifiCredentials()` uses.
 * Mandatory -- see this file's header for why there's no optional/
 * implicit-fallback state the way `wifiConfigId`'s "unmanaged" is one.
 * `username`/`password` are NOT validated for non-emptiness -- unlike the
 * WiFi config's password, an empty broker username/password is a normal,
 * common "no broker auth" setup, not a likely-forgotten-credential case
 * worth a loud CompileError over. */
function resolveMqttBrokerConfig(
  properties: Record<string, unknown>,
  ctx: CodegenContext,
  context: string,
): { broker: string; port: number; username: string; password: string } {
  const configId = properties.brokerConfigId;
  if (configId === undefined || configId === null || configId === "") {
    throw new CompileError(`${context} requires an MQTT broker config (properties.brokerConfigId) -- reference one, or create a new one from the property panel`);
  }
  const resolved = ctx.resolveConfig(String(configId));
  const broker = typeof resolved.broker === "string" ? resolved.broker.trim() : "";
  if (!broker) {
    throw new CompileError(`${context}'s referenced broker config has no "broker" hostname/IP set`);
  }
  const port = Math.round(Number(resolved.port ?? 1883));
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new CompileError(`${context}'s referenced broker config has an invalid port "${String(resolved.port)}" -- must be a valid port number (1-65535)`);
  }
  const username = typeof resolved.username === "string" ? resolved.username : "";
  const password = typeof resolved.password === "string" ? resolved.password : "";
  return { broker, port, username, password };
}

/** `context` is prefixed onto error messages (e.g. "mqtt_publish", so a
 * caller's CompileError says which node type actually rejected it).
 * `ctx` resolves both `properties.brokerConfigId` (this file's own
 * `resolveMqttBrokerConfig()`, above) and `properties.wifiConfigId`
 * (`resolveWifiCredentials()`, wifi-status.ts) -- see this file's header
 * for why these are two independent config references on the same node,
 * and for why "unmanaged" WiFi security is rejected here even though it's
 * a supported state for wifi_status/udp_send/udp_receive. */
export function parseMqttBrokerProps(properties: Record<string, unknown>, ctx: CodegenContext, context: string): MqttBrokerConfig {
  const { broker, port, username, password } = resolveMqttBrokerConfig(properties, ctx, context);

  // 2026-09-04: derives from the flow's own wifi_status node
  // (resolveFlowWifiCredentials, wifi-status.ts) rather than this node's
  // own wifiConfigId property -- see that file's header for the bug this
  // fixes (two network nodes silently able to disagree about which WiFi
  // config is active for the one physical radio they share).
  const resolved = resolveFlowWifiCredentials(ctx, context);
  if (resolved.security === "unmanaged") {
    throw new CompileError(
      `${context}'s WiFi config has security "unmanaged", which isn't supported here -- mqtt_as manages its own WiFi connection and needs real credentials to do so, unlike wifi_status/udp_send/udp_receive, which can ride on an externally-managed connection. Reference a config with a real ssid/password instead.`,
    );
  }
  const ssid = typeof resolved.ssid === "string" ? resolved.ssid.trim() : "";
  if (!ssid) {
    // Deliberately required rather than optional-with-fallback (contrast
    // wifi-status.ts/http-request.ts, where an empty ssid just skips the
    // connect call and assumes something else brings the link up) -- see
    // this file's header on why mqtt_as owns its own WiFi lifecycle
    // rather than assuming a connection already exists.
    throw new CompileError(`${context} requires "ssid" -- mqtt_as manages its own WiFi connection and needs credentials to do so`);
  }
  const wifiPassword = typeof resolved.password === "string" ? resolved.password : "";
  if (resolved.security === "password" && !wifiPassword) {
    throw new CompileError(
      `${context}'s WiFi config for ssid "${ssid}" has no password but security is "password" -- set a password, or choose "open" if this network intentionally has none`,
    );
  }
  return { broker, port, ssid, wifiPassword, username, password };
}

/** Module-scope statement that constructs the shared MQTTClient for this
 * broker. `queue_len` is always set to a fixed positive value regardless
 * of whether the calling node is mqtt_publish or mqtt_subscribe -- see
 * this file's header for why that's what makes the dedup-sharing safe. */
export function mqttSetupStatement(cfg: MqttBrokerConfig): { key: string; code: string } {
  const clientVar = mqttClientVar(cfg);
  const lines = [
    `${clientVar}_cfg = dict(mqtt_as.config)`,
    `${clientVar}_cfg['server'] = ${pyStringLiteral(cfg.broker)}`,
    `${clientVar}_cfg['port'] = ${cfg.port}`,
    `${clientVar}_cfg['ssid'] = ${pyStringLiteral(cfg.ssid)}`,
    `${clientVar}_cfg['wifi_pw'] = ${pyStringLiteral(cfg.wifiPassword)}`,
    // Broker-level auth -- mqtt_as's own `user`/`password` config keys,
    // distinct from the `ssid`/`wifi_pw` pair just above (this file's
    // header). Always set, even when empty, matching this function's own
    // existing convention for ssid/wifi_pw -- no conditional skip, so
    // generated code never silently inherits `mqtt_as.config`'s own `""`
    // defaults in a way that would look identical to an intentional
    // empty value.
    `${clientVar}_cfg['user'] = ${pyStringLiteral(cfg.username)}`,
    `${clientVar}_cfg['password'] = ${pyStringLiteral(cfg.password)}`,
    // Fixed, not configurable -- the queue is only ever read by
    // mqtt_subscribe nodes (mqtt-subscribe.ts), a publish-only flow just
    // never drains it, which is harmless (MsgQueue discards oldest on
    // overflow, per the vendored mqtt_as's own MsgQueue.put()).
    `${clientVar}_cfg['queue_len'] = 20`,
    `${clientVar} = mqtt_as.MQTTClient(${clientVar}_cfg)`,
    `${mqttConnectedVar(cfg)} = False`,
    // NOT `asyncio.Lock()` here -- this statement runs at plain module
    // scope, before any event loop is actually running (compile.ts emits
    // every setup statement ahead of the coroutines/`runtime.spawn` calls
    // that eventually run under one). Constructing a Lock with no loop
    // running yet is a real, confirmed hazard on CPython 3.9 (what macOS's
    // Xcode Command Line Tools ships): `asyncio.Lock.__init__` binds
    // itself to "the current event loop" at construction time via the
    // legacy `get_event_loop()` auto-create fallback, then `asyncio.run()`
    // -- used by every off-device test in this repo, and this file's own
    // header's "byte-identical setup code" invariant makes no promise
    // about what actually drives the coroutines -- creates a SECOND,
    // different loop to run everything, leaving the lock permanently
    // bound to a stale one. Awaiting it later raises "Task ... got Future
    // attached to a different loop." (Confirmed 2026-09-02, real hardware
    // test session, `node-mqtt-publish.test.ts`'s own "two chains racing
    // to connect" test.) `None` here plus the lazy construction in
    // `mqttEnsureConnectedSnippet()` below defers actually calling
    // `asyncio.Lock()` until it's first needed, inside a real running
    // coroutine -- safe on every Python version, and a no-op change for
    // the real target (MicroPython's `uasyncio.Lock` doesn't bind to a
    // loop at construction at all, so it was never exposed to this on
    // real hardware in the first place).
    `${mqttLockVar(cfg)} = None`,
  ];
  return { key: mqttSetupKey(cfg), code: lines.join("\n") };
}

/** The WiFi-reconnect-race wait, inlined into `mqttEnsureConnectedSnippet()`
 * below rather than emitted as its own module-scope statement -- see this
 * file's "CONFIRMED BROKEN, 2026-09-04" header note above for why the old
 * module-scope-statement design didn't actually work (its position in the
 * compiled output depended on arbitrary node-array order, so it could run
 * before wifi_status's own connect ever fired, protecting nothing). NOT
 * indented; caller embeds this inside `mqttEnsureConnectedSnippet()`'s own
 * async function body, so `await` is always legal here. Deliberately
 * gated to ESP32 (`sys.platform == "esp32"`) -- see this function's
 * pre-2026-09-04 history in git blame / decisions.md (2026-08-21,
 * 2026-09-02) for why: the underlying race is an ESP-IDF behavior
 * specifically, and `network.STAT_CONNECTING` isn't confirmed present on
 * every MicroPython port this project targets. `.active(True)` itself is
 * harmless/idempotent on every platform, so that line always runs; only
 * the wait loop is ESP32-only. Uses `await asyncio.sleep_ms()`, not
 * `time.sleep_ms()` -- this runs inside a coroutine now (it didn't when
 * this was module-scope code with no event loop running yet), so a
 * blocking sleep here would stall every other coroutine in the flow for
 * up to ~10s while this waits. */
function mqttWifiPrecheckSnippet(cfg: MqttBrokerConfig): string {
  // 2026-09-25 (experiment, Mike's call): on ESP32 this now JOINS WiFi itself, then hands over to mqtt_as,
  // whose vendored wifi_connect() carries a local patch returning early when already connected
  // (device-runtime/src/vendor/mqtt_as/README.md). Before, mqtt_as always issued its own connect(), which
  // ESP-IDF refuses while its auto-reconnect is in flight; waiting and retrying round that from outside
  // ended with the WiFi driver wedged. If this join doesn't finish in ~15 s, mqtt_as's own connect runs as
  // before, so nothing is worse than without it. mqtt_as still owns reconnecting after an outage.
  return [
    "_mqtt_wifi_precheck_sta = network.WLAN(network.STA_IF)",
    "_mqtt_wifi_precheck_sta.active(True)",
    'if sys.platform == "esp32" and not _mqtt_wifi_precheck_sta.isconnected():',
    "    for _ in range(50):  # bounded ~5s: let an in-flight connect (ESP-IDF's own auto-reconnect) finish",
    "        if _mqtt_wifi_precheck_sta.isconnected() or _mqtt_wifi_precheck_sta.status() != network.STAT_CONNECTING:",
    "            break",
    "        await asyncio.sleep_ms(100)",
    "    if not _mqtt_wifi_precheck_sta.isconnected():",
    "        try:",
    `            _mqtt_wifi_precheck_sta.connect(${pyStringLiteral(cfg.ssid)}, ${pyStringLiteral(cfg.wifiPassword)})`,
    "        except OSError:",
    "            pass  # already connecting -- the wait below covers it",
    "        for _ in range(150):  # bounded ~15s for the join",
    "            if _mqtt_wifi_precheck_sta.isconnected():",
    "                break",
    "            await asyncio.sleep_ms(100)",
  ].join("\n");
}

/** NOT indented; caller embeds this at the top of an async function body
 * (mqtt-publish.ts's sink functionBody, or mqtt-subscribe.ts's buildMsg --
 * both already run inside an `async def`/coroutine, so `await` here is
 * always legal). Double-checked-locking: the fast path (already
 * connected) never touches the lock; only the first caller across
 * however many chains share this client actually awaits `.connect()`,
 * everyone else just observes `_mqtt_connected_*` flip to True.
 *
 * The `lockVar is None` check, 2026-09-02: the lock itself is now
 * constructed HERE, lazily, on first real use inside a running coroutine,
 * not eagerly in `mqttSetupStatement()`'s module-scope code (that
 * function's own comment has the full "attached to a different loop"
 * story this fixes). Safe with no extra locking of its own: this whole
 * check-then-create is synchronous, no `await` in between, so asyncio's
 * cooperative single-threaded scheduling can't interleave another
 * coroutine's identical check in the middle of it -- the same guarantee
 * the surrounding double-checked-locking on `${connectedVar}` already
 * relies on.
 *
 * Bounded retry, 2026-09-02: real-hardware testing of the WiFi-reconnect
 * precheck's own settle-wait fix (this file, same day; the precheck was
 * module-scope at the time, later moved inline here 2026-09-04 -- see this
 * file's header) showed it narrows but doesn't eliminate the cold-boot
 * `OSError: Wifi Internal State Error` -- the FIRST deploy after a power
 * cycle still hit it once, and a second deploy (no power cycle) then
 * succeeded immediately. That's exactly the shape of a transient
 * ESP-IDF driver-not-fully-settled condition, not a real/persistent
 * connect failure (wrong password, broker unreachable) -- those fail the
 * same way on every attempt, not just the first. Rather than chase an
 * exact settle delay that apparently still isn't long enough on Mike's
 * board, `.connect()` itself now gets up to 3 attempts with a fixed
 * pause between them, inside the same lock (so racing chains still only
 * ever see one connect attempt in flight at a time, unchanged from
 * before). A genuinely persistent failure still surfaces as a NODE_ERROR
 * -- the final attempt's exception is re-raised, not swallowed -- so this
 * is strictly a "smooth over a known-transient cold-boot glitch," not a
 * silent-failure risk. Unverified beyond one manual repro; revisit the
 * attempt count/delay if this still isn't enough. */
export function mqttEnsureConnectedSnippet(cfg: MqttBrokerConfig, nodeId: string): string {
  const clientVar = mqttClientVar(cfg);
  const connectedVar = mqttConnectedVar(cfg);
  const lockVar = mqttLockVar(cfg);
  const attemptVar = `_mqtt_connect_attempt_${idSuffix(cfg)}`;
  const errsVar = `_mqtt_connect_errs_${idSuffix(cfg)}`;
  const lastStateVar = mqttLastStateVar(nodeId);
  const nowVar = `_mqtt_now_connected_${sanitizeIdent(nodeId)}`;
  // NODE_STATUS push, both directions (connection-status-indicator
  // feature, added 2026-09-10, corrected same day) -- keyed to the
  // CALLING node's own id (mqtt-publish.ts's/mqtt-subscribe.ts's own
  // `node.id`), not the shared broker config, even though this whole
  // snippet is broker-scoped and byte-identical text gets generated once
  // per calling node (this file's own header: "byte-identical...
  // regardless of which one compiles first"). A publish node and a
  // subscribe node sharing one broker are still two separate canvas
  // nodes that each want their own status badge (nodes.ts's `status`
  // field is per-node-instance) -- baking the caller's id into each
  // copy, JSON.stringify-quoted the same safe way inject.ts's own
  // `nodeIdStr` embedding already is, keeps that per-node attribution
  // correct regardless of how many other nodes share the same broker.
  //
  // First cut of this feature only reported 'connected' from inside the
  // connect-retry block below, which only ever runs for whichever node's
  // call happens to be the FIRST to observe `${connectedVar}` still False
  // (broker-keyed, shared by every node on that broker) -- every OTHER
  // node sharing that broker, the ones that always find it already
  // connected, never reported anything at all. Real bug, caught by Mike
  // on real hardware (outstanding-items/node-status-indicators.md,
  // 2026-09-10), not hypothetical. Fixed below, and Mike's separate ask
  // the same session ("all nodes with status should show the negative as
  // well as positive status") covered in the same fix rather than a
  // second pass: EVERY call to this snippet, whether it ran the connect
  // block or skipped it, now checks the client's own real `isconnected()`
  // and diffs it against `${lastStateVar}` (per-CALLING-node, not
  // per-broker -- `mqttLastStateVar()` above), reporting
  // 'connected'/'disconnected' only on an actual change -- same "don't
  // spam every routine call" reasoning wifi-status.ts's own
  // report_status placement documents, but keyed off ground truth rather
  // than "did I personally just run .connect()." `${connectedVar}` itself
  // is deliberately left untouched by this -- mqtt_as's own
  // `_keep_connected()` background task already owns real reconnection
  // (this file's header: "the entire reason it was vendored over
  // `umqtt.simple`"), so this stays purely an observer, never a driver of
  // reconnect behavior.
  const nodeIdLiteral = JSON.stringify(String(nodeId));
  // mqttWifiPrecheckSnippet() indented to this block's own 12-space level
  // (matching the `for ${attemptVar}...` line right after it) -- see this
  // file's header ("CONFIRMED BROKEN, 2026-09-04") for why this runs here,
  // inside the double-checked lock right before the actual connect
  // attempt, rather than as a module-scope statement.
  const precheckLines = mqttWifiPrecheckSnippet(cfg)
    .split("\n")
    .map((l) => `            ${l}`);
  return [
    `global ${connectedVar}, ${lockVar}, ${lastStateVar}`,
    `if not ${connectedVar}:`,
    `    if ${lockVar} is None:`,
    `        ${lockVar} = asyncio.Lock()`,
    `    async with ${lockVar}:`,
    `        if not ${connectedVar}:`,
    ...precheckLines,
    // Every attempt's error plus the station's status code (2026-09-25: mqtt_as's own "Wi-Fi connect timed
    // out" covers any failed join, and only the last attempt was reported -- the status code says whether it
    // was a wrong password, no access point, or ESP-IDF's own reconnect getting in the way).
    `            ${errsVar} = []`,
    `            for ${attemptVar} in range(3):`,
    `                try:`,
    `                    await ${clientVar}.connect()`,
    `                    ${connectedVar} = True`,
    `                    break`,
    `                except OSError as _e:`,
    `                    try:`,
    `                        _mqtt_st = _mqtt_wifi_precheck_sta.status()`,
    `                    except Exception:`,
    `                        _mqtt_st = "?"`,
    `                    ${errsVar}.append("%d: %r, wifi status %s" % (${attemptVar} + 1, _e, _mqtt_st))`,
    `                    if ${attemptVar} == 2:`,
    // Final attempt exhausted -- report 'error' before re-raising (the
    // raise still happens unconditionally right after; this is
    // ADDITIONAL user-facing signal, not a replacement for the real
    // NODE_ERROR the re-raise below produces via _guarded). Also sets
    // lastStateVar directly (rather than relying on the diff check below,
    // which this path never reaches -- raise leaves the function first),
    // so a later real reconnect still reports 'connected' when it happens.
    `                        ${lastStateVar} = False`,
    `                        runtime.report_status(${nodeIdLiteral}, 'error', "connect to %s:%s failed" % (${pyStringLiteral(cfg.broker)}, ${cfg.port}))`,
    `                        raise OSError("mqtt connect to %s:%s failed after 3 attempts (%s)" % (${pyStringLiteral(cfg.broker)}, ${cfg.port}, "; ".join(${errsVar})))`,
    // (A disconnect() here between attempts, tried earlier on 2026-09-25, was removed the same day: with
    // repeated attempts it left the ESP32-C3's WiFi driver unable to restart. The join now happens once,
    // in the precheck above.)
    `                    await asyncio.sleep_ms(1000)`,
    // Ground-truth diff, every call, whichever path above ran -- see this
    // function's own docblock above for the full story.
    `${nowVar} = bool(${clientVar}.isconnected())`,
    `if ${nowVar} != ${lastStateVar}:`,
    `    ${lastStateVar} = ${nowVar}`,
    `    runtime.report_status(${nodeIdLiteral}, 'connected' if ${nowVar} else 'disconnected')`,
  ].join("\n");
}

// payloadToBytesSnippet used to live here (mqtt_publish's outgoing-payload
// encoding). Moved to py-literals.ts 2026-08-18 when udp-send.ts needed
// the identical snippet -- see that file's doc comment for why. Re-exported
// from here too, so mqtt-publish.ts's existing import path keeps working
// without a churny cross-file rename.
export { payloadToBytesSnippet } from "./py-literals.js";
