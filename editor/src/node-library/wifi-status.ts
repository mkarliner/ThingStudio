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
// that needs it, so http-request.ts/udp-send.ts/udp-receive.ts don't each
// reimplement it. This is Mike's own explicit mandate (config-node-and-
// palette-implementation-briefing.md: "Entering ssid credentials multiple
// times is not acceptable even for an mvp") -- the whole point is that
// typing a password into more than one node's property panel is no longer
// possible for the node types that need it. **Deliberately kept optional,
// not mandatory**: no `wifiConfigId` -> resolveWifiCredentials() returns
// `{ssid: undefined, password: undefined}`, and wifiSetupStatement() below
// treats that exactly like an empty ssid always has -- "just bring the
// interface up, no connect," identical to today's behavior with no
// config referenced. Smaller behavior change than making the reference
// mandatory, and it keeps a config-less flow compiling exactly as it does
// today (a real judgment call, flagged rather than silently decided --
// see the implementation briefing's own "worth flagging explicitly"
// section).
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

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, SourceCodegenResult } from "../compiler/node-definition.js";
import type { NodeDefinition } from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";

/** Shared by every network node type that needs the station interface up
 * -- wifi-status.ts, http-request.ts, mqtt-publish.ts, mqtt-subscribe.ts
 * -- so they all dedup onto the same setup statement regardless of which
 * one happens to compile first. */
export const WIFI_SETUP_KEY = "wifi-sta";

/** Resolves the `ssid`/`password` a network node should bring the station
 * interface up with, given its own `properties` -- reads
 * `properties.wifiConfigId` and, if present, resolves it via
 * `ctx.resolveConfig()`. No `wifiConfigId` (undefined/null/empty string)
 * -> both come back `undefined`, which `wifiSetupStatement()` already
 * treats as "no credentials configured" (empty ssid, interface brought up
 * with no connect call) -- see this file's header for why that's a
 * deliberate, not-mandatory design. Does not itself validate the resolved
 * shape beyond what `wifiSetupStatement()`'s own typeof checks already do
 * -- `ctx.resolveConfig()`'s own contract (node-definition.ts) is "hand
 * back the right bucket of properties, not validate what's inside it,"
 * and this stays consistent with that. */
export function resolveWifiCredentials(properties: Record<string, unknown>, ctx: CodegenContext): { ssid: unknown; password: unknown } {
  const configId = properties.wifiConfigId;
  if (configId === undefined || configId === null || configId === "") {
    return { ssid: undefined, password: undefined };
  }
  const resolved = ctx.resolveConfig(String(configId));
  return { ssid: resolved.ssid, password: resolved.password };
}

/** Builds the shared "bring the station interface up, optionally with
 * configured credentials" setup statement. `ssid`/`password` are the raw
 * (possibly empty/undefined) values resolved from a referenced wifi
 * config -- an empty/missing ssid just brings the interface up without
 * initiating a connect, on the assumption something else (another
 * network node in the same flow, or a connection already established some
 * other way) handles it. */
export function wifiSetupStatement(ssid: unknown, password: unknown): { key: string; code: string } {
  const ssidStr = typeof ssid === "string" ? ssid.trim() : "";
  const lines = ["_wifi_sta = network.WLAN(network.STA_IF)", "_wifi_sta.active(True)"];
  if (ssidStr) {
    const pwStr = typeof password === "string" ? password : "";
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

    const { ssid, password } = resolveWifiCredentials(node.properties, ctx);

    return {
      imports: ["import network"],
      statements: [wifiSetupStatement(ssid, password)],
      // 'ip' is '' when not connected -- ifconfig() itself would raise/
      // return a stale address on some ports while disconnected, so this
      // avoids calling it at all unless isconnected() already said yes.
      buildMsg:
        "_wifi_connected = bool(_wifi_sta.isconnected())\n" +
        "msg = {'payload': _wifi_connected, 'topic': '', 'ip': (_wifi_sta.ifconfig()[0] if _wifi_connected else '')}",
      repeatMs: pollMs,
    };
  },
};
