// SPDX-License-Identifier: Apache-2.0
// editor/src/app/connect-error-help.ts
//
// Turns a raw connect-failure message from the backend-relay path into one
// with a concrete workaround appended, per road-to-mvp.md's own fixed
// decision: "no attempt to guarantee connects on every board... failures
// give a clear message and suggested workarounds (standing order)."
//
// Scope: backend-relay ("via backend") connect failures only -- direct
// WebSerial stays the frozen/hidden fallback (decisions/backend.md's
// 2026-09-08 entry: "no new investment" there, its connModeSelect option
// already hidden in index.html), so this isn't wired into that path.
//
// serial_relay.py's SerialRelayError always looks like:
//   "NODE_ERROR: serial <operation> failed on <port>: <cause>"
// where <cause> is Python's str(exc) for the underlying SerialException/
// OSError -- exact wording is platform- and pyserial-version-dependent, so
// this is deliberately a best-effort substring match, not a structured
// error code. A pattern that doesn't match falls through to a generic
// suggestion rather than leaving the user with bare exception text and no
// next step -- MVP acceptance bar is "no silent failure," not "an exact
// diagnosis every time."
//
// The no-runtime-installed case (a SyntaxError surfacing after connect,
// not a connect *failure*) is handled separately at the HELLO-timeout call
// site in main.ts -- a real incident, not a guess:
// docs/working-notes/learnings/hardware-bringup-hil-rig.md's 2026-09-18
// entry.

const KNOWN_CAUSES: { test: (lower: string) => boolean; hint: string }[] = [
  {
    test: (m) => m.includes("permission denied") || m.includes("access is denied"),
    hint:
      "port access refused: replug the board, check port permissions, close other serial programs",
  },
  {
    test: (m) => m.includes("resource busy") || m.includes("already open") || m.includes("in use"),
    hint:
      "port in use: close other serial monitors, IDEs or editor tabs on this board",
  },
  {
    test: (m) =>
      m.includes("no such file or directory") || m.includes("cannot find the file") || m.includes("could not open port"),
    hint:
      "board gone from that port: check the cable, ⟳ the port list, connect again",
  },
];

const FALLBACK_HINT = "check the board is plugged in and powered; if it repeats, try another cable or port";

/** `rawMessage` is whatever `err.message` was on the rejected connectPort()/open()
 * promise -- normally the backend's NODE_ERROR text verbatim. Always returns the raw
 * message with a workaround appended, never just a hint on its own, so the original
 * NODE_ERROR text (useful for a bug report) is never lost. */
export function explainBackendConnectError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  const known = KNOWN_CAUSES.find((c) => c.test(lower));
  const hint = known?.hint ?? FALLBACK_HINT;
  return `${rawMessage} (${hint})`;
}
