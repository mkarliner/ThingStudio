// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/wifi-status.ts
//
// Tier 1 network batch (mvp-feature-priorities.md item 4). Polling source,
// same mechanism as gpio-in.ts -- network.WLAN(STA_IF).isconnected() is a
// cheap, non-blocking status read (the radio-level connect/disconnect
// happens in the background; this just reads current state), so no async
// call is needed here despite this being a "network" node -- unlike
// http_request.ts/mqtt-publish.ts, which genuinely need to await I/O.
//
// Doubles as the flow's WiFi-connect step when a WiFi config is referenced,
// since design doc §6 names "WiFi status" as one v1 node, not "WiFi
// status" plus a separate "WiFi connect" -- something in a flow has to
// bring the station interface up if http_request is going to work. The
// setup statement is shared (key "wifi-sta") with http_request via the
// normal mergeSetup dedup -- first node's code wins, same mechanism
// gpio_in/gpio_out already rely on for shared pin claims. If a flow has an
// http_request node but no wifi_status node, http_request brings the
// interface up itself (see its own codegen) using the same "wifi-sta"
// key, so exactly one of them ends up owning the actual connect call
// regardless of which type is present.
//
// mqtt_publish/mqtt_subscribe deliberately do NOT share this key -- see
// mqtt-shared.ts's header for why they manage WiFi through mqtt_as's own
// connect()/reconnect logic instead of this module's plain
// network.WLAN.connect(), and the two mechanisms' relationship (both
// legitimately query/drive the same one physical interface through
// different Python object handles -- see mqtt-shared.ts for the detail).
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// **behavior change, 2026-08-18** -- this node (and http-request.ts/
// udp-send.ts/udp-receive.ts, which share wifiSetupStatement()) no longer
// reads raw `ssid`/`password` properties directly off the node. Credentials
// now come from a referenced `thingstudio/config/wifi` config node, via
// `node.properties.wifiConfigId` + `ctx.resolveConfig()` -- resolveWifiCredentials()
// below is the one place that lookup happens, shared by every node type
// that needs it, so udp-send.ts/udp-receive.ts don't each reimplement it
// (http-request.ts is NOT one of these -- see its own header, still
// reading raw ssid/password directly, an explicitly-flagged unmigrated
// follow-up, not an oversight). This is Mike's own explicit mandate
// (config-node-and-palette-implementation-briefing.md: "Entering ssid
// credentials multiple times is not acceptable even for an mvp") -- the
// whole point is that typing a password into more than one node's
// property panel is no longer possible for the node types that need it.
//
// **Reversed 2026-08-20** (redeploy-cleanup-and-network-fault-detection-
// briefing.md, Problem 2b, Option B -- Mike's own explicit call, made with
// the reversal flagged plainly): `wifiConfigId` is no longer optional for
// this node/udp-send.ts/udp-receive.ts. The previous behavior --
// omitting it silently brought the interface up with no connect call,
// riding on whatever the device happened to already be connected to --
// is exactly what let `wifi_status` report `payload=True` from a
// connection this flow never declared (ESP-IDF's NVS-cached station
// config reconnecting on `.active(True)` alone), which is the silently-
// ambiguous behavior CLAUDE.md's fault-handling priority argues against.
// resolveWifiCredentials() below now throws a CompileError when
// `wifiConfigId` is missing/empty, instead of returning
// `{ssid: undefined, password: undefined}`. The one legitimate real-world
// case for "ride on an existing connection" -- a device that provisions
// its own WiFi outside of any deployed flow (Tasmota-style captive-
// portal/soft-AP fallback, raised by Mike 2026-08-20, not built or
// scoped yet -- see outstanding-items.md) -- still has a path: reference
// a `thingstudio/config/wifi` config whose `security` is `"unmanaged"`
// (config-types.ts). That's a flow author's own explicit, labeled choice
// now, not a silent omission -- the whole point of this reversal.
//
// Possible future enhancement, not built: every network node in this
// batch (this one, http-request.ts, and -- more deeply, see
// mqtt-shared.ts -- the MQTT nodes) hardcodes exactly one interface,
// network.WLAN(network.STA_IF), with no per-node way to pick a different
// one. Fine for every board in design doc §3 today (one WiFi radio each,
// no Ethernet in scope), but the most likely real case that would need
// it is a board with both WiFi and a wired Ethernet add-on (e.g. a
// WIZnet W5500 over SPI) wanting network traffic over Ethernet instead
// of/alongside WiFi. Adding that would mean an "interface" property on
// each network node, keying the shared setup statement by interface
// instead of the fixed "wifi-sta" string, and -- the harder part --
// working around mqtt_as's own internal STA_IF hardcoding for the MQTT
// nodes specifically (see mqtt-shared.ts). Not scoped or started.
//
// Known gap, not silently assumed away: if two network nodes in one flow
// reference *different* wifi config nodes, mergeSetup's dedup keeps
// whichever node's code was generated first and silently drops the rest
// -- the same documented limitation node-definition-model.md already
// flags for pin claims ("no resource-conflict checking"), not a new one.
// The config-node mechanism fixes the common case (every node sharing ONE
// config, so there's nothing to disagree about) but doesn't add real
// multi-config conflict detection on top.
//
// **Behavior change, 2026-09-02** (Mike's ask -- outstanding-items/
// wifi-status-emit-on-change.md): this node used to emit a message every
// single poll, connected or not, changed or not -- a flow with a 1s
// pollMs feeding `debug` produced a line a second forever. Now emits only
// when `(connected, ip)` actually changes since the last poll (codegen
// below tracks this per-instance, `compile.ts`'s source-loop assembly
// skips the downstream chain -- not the mandatory sleep/yield -- when
// `buildMsg` sets `msg = None`). The very first poll always reports,
// matching the old behavior for that one case.

