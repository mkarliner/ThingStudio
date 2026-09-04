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
 *     unchanged from before this field existed -- not itself an error. */
export function wifiSetupStatement(ssid: unknown, password: unknown, security: WifiSecurity = "password"): { key: string; code: string } {
  const lines = ["_wifi_sta = network.WLAN(network.STA_IF)", "_wifi_sta.active(True)"];
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
    // dedup key too). Tracks (connected, ip) as a pair, not just the bool --
    // an IP change while still connected (DHCP lease renewal to a different
    // address) is a real status change worth re-emitting, not just the
    // connected/disconnected transition.
    const lastVar = ctx.uniqueName("wifi_status_last");

    return {
      imports: ["import network"],
      statements: [wifiSetupStatement(ssid, password, security), { key: lastVar, code: `${lastVar} = None` }],
      // 'ip' is '' when not connected -- ifconfig() itself would raise/
      // return a stale address on some ports while disconnected, so this
      // avoids calling it at all unless isconnected() already said yes.
      //
      // `${lastVar}` starts as `None` (statement above), which never equals
      // a real `(bool, str)` state tuple -- so the very first poll always
      // reports, same as before this change, then only reports again on an
      // actual change. `compile.ts`'s source-loop assembly wraps the
      // downstream chain in `if msg is not None:` and keeps the
      // `asyncio.sleep_ms` yield unconditional either way, so a skipped
      // cycle here never turns into a busy-loop.
      buildMsg:
        `global ${lastVar}\n` +
        "_wifi_connected = bool(_wifi_sta.isconnected())\n" +
        "_wifi_ip = (_wifi_sta.ifconfig()[0] if _wifi_connected else '')\n" +
        "_wifi_state = (_wifi_connected, _wifi_ip)\n" +
        `if _wifi_state == ${lastVar}:\n` +
        "    msg = None\n" +
        "else:\n" +
        `    ${lastVar} = _wifi_state\n` +
        "    msg = {'payload': _wifi_connected, 'topic': '', 'ip': _wifi_ip}",
      repeatMs: pollMs,
    };
  },
};
