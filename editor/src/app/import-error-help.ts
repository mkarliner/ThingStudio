// SPDX-License-Identifier: Apache-2.0
// editor/src/app/import-error-help.ts
//
// A flow that imports a module the board's MicroPython doesn't have fails at deploy with a bare
// `ImportError: no module named 'socket'` -- true, but it doesn't say why or what to do. Found
// 2026-10-07: an MQTT flow deployed to a plain Raspberry Pi Pico (no WiFi, so no socket/network
// modules). Mike: "fail well". This turns that into advice; main.ts shows it.
//
// Libraries Thingstudio installs itself (flow dependencies) never get here: the board refuses a
// deploy with a missing library before importing anything. So an ImportError at deploy means a
// module the firmware was expected to provide. Board-agnostic on purpose (CLAUDE.md: people bring
// boards we haven't tested): it names the module and points at MicroPython's own builds.

import { DOC_BOARD_FIRMWARE_MODULES, type Advice } from "./board-diagnosis.js";

/** Modules that come with a networking build of MicroPython (WiFi or Ethernet). */
const NETWORK_MODULES = new Set(["network", "socket", "usocket", "ssl", "ussl", "espnow", "aioespnow", "requests", "urequests"]);

/** The module named in a MicroPython ImportError message, or null. */
export function missingModuleName(message: string): string | null {
  const m = /no module named '([\w.]+)'/i.exec(message);
  return m ? m[1]! : null;
}

/** Advice for a deploy that failed with ImportError, or null if `message` names no module.
 * `thingstudioLibraries` are the library list's module names (those failures mean something else). */
export function explainDeployImportError(message: string, thingstudioLibraries: ReadonlySet<string>): Advice | null {
  const mod = missingModuleName(message);
  if (mod === null) return null;
  const top = mod.split(".")[0]!;
  if (thingstudioLibraries.has(top)) {
    return {
      text:
        `The board couldn't load Thingstudio's ${top} library. Deploy again to resend it; if this keeps ` +
        "happening, install the runtime again (Tools → Install runtime…).",
    };
  }
  if (NETWORK_MODULES.has(top)) {
    return {
      text:
        `This flow needs networking, but the MicroPython on this board has no '${top}' module. That usually ` +
        "means the board has no WiFi (a Raspberry Pi Pico rather than a Pico W, for example), or its firmware " +
        "was built without networking. Use a board with WiFi, or install a MicroPython build for your board " +
        "that includes networking (micropython.org/download). The board's previous flow is still running.",
      doc: DOC_BOARD_FIRMWARE_MODULES,
    };
  }
  return {
    text:
      `The flow imports '${top}', which the MicroPython on this board doesn't have. Some modules are only in ` +
      "some ports or builds. If it's in your own function node, check the module exists for this board " +
      "(docs.micropython.org lists them per port). The board's previous flow is still running.",
    doc: DOC_BOARD_FIRMWARE_MODULES,
  };
}

/** A warning before deploying, when the board has already said it has no WiFi and the flow imports
 * networking modules. A warning, not a block: a board can have networking without WiFi (Ethernet). */
export function networkWarningBeforeDeploy(importedModules: ReadonlySet<string>, boardHasWifi: boolean | null): string | null {
  if (boardHasWifi !== false) return null;
  const used = [...importedModules].filter((m) => NETWORK_MODULES.has(m) || m === "mqtt_as").sort();
  if (used.length === 0) return null;
  return (
    `this flow uses networking (${used.join(", ")}), but the board reports no WiFi. ` +
    "Unless it has Ethernet, the deploy will fail."
  );
}