//
// **Behavior change, 2026-09-09** (Mike's ask -- outstanding-items/
// wifi-status-completeness.md): the emitted envelope now carries the
// rest of `ifconfig()`'s 4-tuple (`subnet`/`gateway`/`dns`, alongside the
// existing `ip`) plus `rssi`. `subnet`/`gateway`/`dns` are treated as
// network-identity fields, same category as `ip` -- folded into the
// change-detection tuple below, so a change to any of them (not just
// `ip`) re-triggers emission, same reasoning the 2026-09-02 IP-change
// case above already established.
//
// `rssi` is deliberately NOT part of that tuple. It's continuous
// telemetry, not connection-identity state -- signal strength drifts by
// a dBm or two constantly even on an otherwise-idle, still-connected
// link, and folding it into the equality check would silently undo the
// whole point of 2026-09-02's emit-on-change change (a flow polling
// every second would go back to emitting every second). So `rssi` is
// computed fresh on every poll and included whenever a message DOES fire
// for another reason, but its own fluctuation never causes one. That
// means the RSSI value in an emitted message is a snapshot as of the
// last actual connection-state change, not a live reading -- genuinely
// live RSSI streaming is Tier 2 live-value-streaming territory
// (tier2-live-streaming-persistence.md), not this node's job.
//
// `rssi`'s read itself (`_wifi_sta.status('rssi')`) is wrapped in
// `except (OSError, AttributeError)` -- it's an ESP-IDF-specific status
// key, not a portable MicroPython API across every port/board (RP2040's
// cyw43 driver, for one, doesn't support it). Per CLAUDE.md's whack-
// a-mole/board-idiosyncrasy corollary: this degrades to `rssi: None` on
// boards that don't support it, rather than chasing per-board RSSI
// support -- a documented limitation, not a silent gap (see this node's
// user-guide entry).

