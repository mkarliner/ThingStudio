// SPDX-License-Identifier: Apache-2.0
// editor/src/app/board-diagnosis.ts
//
// Turns "what did the board send back?" into a next step for the user. Two call sites in main.ts:
//
//   - Install runtime failed before reaching raw REPL: the backend classifies what it saw
//     (raw_repl.py's classify_reply(), sent as install_runtime_result's `diagnosis`).
//   - Connect/Check status got no HELLO: classifyDebugLines() below classifies the plain text
//     lines the board printed since Connect (the backend relays them as "debug" messages).
//
// Why this exists (2026-09-23, real hardware): a blank ESP32-S2 with no MicroPython produced a
// no-HELLO message pointing at a terminal script, then an install failure ending
// `last seen: b''`. Both accurate, neither useful to someone who skipped "install MicroPython
// first". Silence, a MicroPython prompt, a ROM bootloader and other firmware each need different
// advice -- road-to-mvp.md's "no silent failure: say what happened and what to do next".
//
// Wording lives here only; the backend names what it saw and never phrases advice, so the two
// can't drift apart. Same loose substring-matching posture as connect-error-help.ts.
//
// Advice can carry a docs page (path under the site root). main.ts turns it into a clickable link
// to the backend's locally served copy (/docs/, docs_site.py), so the help works offline.

/** What was on the other end of the port. The first five match raw_repl.py's REPLY_* values;
 * "runtime" is editor-only (the Thingstudio listener's own boot lines were seen). */
export type BoardReply = "silent" | "micropython" | "circuitpython" | "esp_rom" | "other" | "runtime";

/** A page in the user docs, as a path relative to the docs site root (mkdocs directory URLs). */
export interface DocLink {
  readonly label: string;
  readonly path: string;
}

export interface Advice {
  readonly text: string;
  readonly doc?: DocLink;
}

export const DOC_INSTALL_MICROPYTHON: DocLink = { label: "Installing MicroPython", path: "installing-micropython/" };
export const DOC_BOARD_WONT_CONNECT: DocLink = { label: "Board won't connect", path: "debugging/#board-wont-connect" };
export const DOC_BOARD_STUCK: DocLink = { label: "Board stuck restarting", path: "debugging/#board-stuck-restarting" };
export const DOC_COMMANDS: DocLink = { label: "Commands and the Python prompt", path: "debugging/#commands-and-the-python-prompt" };

const INSTALL_FAILURE_ADVICE: Record<string, Advice> = {
  silent: {
    text:
      "The board didn't reply at all. It probably doesn't have MicroPython yet -- install that first. " +
      "If it does have MicroPython, press its reset button and try again.",
    doc: DOC_INSTALL_MICROPYTHON,
  },
  micropython: {
    text: "MicroPython replied but didn't switch to install mode. Press the board's reset button and try again.",
    doc: DOC_BOARD_WONT_CONNECT,
  },
  circuitpython: {
    text: "This board is running CircuitPython. Thingstudio needs MicroPython -- install that first.",
    doc: DOC_INSTALL_MICROPYTHON,
  },
  esp_rom: {
    text:
      "The board is in its bootloader (download mode), not running MicroPython. Press reset without holding " +
      "BOOT and try again. If it comes back here, MicroPython isn't installed.",
    doc: DOC_INSTALL_MICROPYTHON,
  },
  other: {
    text: "The board replied, but not as MicroPython -- it may be running other firmware. Install MicroPython first.",
    doc: DOC_INSTALL_MICROPYTHON,
  },
  // Editor-side, not from raw_repl.py: BackendTransport.installRuntime()'s idle timeout.
  stalled: {
    text:
      "The install stopped making progress. Unplug the board, plug it back in, click \"⟳ ports\", then try " +
      "\"Install runtime…\" again. If it stalls again, restart the backend.",
    doc: DOC_BOARD_WONT_CONNECT,
  },
};

// Appended wherever advice sends the user off to flash MicroPython with another tool. Connect holds
// the port open until Disconnect, and esptool/Thonny then fail with "Resource busy" (Mike, real
// hardware, 2026-09-23). The install-failure path needs no such note: Install runtime already closed
// its own port by the time it reports.
const DISCONNECT_FIRST = ' Click "Disconnect" before flashing, or the flashing tool can\'t open the port.';

const NO_HELLO_ADVICE: Record<BoardReply, Advice> = {
  micropython: {
    text: 'The board has MicroPython but not the Thingstudio runtime. Click "Install runtime…".',
    doc: DOC_BOARD_WONT_CONNECT,
  },
  runtime: { text: 'The Thingstudio runtime is starting up. Wait a few seconds, then click "Check status".' },
  silent: {
    text:
      "Nothing came back at all. If the board is new, it may not have MicroPython yet." +
      DISCONNECT_FIRST +
      ' Otherwise press its reset button and click "Check status". "Install runtime…" also checks what\'s ' +
      "on the board.",
    doc: DOC_INSTALL_MICROPYTHON,
  },
  circuitpython: withDisconnect(INSTALL_FAILURE_ADVICE.circuitpython!),
  esp_rom: withDisconnect(INSTALL_FAILURE_ADVICE.esp_rom!),
  other: withDisconnect(INSTALL_FAILURE_ADVICE.other!),
};

function withDisconnect(advice: Advice): Advice {
  return { ...advice, text: advice.text + DISCONNECT_FIRST };
}

/** Advice for a failed Install runtime. Keeps the backend's raw NODE_ERROR text (useful for a bug
 * report) and adds a next step when the backend sent a diagnosis it recognises. */
export function explainInstallFailure(rawMessage: string, diagnosis: string | null): Advice {
  const advice = diagnosis ? INSTALL_FAILURE_ADVICE[diagnosis] : undefined;
  return advice ? { text: `${advice.text} (${rawMessage})`, doc: advice.doc } : { text: rawMessage };
}

/** Classifies the plain text lines a board printed since a HELLO_REQUEST. Mirrors raw_repl.py's
 * classify_reply() rules, plus "runtime" for listener.py's own LISTENER_* boot lines. */
export function classifyDebugLines(lines: readonly string[]): BoardReply {
  const text = lines.join("\n");
  if (!text.trim()) return "silent";
  if (text.includes("LISTENER_")) return "runtime";
  if (text.includes("CircuitPython")) return "circuitpython";
  if (/waiting for download|ESP-ROM:|rst:0x|ets J(un|ul)/.test(text)) return "esp_rom";
  if (/>>>|MicroPython|raw REPL|Traceback|KeyboardInterrupt|SyntaxError/.test(text)) return "micropython";
  return "other";
}

/** Advice for Connect/Check status getting no HELLO back. */
export function explainNoHello(reply: BoardReply): Advice {
  const advice = NO_HELLO_ADVICE[reply];
  return { text: `No reply from the Thingstudio runtime. ${advice.text}`, doc: advice.doc };
}

/** Full URL of a docs page on the backend's local copy. `backendHttpBase` is
 * admin-api-client.ts's backendHttpBaseUrl() result, e.g. "http://127.0.0.1:8765". */
export function localDocUrl(backendHttpBase: string, doc: DocLink): string {
  return `${backendHttpBase}/docs/${doc.path}`;
}
