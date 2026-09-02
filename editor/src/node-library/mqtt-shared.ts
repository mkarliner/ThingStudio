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
// raw `ssid`/`password` node properties directly. Credentials now come from
// a referenced `thingstudio/config/wifi` config node, via
// `properties.wifiConfigId` + `ctx.resolveConfig()`, resolved through
// wifi-status.ts's `resolveWifiCredentials()` -- the same shared lookup
// udp-send.ts/udp-receive.ts already use, so mqtt_publish/mqtt_subscribe
// close the exact gap `outstanding-items.md`'s "Network / config nodes"
// section named ("http_request/mqtt_publish/mqtt_subscribe never got the
// config-node treatment"). `http_request` is NOT migrated by this change --
// still reading raw ssid/password, an explicitly flagged, separate
// follow-up (see that file's own header).
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
import { resolveWifiCredentials } from "./wifi-status.js";

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

export function mqttSetupKey(cfg: MqttBrokerConfig): string {
  return `mqtt-client-${cfg.broker}-${cfg.port}`;
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

  const resolved = resolveWifiCredentials(properties, ctx, context);
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

/** Shared setup key for `mqttWifiPrecheckStatement()` below -- fixed
 * (not per-broker, unlike `mqttSetupKey()`) so every mqtt_publish/
 * mqtt_subscribe node in a flow contributes the identical statement and
 * `mergeSetup`'s dedup collapses them to exactly one occurrence,
 * regardless of how many distinct broker configs the flow has. */
export const MQTT_WIFI_PRECHECK_KEY = "mqtt-wifi-connect-precheck";

/** Module-scope statement (this file's header, "WiFi-reconnect race fix"):
 * waits out, bounded, any WiFi connect already in progress on the station
 * interface -- before mqtt_as's own `wifi_connect()` gets a chance to
 * issue its own connect call and collide with it. Deliberately gated to
 * ESP32 (`sys.platform == "esp32"`): the underlying race (ESP-IDF's own
 * NVS-cached auto-reconnect, triggered by `.active(True)` alone) is an
 * ESP-IDF behavior specifically, and `network.STAT_CONNECTING` isn't
 * confirmed present on every MicroPython port this project targets --
 * the vendored mqtt_as's own code only ever references that constant
 * inside its own `if ESP32:` branches, using plain numeric status
 * comparisons for RP2/PYBOARD instead (device-runtime/src/vendor/mqtt_as/
 * __init__.py), which reads as "not reliably available elsewhere," not
 * an oversight to copy past. `.active(True)` itself is harmless/idempotent
 * on every platform, so that line always runs; only the wait loop is
 * ESP32-only.
 *
 * Behavior change, 2026-09-02: extended with a settle wait after
 * `.active(True)`, distinct from the "wait out an in-flight connect"
 * check above it. First real-hardware run of this precheck (Mike's
 * `basic-mqtt.flow.json`, mqtt_subscribe's own automatic boot-time
 * connect -- no wifi_status node in that flow, no prior deploy, power-
 * cycled first) hit `OSError: Wifi Internal State Error` from mqtt_as's
 * `wifi_connect()` (`s.connect(self._ssid, self._wifi_pw)`) -- a
 * DIFFERENT ESP-IDF error than the `wifi:sta is connecting, cannot set
 * config` one this precheck originally targeted, and one the original
 * STAT_CONNECTING wait can't catch: on a genuinely fresh boot, `.status()`
 * right after `.active(True)` is idle, not connecting, so that loop
 * breaks on its very first check and adds no real delay at all. The
 * likely cause instead (a known, documented ESP32/MicroPython quirk, not
 * confirmed by reading ESP-IDF source directly the way the original race
 * was): `.active(True)` returning doesn't guarantee the WiFi driver has
 * actually finished coming up internally -- issuing `.connect()`
 * immediately afterward, before that finishes, can be rejected as a state
 * error even though nothing else is touching the interface. Fixed the
 * same way as the existing wait -- bounded, ESP32-gated, ride-don't-guess
 * -- by polling `.active()` until it actually reports `True` (rather than
 * trusting the call that requested it) plus a short fixed settle delay
 * before falling through to the pre-existing in-flight-connect check.
 * Unverified beyond this one manual repro; flag if it recurs or a
 * different board/firmware combination needs a longer settle window. */
export function mqttWifiPrecheckStatement(): { key: string; code: string } {
  const lines = [
    "_mqtt_wifi_precheck_sta = network.WLAN(network.STA_IF)",
    "_mqtt_wifi_precheck_sta.active(True)",
    'if sys.platform == "esp32":',
    "    for _ in range(50):  # bounded ~5s wait for .active(True) to actually take effect",
    "        if _mqtt_wifi_precheck_sta.active():",
    "            break",
    "        time.sleep_ms(100)",
    "    time.sleep_ms(200)  # brief settle delay -- see this function's 2026-09-02 header note",
    "    for _ in range(50):  # bounded ~5s wait for any in-flight connect to resolve",
    "        if _mqtt_wifi_precheck_sta.status() != network.STAT_CONNECTING:",
    "            break",
    "        time.sleep_ms(100)",
  ];
  return { key: MQTT_WIFI_PRECHECK_KEY, code: lines.join("\n") };
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
 * Bounded retry, 2026-09-02: real-hardware testing of
 * `mqttWifiPrecheckStatement()`'s own settle-wait fix (this file, same
 * day) showed it narrows but doesn't eliminate the cold-boot
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
export function mqttEnsureConnectedSnippet(cfg: MqttBrokerConfig): string {
  const clientVar = mqttClientVar(cfg);
  const connectedVar = mqttConnectedVar(cfg);
  const lockVar = mqttLockVar(cfg);
  const attemptVar = `_mqtt_connect_attempt_${idSuffix(cfg)}`;
  return [
    `global ${connectedVar}, ${lockVar}`,
    `if not ${connectedVar}:`,
    `    if ${lockVar} is None:`,
    `        ${lockVar} = asyncio.Lock()`,
    `    async with ${lockVar}:`,
    `        if not ${connectedVar}:`,
    `            for ${attemptVar} in range(3):`,
    `                try:`,
    `                    await ${clientVar}.connect()`,
    `                    ${connectedVar} = True`,
    `                    break`,
    `                except OSError:`,
    `                    if ${attemptVar} == 2:`,
    `                        raise`,
    `                    await asyncio.sleep_ms(500)`,
  ].join("\n");
}

// payloadToBytesSnippet used to live here (mqtt_publish's outgoing-payload
// encoding). Moved to py-literals.ts 2026-08-18 when udp-send.ts needed
// the identical snippet -- see that file's doc comment for why. Re-exported
// from here too, so mqtt-publish.ts's existing import path keeps working
// without a churny cross-file rename.
export { payloadToBytesSnippet } from "./py-literals.js";