//
// **This node is now the flow's sole owner of WiFi identity, 2026-09-04
// (Mike's own real-hardware finding, same day):** every other network
// node type that needs the station interface up -- udp_send, udp_receive,
// mqtt_publish, mqtt_subscribe, http_request -- used to carry its OWN
// independent `wifiConfigId` property, letting a flow author point each
// one at a different `thingstudio/config/wifi` config with nothing to
// stop them disagreeing. Mike hit this directly: setting THIS node's own
// config to "unmanaged" (this file's header above, "ride on an existing
// connection") did nothing to stop an mqtt_publish node elsewhere in the
// same flow from still pointing at a config with a real ssid -- two
// contradictory claims about one physical radio, neither compiler-checked
// against the other. Fixed by removing `wifiConfigId` from every node
// type except this one: udp_send/udp_receive/mqtt_publish/mqtt_subscribe/
// http_request now derive their WiFi credentials from THIS node's own
// resolved config instead of a config reference of their own --
// `resolveFlowWifiCredentials()` below is the shared lookup, via the new
// `ctx.findNodesOfType()` (node-definition.ts). Assumes exactly one
// `wifi_status` node per flow for now (Mike's own explicit call, same
// day) -- zero or more than one is a CompileError, not a silent pick of
// "whichever one" the way mergeSetup's key-dedup silently picks a winner
// elsewhere in this codebase. Deliberately not a one-way door against the
// multi-interface future this project already wants to keep open (this
// file's own "possible future enhancement" note above, and Mike's own
// explicit ask): the day a board legitimately needs a second interface,
// each interface gets its own `wifi_status` node, and the network node
// types gain one new property picking which one to derive from -- old
// flows with exactly one `wifi_status` node need no migration at all,
// since "the sole one" is still an unambiguous, correct default. This
// node's own `wifiConfigId` property, and its use of
// `resolveWifiCredentials()` below, are unaffected by this change -- it
// was never part of the bug (it's the one place a wifi config selection
// was always supposed to live).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, SourceCodegenResult } from "../compiler/node-definition.js";
import type { NodeDefinition } from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";

/** The `thingstudio/config/wifi` config type's own `security` values
 * (config-types.ts's own `fields` entry for it) -- defined here, not in
 * app/rete/config-types.ts, so node-library (compiler-adjacent) doesn't
 * take a dependency on app/rete (editor-UI-adjacent); config-types.ts
 * imports this type from here instead, keeping the existing "config
 * descriptors are editor-only, don't belong in the compiler layer"
 * layering (that file's own header) pointed the same direction it already
 * was. See wifiSetupStatement() below for what each value actually does. */
export type WifiSecurity = "password" | "open" | "unmanaged";

/** Shared by every network node type that needs the station interface up
 * -- wifi-status.ts, http-request.ts, mqtt-publish.ts, mqtt-subscribe.ts
 * -- so they all dedup onto the same setup statement regardless of which
 * one happens to compile first. */
export const WIFI_SETUP_KEY = "wifi-sta";

/** Resolves the `ssid`/`password`/`security` a network node should bring
 * the station interface up with, given its own `properties` -- reads
 * `properties.wifiConfigId` and resolves it via `ctx.resolveConfig()`.
 * **Mandatory as of 2026-08-20** (this file's header, Problem 2b Option
 * B): a missing/empty `wifiConfigId` is now a CompileError, not a silent
 * "ride on whatever's there" fallback -- `nodeTypeLabel` (e.g.
 * "wifi_status") is folded into the message so it's attributable without
 * opening generated source. A resolved config with no `security` of its
 * own (a config created before this field existed) defaults to
 * `"password"`, matching config-types.ts's own default -- an old config
 * with a real password keeps working exactly as before; one with no
 * password now needs Mike's own explicit choice as `wifiSetupStatement()`
 * below applies. Does not otherwise validate the resolved shape beyond
 * what `wifiSetupStatement()`'s own typeof checks already do --
 * `ctx.resolveConfig()`'s own contract (node-definition.ts) is "hand back
 * the right bucket of properties, not validate what's inside it," and
 * this stays consistent with that. */
export function resolveWifiCredentials(
  properties: Record<string, unknown>,
  ctx: CodegenContext,
  nodeTypeLabel: string,
): { ssid: unknown; password: unknown; security: WifiSecurity } {
  const configId = properties.wifiConfigId;
  if (configId === undefined || configId === null || configId === "") {
    throw new CompileError(
      `${nodeTypeLabel} requires a WiFi config (properties.wifiConfigId) -- reference one, or pick "unmanaged" on a config if this flow intentionally rides on a connection managed outside it (e.g. a captive-portal-provisioned device)`,
    );
  }
  const resolved = ctx.resolveConfig(String(configId));
  const security: WifiSecurity = resolved.security === "open" || resolved.security === "unmanaged" ? resolved.security : "password";
  return { ssid: resolved.ssid, password: resolved.password, security };
}

