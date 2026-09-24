// SPDX-License-Identifier: Apache-2.0
// editor/src/app/network-choice.ts
//
// Pure helpers for the WiFi transport's editor side (MVP item 6, 2026-09-24): what the port menu's
// network entries mean, how a typed address is read, and whether a board can be reached over WiFi.
// No DOM here -- main.ts owns element access; this is the part worth unit-testing.

import type { NetworkBoardInfo } from "../protocol/backend-transport.js";

export const DEFAULT_TCP_PORT = 7462;
const NET_PREFIX = "net:";
export const MANUAL_NETWORK_VALUE = "net:manual";

export type PortSelection =
  | { readonly kind: "serial"; readonly port: string }
  | { readonly kind: "network"; readonly host: string; readonly tcpPort: number }
  | { readonly kind: "manual" }
  | { readonly kind: "none" };

/** The port menu's option value for a discovered board. The address is used, not the hostname,
 * so connecting doesn't depend on mDNS working on this computer. */
export function networkOptionValue(board: Pick<NetworkBoardInfo, "address" | "port">): string {
  return `${NET_PREFIX}${board.address}:${board.port}`;
}

export function networkOptionLabel(board: NetworkBoardInfo): string {
  const parts = [`${board.hostname} (${board.address}) -- WiFi`];
  if (!board.wifiTransport) parts.push("no password set");
  else if (board.busy) parts.push("in use");
  return parts.join(", ");
}

export function parsePortSelection(value: string): PortSelection {
  if (!value) return { kind: "none" };
  if (value === MANUAL_NETWORK_VALUE) return { kind: "manual" };
  if (value.startsWith(NET_PREFIX)) {
    const target = parseNetworkAddress(value.slice(NET_PREFIX.length));
    return target ? { kind: "network", host: target.host, tcpPort: target.tcpPort } : { kind: "none" };
  }
  return { kind: "serial", port: value };
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Reads what a user typed: "kitchen", "kitchen.local", "192.168.1.42", optionally ":port".
 * A bare name gets ".local" added, since that's how the board answers (mDNS). Returns null for
 * anything that isn't a plausible IPv4 address or hostname. */
export function parseNetworkAddress(input: string): { host: string; tcpPort: number } | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  let tcpPort = DEFAULT_TCP_PORT;
  const colon = text.lastIndexOf(":");
  if (colon !== -1) {
    const portText = text.slice(colon + 1);
    if (!/^\d{1,5}$/.test(portText)) return null;
    tcpPort = Number(portText);
    if (tcpPort < 1 || tcpPort > 65535) return null;
    text = text.slice(0, colon);
  }
  const ip = IPV4_RE.exec(text);
  if (ip) {
    return ip.slice(1).every((octet) => Number(octet) <= 255) ? { host: text, tcpPort } : null;
  }
  const labels = text.split(".");
  if (labels.some((l) => !LABEL_RE.test(l))) return null;
  const host = labels.length === 1 ? `${text}.local` : text;
  return { host, tcpPort };
}

/** What the editor can say about reaching the connected board over WiFi. */
export type WifiReadiness =
  | "no_radio" // definition says no WiFi, or the firmware has no network.WLAN
  | "old_runtime" // runtime predates the WiFi transport (no hostname in HELLO)
  | "no_password" // has WiFi, but no password set: WiFi transport off
  | "ready"; // password set -- reachable once the flow's wifi_status has it on a network

export function wifiReadiness(
  hello: { readonly hostname: string | null; readonly hasWifi: boolean; readonly authRequired: boolean },
  boardDefinitionWifi: boolean | null,
): WifiReadiness {
  if (boardDefinitionWifi === false) return "no_radio";
  if (hello.hostname === null) return "old_runtime";
  if (!hello.hasWifi) return "no_radio";
  return hello.authRequired ? "ready" : "no_password";
}

/** Checks a new board password before it's sent: board_settings.py's rule (8-64 characters). */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 8 || password.length > 64) return "The password must be 8 to 64 characters.";
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** Checks a hostname before it's sent: board_settings.py's rule. */
export function hostnameProblem(name: string): string | null {
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
    return "Use 1 to 32 characters: lower-case letters, digits and '-', not starting or ending with '-'.";
  }
  return null;
}
