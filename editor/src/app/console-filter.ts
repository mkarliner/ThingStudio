// SPDX-License-Identifier: Apache-2.0
// editor/src/app/console-filter.ts
//
// The device console's level: Normal, Info or Debug (Mike, 2026-10-07: "the console is getting far too
// chatty ... it may need a log level"). Replaces the 2026-09-25 Verbose switch, which hid only a few
// board reports while the editor's own routine notes always showed.
//
//   normal -- what needs a person: the flow's own output (debug nodes, print()), every warning and error,
//             and the outcome of what they just did (deploy OK, flow status, advice).
//   info   -- routine reports that say things are working: board detected, versions compatible, memory
//             figures, libraries sent, network status, the listener starting.
//   debug  -- detail for chasing a problem: raw protocol messages, the chip's boot ROM banner, compiler
//             and backend chatter.
//
// Hidden rows are kept, so choosing a busier level shows what was already logged. Pure functions; main.ts
// tags each row and hides or shows it.

export type ConsoleLevel = "normal" | "info" | "debug";

export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ["normal", "info", "debug"];

/** True when a row tagged `rowLevel` shows at the chosen `level`. */
export function shownAt(rowLevel: ConsoleLevel, level: ConsoleLevel): boolean {
  return CONSOLE_LEVELS.indexOf(rowLevel) <= CONSOLE_LEVELS.indexOf(level);
}

/** Board lines that say the system is working, not that anything needs a look. */
const INFO_BOARD_PREFIXES = [
  "NET_INFO ",
  "NET_LISTENING ",
  "NET_SESSION_OPEN ",
  "NET_SESSION_CLOSED ",
  "NET_STOPPED ",
  "LISTENER_BOOTING ",
  "LISTENER_BOOT ",
  "LISTENER_READY",
];

/** The editor's own routine notes (a line logged as an error always shows, whatever its tag). */
const INFO_EDITOR_PREFIXES = [
  "[board] Target:",
  "[version check]",
  "[memory]",
  "[libraries]",
];

/** Install runtime's per-file progress ("[install runtime] 3/12 runtime.mpy"). */
const INSTALL_PROGRESS = /^\[install runtime\] \d+\/\d+ /;

const DEBUG_EDITOR_PREFIXES = [
  "[runtime build check]",
  "[compile] targeting",
  "[compiled --",
  "[mpy-cross]",
  "[mpy-cross WASM ready]",
];

/** An ESP32's boot ROM banner and ESP-IDF's own info logs ("I (123) wifi: ..."). Its warnings and errors
 * ("W (...)", "E (...)") stay at normal. */
const BOOT_ROM = /^(ets [A-Z][a-z]{2} |rst:0x|configsip:|clk_drv:|mode:[A-Z]+, clock div|load:0x|entry 0x|ho \d+ tail|I \(\d+\) )/;

/** Protocol messages the editor echoes as "[TYPE] {json}". NODE_ERROR's echo stays at normal. */
const PROTOCOL_ECHO = /^\[([A-Z_]+)\] \{/;

export function consoleLevel(text: string, cls?: string): ConsoleLevel {
  if (cls === "err") return "normal";
  const echo = PROTOCOL_ECHO.exec(text);
  if (echo) return echo[1] === "NODE_ERROR" ? "normal" : "debug";
  if (text.startsWith("NODE_STATUS node=")) return "debug"; // the status dot on the node shows it
  if (BOOT_ROM.test(text)) return "debug";
  if (DEBUG_EDITOR_PREFIXES.some((p) => text.startsWith(p))) return "debug";
  // The backend relay's own chatter; its "back again, reload after a rebuild" note (ok) stays.
  if (text.startsWith("[backend] ") && cls !== "ok") return "debug";
  if (INFO_BOARD_PREFIXES.some((p) => text.startsWith(p))) return "info";
  if (INFO_EDITOR_PREFIXES.some((p) => text.startsWith(p))) return "info";
  if (INSTALL_PROGRESS.test(text)) return "info";
  return "normal";
}

/** The saved choice, or the old Verbose switch's (on meant show everything), or normal. */
export function savedConsoleLevel(level: string | null, oldVerbose: string | null): ConsoleLevel {
  if (level === "normal" || level === "info" || level === "debug") return level;
  return oldVerbose === "1" ? "debug" : "normal";
}