/** The flow-wide counterpart to resolveWifiCredentials() above -- see this
 * file's 2026-09-04 header note for the bug this fixes and the design.
 * Looks up the flow's own `thingstudio/wifi_status` node (via
 * `ctx.findNodesOfType()`, node-definition.ts) and resolves WiFi
 * credentials from THAT NODE'S OWN `wifiConfigId`, not from the calling
 * node's own properties -- callers (udp-send.ts, udp-receive.ts,
 * mqtt-shared.ts, http-request.ts) no longer have a `wifiConfigId`
 * property of their own at all. `nodeTypeLabel` (e.g. "mqtt_publish") is
 * folded into every error message so it's attributable without opening
 * generated source, same convention resolveWifiCredentials() itself uses.
 *
 * Assumes exactly one `wifi_status` node per flow (this file's header) --
 * zero or more than one is a loud CompileError, not a silent pick. The
 * `ctx.findNodesOfType` call itself is guarded (it's an optional method,
 * node-definition.ts) purely for the test-suite mocks that predate this
 * function and never touch WiFi resolution -- compile.ts's real
 * CodegenContext always provides it, so a real compile can never actually
 * hit that branch. */
export function resolveFlowWifiCredentials(
  ctx: CodegenContext,
  nodeTypeLabel: string,
): { ssid: unknown; password: unknown; security: WifiSecurity } {
  const finder = ctx.findNodesOfType;
  if (!finder) {
    throw new CompileError(
      `${nodeTypeLabel}: this compiler context can't look up the flow's wifi_status node (findNodesOfType missing) -- internal error, not a flow-authoring mistake`,
    );
  }
  const wifiNodes = finder("thingstudio/wifi_status");
  if (wifiNodes.length === 0) {
    throw new CompileError(
      `${nodeTypeLabel} needs a "wifi_status" node in this flow to supply WiFi credentials -- add one and set its WiFi config (${nodeTypeLabel} no longer has a WiFi config of its own, see wifi-status.ts)`,
    );
  }
  if (wifiNodes.length > 1) {
    throw new CompileError(
      `${nodeTypeLabel}: found ${wifiNodes.length} "wifi_status" nodes in this flow -- only one WiFi interface is supported today (multiple wifi_status nodes, one per interface, is a planned future extension, not yet built)`,
    );
  }
  return resolveWifiCredentials(wifiNodes[0]!.properties, ctx, "wifi_status");
}

/** wifi-provisioning-captive-portal.md (2026-09-14, confirmed with Mike): computes the
 * device-runtime marker DEPLOY carries so wifi_provision.py knows, before it ever imports the
 * deployed flow's own code, whether this flow wants boot-time self-provisioning at all. Returns
 * null when there's no (or more than one) wifi_status node, its wifiConfigId doesn't resolve, or
 * its config's `security` isn't "unmanaged" (every other security value means the flow itself
 * supplies real credentials, so this feature is simply not in play) -- a null marker is what tells
 * DEPLOY to omit the field entirely (messages.ts's own additive-field convention), which in turn
 * tells wifi_provision.py's own listener.py caller to clear any previously-persisted marker rather
 * than carry forward a PREVIOUS flow's provisioning intent (listener.py's own
 * _persist_wifi_provision_marker() doc comment).
 *
 * Deliberately takes a plain GraphData, not a CodegenContext -- called from main.ts alongside (not
 * from inside) compile.ts's own codegen pass, so compile.ts itself never needs to import a specific
 * node type by name (this file's own header already flags that as the reason CredentialRefField
 * lives one layer away from ConfigRefField; the same "generic compiler, node-type-specific logic
 * stays in node-library" layering applies here in reverse -- see main.ts's own call site). The
 * "exactly one wifi_status node" ambiguity (0 or >1) is deliberately NOT an error here -- a flow
 * with a genuinely ambiguous WiFi setup already gets a real CompileError from
 * resolveFlowWifiCredentials() during the normal compile a Deploy click always runs first; this
 * function only ever runs after that compile has already succeeded (main.ts's own call order), so
 * reaching an ambiguous case here would mean compile.ts's own check has a bug, not that this
 * function needs to duplicate it. */
export function computeWifiProvisionMarker(graphData: { nodes: GraphNode[]; configs?: { id: string; properties: Record<string, unknown> }[] }): {
  selfProvision: boolean;
  allowReprovision: boolean;
} | null {
  const wifiNodes = graphData.nodes.filter((n) => n.type === "thingstudio/wifi_status");
  if (wifiNodes.length !== 1) return null;
  const configId = wifiNodes[0]!.properties.wifiConfigId;
  if (typeof configId !== "string" || !configId) return null;
  const config = (graphData.configs ?? []).find((c) => c.id === configId);
  if (!config) return null;
  if (config.properties.security !== "unmanaged") return null;
  return { selfProvision: true, allowReprovision: config.properties.allowReprovisioning === true };
}

