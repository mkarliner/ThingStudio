// SPDX-License-Identifier: Apache-2.0
// Tests for ../src/app/connect-error-help.ts. Real NODE_ERROR strings
// backend/src/thingstudio_backend/serial_relay.py would actually produce
// (pyserial's own SerialException wrapping the platform OSError), not
// invented shapes -- see that module's SerialRelayError.__init__ for the
// "NODE_ERROR: serial <operation> failed on <port>: <cause>" format.

import { describe, expect, it } from "vitest";
import { explainBackendConnectError } from "../src/app/connect-error-help.js";

describe("explainBackendConnectError", () => {
  it("adds a permission hint for a Linux/macOS permission-denied cause", () => {
    const raw = "NODE_ERROR: serial open failed on /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0'";
    const out = explainBackendConnectError(raw);
    expect(out).toContain(raw);
    expect(out.toLowerCase()).toContain("permission");
  });

  it("adds a permission hint for the Windows access-denied wording", () => {
    const out = explainBackendConnectError("NODE_ERROR: serial open failed on COM3: Access is denied.");
    expect(out.toLowerCase()).toContain("close other serial programs");
  });

  it("adds a port-busy hint for a macOS resource-busy cause", () => {
    const raw =
      "NODE_ERROR: serial open failed on /dev/cu.usbserial-1410: [Errno 16] could not open port " +
      "/dev/cu.usbserial-1410: [Errno 16] Resource busy: '/dev/cu.usbserial-1410'";
    const out = explainBackendConnectError(raw);
    expect(out.toLowerCase()).toContain("port in use");
  });

  it("adds a device-vanished hint when the port no longer exists", () => {
    const raw = "NODE_ERROR: serial open failed on /dev/ttyUSB0: [Errno 2] No such file or directory: '/dev/ttyUSB0'";
    const out = explainBackendConnectError(raw);
    expect(out.toLowerCase()).toContain("⟳ the port list");
  });

  it("falls back to a generic suggestion for an unrecognized cause, never dropping the raw text", () => {
    const raw = "NODE_ERROR: serial open failed on /dev/ttyUSB0: some new pyserial error nobody has seen yet";
    const out = explainBackendConnectError(raw);
    expect(out).toContain(raw);
    expect(out.toLowerCase()).toContain("plugged in and powered");
  });

  it("is case-insensitive when matching known causes", () => {
    const out = explainBackendConnectError("NODE_ERROR: serial open failed on COM3: PERMISSION DENIED");
    expect(out.toLowerCase()).toContain("permission");
  });
});
