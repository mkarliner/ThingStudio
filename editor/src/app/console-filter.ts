// SPDX-License-Identifier: Apache-2.0
// editor/src/app/console-filter.ts
//
// The device console's Verbose switch (2026-09-25, Mike: "so debug nodes won't get lost, but if there are
// other issues which need system reports we can switch them on"). Routine system reports -- the runtime's
// own status lines and the editor's raw protocol echoes -- are verbose-only. A flow's own output (debug
// nodes, print()), every warning and error, and the editor's own [bracketed] notes always show. Hidden rows
// are kept, so turning Verbose on shows what was already logged.

/** Board lines that are routine reports: they say the system is working, not that anything needs a look. */
const BOARD_PREFIXES = [
  "NET_INFO ",
  "NET_LISTENING ",
  "NET_SESSION_OPEN ",
  "NET_SESSION_CLOSED ",
  "NET_STOPPED ",
  "LISTENER_BOOTING ",
  "LISTENER_BOOT ",
  "LISTENER_READY",
  "NODE_STATUS node=",
];

/** Protocol messages the editor echoes as "[TYPE] {json}" whose content is shown elsewhere (the status dot,
 * the [version check]/[flow status] lines). NODE_ERROR's echo stays visible. */
const ECHOED_TYPES = ["HELLO", "NODE_STATUS", "DEPLOY_ACK", "BOARD_SETTINGS_RESULT"];

export function isVerboseOnly(text: string, cls?: string): boolean {
  if (cls === "err") return false;
  if (BOARD_PREFIXES.some((p) => text.startsWith(p))) return true;
  return ECHOED_TYPES.some((t) => text.startsWith(`[${t}] {`));
}