/** Whether this flow has any node that manages its own independent WiFi
 * connection (today: mqtt_as, backing mqtt_publish/mqtt_subscribe) --
 * shared by every `wifiSetupStatement()` caller (this file's own
 * codegenSource below, plus http-request.ts/udp-send.ts/udp-receive.ts/
 * http-in.ts) so whichever one happens to win compile.ts's `mergeSetup`
 * dedup for the shared "wifi-sta" key (first writer wins, graph-node-array-
 * order-dependent -- see compile.ts's own header) still makes the SAME
 * connect-or-defer decision. Missing `findNodesOfType` degrades to `false`
 * (never defer) rather than throwing -- same reasoning resolveFlowWifiCredentials()
 * above documents: real compiles always provide it, this is purely a
 * fallback for hand-rolled test-suite mocks that predate this function. */
export function flowHasMqttNodes(ctx: CodegenContext): boolean {
  return (ctx.findNodesOfType?.("thingstudio/mqtt_publish").length ?? 0) > 0 || (ctx.findNodesOfType?.("thingstudio/mqtt_subscribe").length ?? 0) > 0;
}

/** Builds the shared "bring the station interface up, optionally with
 * configured credentials" setup statement. `ssid`/`password` are the raw
 * (possibly empty/undefined) values resolved from a referenced wifi
 * config; `security` (default `"password"`, for callers -- like
 * http-request.ts -- that don't go through the config-node/security
 * mechanism at all) governs two things:
 *   - `"unmanaged"`: no `.connect()` call at all, regardless of
 *     ssid/password -- interface just comes up, riding on whatever the
 *     device already has. The explicit, labeled replacement for what an
 *     omitted `wifiConfigId` used to mean implicitly (this file's header).
 *   - `"password"` with a non-empty ssid but an empty/missing password:
 *     a loud CompileError (Problem 2's "barf on undefined network
 *     details," applied to config data, not just runtime errors) --
 *     almost certainly a forgotten password, not an intentional choice.
 *     `"open"` skips this check on purpose (that's its whole job -- see
 *     config-types.ts's own header on why WPA/WPA2/WPA3 don't need a
 *     version selector and open networks already worked mechanically
 *     before this field existed). An empty ssid (no network declared at
 *     all) still just brings the interface up with no connect call,
 *     unchanged from before this field existed -- not itself an error.
 *
 * `deferToMqtt` (default `false`) is a DELIBERATELY SEPARATE parameter
 * from `security`, 2026-09-11 (Mike's own explicit call, after the first
 * cut of this fix piggybacked on `security: "unmanaged"` -- see this
 * file's own header note right above the `flowHasMqttNodes()` call site
 * below for the full mechanism this exists to fix): `security` is the
 * flow AUTHOR's own declared intent about a WiFi config ("this network
 * needs a password" / "this is open" / "something outside this flow
 * already manages the connection"); `deferToMqtt` is the COMPILER's own
 * derived fact about this specific flow ("an mqtt node is present, so
 * mqtt_as already owns reconnection here"). Collapsing those into one
 * enum value would mean a flow author staring at `security: "unmanaged"`
 * in the property panel can no longer tell whether they chose that, or
 * the compiler silently picked it for them -- confusing for exactly the
 * kind of future-maintainer reason Mike flagged. When `deferToMqtt` is
 * true, the generated code notes why with its own comment, regardless of
 * what `security` says -- so reading the compiled output alone (no
 * property panel needed) already answers "why is there no connect() call
 * here." */
export function wifiSetupStatement(ssid: unknown, password: unknown, security: WifiSecurity = "password", deferToMqtt = false): { key: string; code: string } {
  const lines = ["_wifi_sta = network.WLAN(network.STA_IF)", "_wifi_sta.active(True)"];
  if (deferToMqtt) {
    lines.push("# WiFi connection managed by mqtt_as -- this flow has an mqtt_publish/mqtt_subscribe node, which owns its own connect/reconnect (wifi-status.ts's flowHasMqttNodes())");
    return { key: WIFI_SETUP_KEY, code: lines.join("\n") };
  }
  if (security === "unmanaged") {
    return { key: WIFI_SETUP_KEY, code: lines.join("\n") };
  }
  const ssidStr = typeof ssid === "string" ? ssid.trim() : "";
  if (ssidStr) {
    const pwStr = typeof password === "string" ? password : "";
    if (security === "password" && !pwStr) {
      throw new CompileError(
        `WiFi config for ssid "${ssidStr}" has no password but security is "password" -- set a password, or choose "open" if this network intentionally has none`,
      );
    }
    lines.push(`if not _wifi_sta.isconnected():`, `    _wifi_sta.connect(${pyStringLiteral(ssidStr)}, ${pyStringLiteral(pwStr)})`);
  }
  return { key: WIFI_SETUP_KEY, code: lines.join("\n") };
}

export const wifiStatusNode: NodeDefinition = {
  type: "thingstudio/wifi_status",
  kind: "source",
  // `msg`'s payload is always bool (buildMsg's `_wifi_connected` below) --
  // `ip` is envelope metadata alongside payload, not the typed payload
  // itself, same "only the payload gets a socket type" treatment
  // gpio_out's `signal` input already gets (wire-type-system-scoping.md).
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const pollMs = Math.round(Number(node.properties.pollMs ?? 5000));
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new CompileError(`wifi_status pollMs "${String(node.properties.pollMs)}" must be a positive number`);
    }

    const { ssid, password, security } = resolveWifiCredentials(node.properties, ctx, "wifi_status");

    // Mike's ask, 2026-09-02 (outstanding-items/wifi-status-emit-on-change.md):
    // emit only when connection state actually changes, not on every poll.
    // Per-INSTANCE, not per-broker/shared -- two wifi_status nodes (rare,
    // but not rejected) each need their own "last reported state," matching
    // mqtt-subscribe.ts's `readyVar` precedent (ctx.uniqueName's result is
    // already flow-wide-unique, so it doubles safely as the setup-statement
    // dedup key too). Tracks (connected, ip, subnet, gateway, dns) as a
    // tuple, not just the bool -- any network-identity field changing while
    // still connected (DHCP lease renewal, most commonly a new `ip`, but a
    // new `gateway`/`dns` is equally a real change) is worth re-emitting,
    // not just the connected/disconnected transition. `rssi` is
    // deliberately excluded from this tuple -- see this file's 2026-09-09
    // header note for why.
    const lastVar = ctx.uniqueName("wifi_status_last");

    // Defer connection ownership to mqtt_as when the flow has any mqtt
    // node, 2026-09-11 (Mike's real-hardware finding -- outstanding-items/
    // node-status-indicators.md): mqtt_publish/mqtt_subscribe already
    // derive their WiFi credentials from THIS node's own resolved config
    // (resolveFlowWifiCredentials above), but that was only ever a
    // credentials fix (2026-09-04, this file's header) -- it left TWO
    // independent code paths still each free to bring the shared physical
    // STA_IF up: this node's own one-shot `.connect()` in
    // wifiSetupStatement() below, and mqtt_as's own internal
    // wifi_connect()/`_keep_connected()` (mqtt-shared.ts's header, and the
    // vendored mqtt_as/__init__.py). mqtt_as's own background watchdog
    // polls isconnected() roughly every second once connected and will
    // proactively call `.disconnect()`+reconnect on its own if it ever
    // perceives the link as down -- on real hardware this showed up as
    // WiFi visibly cycling up/down with no actual signal problem, first
    // reported by Mike once the status-indicator feature made it possible
    // to actually SEE it happening on the canvas (it isn't new; there was
    // just no way to observe it before).
    //
    // Fix: `wifiSetupStatement()`'s own `deferToMqtt` parameter (see that
    // function's header for why this is a SEPARATE parameter from
    // `security`, not an overload of `"unmanaged"` -- Mike's own explicit
    // call, after a first cut of this fix piggybacked on `security:
    // "unmanaged"` and he flagged that as confusing for a future
    // maintainer reading generated code or this property panel: no way to
    // tell "I set this" from "the compiler decided this"). Doesn't weaken
    // credential validation: mqtt-shared.ts's own parseMqttBrokerProps
    // independently resolves and validates the SAME underlying config's
    // real ssid/password (and separately rejects an actually-`"unmanaged"`
    // -configured WiFi config outright when mqtt nodes are present) --
    // `deferToMqtt` only ever affects whether THIS node's own setup
    // statement issues a redundant `.connect()` call, never what
    // credentials mqtt_as itself connects with. Everything else about
    // this node is unaffected: still polls and reports real
    // connected/disconnected state every cycle, same as always -- it just
    // never tries to be the one bringing the link up when mqtt_as is
    // already doing that job. Compile-time, not a runtime flag -- no new
    // state to carry onto the device.
    //
    // Whether this fully explains the observed flapping (versus just
    // removing the startup race a second independent `.connect()` call
    // could cause) is still being confirmed on real hardware -- worth
    // real-device re-verification before this is called done, same as
    // everything else pending Mike's hardware pass in this file's own
    // outstanding-items entry.

    return {
      imports: ["import network"],
      statements: [wifiSetupStatement(ssid, password, security, flowHasMqttNodes(ctx)), { key: lastVar, code: `${lastVar} = None` }],
      // ifconfig()/status('rssi') are only read when isconnected() already
      // said yes -- ifconfig() itself would raise/return a stale address
      // on some ports while disconnected, same reasoning that already
      // applied to 'ip' alone before this node reported the rest of the
      // tuple too.
      //
      // `${lastVar}` starts as `None` (statement above), which never equals
      // a real state tuple -- so the very first poll always reports, same
      // as before this change, then only reports again on an actual
      // change. `compile.ts`'s source-loop assembly wraps the downstream
      // chain in `if msg is not None:` and keeps the `asyncio.sleep_ms`
      // yield unconditional either way, so a skipped cycle here never
      // turns into a busy-loop.
      buildMsg:
        `global ${lastVar}\n` +
        "_wifi_connected = bool(_wifi_sta.isconnected())\n" +
        "if _wifi_connected:\n" +
        "    _wifi_ifcfg = _wifi_sta.ifconfig()\n" +
        "    _wifi_ip = _wifi_ifcfg[0]\n" +
        "    _wifi_subnet = _wifi_ifcfg[1]\n" +
        "    _wifi_gateway = _wifi_ifcfg[2]\n" +
        "    _wifi_dns = _wifi_ifcfg[3]\n" +
        "    try:\n" +
        "        _wifi_rssi = _wifi_sta.status('rssi')\n" +
        "    except (OSError, AttributeError):\n" +
        "        _wifi_rssi = None\n" +
        "else:\n" +
        "    _wifi_ip = ''\n" +
        "    _wifi_subnet = ''\n" +
        "    _wifi_gateway = ''\n" +
        "    _wifi_dns = ''\n" +
        "    _wifi_rssi = None\n" +
        "_wifi_state = (_wifi_connected, _wifi_ip, _wifi_subnet, _wifi_gateway, _wifi_dns)\n" +
        `if _wifi_state == ${lastVar}:\n` +
        "    msg = None\n" +
        "else:\n" +
        `    ${lastVar} = _wifi_state\n` +
        "    msg = {'payload': _wifi_connected, 'topic': '', 'ip': _wifi_ip, 'subnet': _wifi_subnet, 'gateway': _wifi_gateway, 'dns': _wifi_dns, 'rssi': _wifi_rssi}\n" +
        // NODE_STATUS push (connection-status-indicator feature,
        // outstanding-items/node-status-indicators.md, added 2026-09-10)
        // -- alongside `msg`, not instead of it (NodeStatusMessage's own
        // doc comment in messages.ts). Piggybacks on the SAME "state
        // changed" branch `msg` already uses rather than tracking its own
        // separate last-reported-status var: the only cost is a
        // functionally-redundant identical report_status call on a
        // gateway/subnet/dns-only change while staying connected (rare --
        // a DHCP lease renewal, not a routine poll) since that still
        // takes this branch -- harmless (the editor's own `status` field
        // just gets set to the same value again, nodes.ts) and far
        // simpler than a second per-instance tracking var for a case
        // this rare. `text` carries the IP address when connected (only
        // supplementary detail worth surfacing here -- `state` alone
        // already says connected/disconnected), absent when not
        // (messages.ts's "absent, not null" convention for this field).
        `    runtime.report_status(${JSON.stringify(String(node.id))}, 'connected' if _wifi_connected else 'disconnected', _wifi_ip if _wifi_connected else None)`,
      repeatMs: pollMs,
    };
  },
};
