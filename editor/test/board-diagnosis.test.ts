// SPDX-License-Identifier: Apache-2.0
// Tests for ../src/app/board-diagnosis.ts. The silent/ESP32-S2 cases are the real 2026-09-23
// transcript; the SyntaxError case is the real CYD one (learnings/hardware-bringup-hil-rig.md).

import { describe, expect, it } from "vitest";
import {
  DOC_INSTALL_MICROPYTHON,
  classifyDebugLines,
  explainInstallFailure,
  explainNoHello,
  localDocUrl,
} from "../src/app/board-diagnosis.js";

const SILENT_S2 =
  "NODE_ERROR: runtime install failed at entering raw REPL: timed out waiting for " +
  "b'raw REPL; CTRL-B to exit\\r\\n>', last seen: b''";

describe("explainInstallFailure", () => {
  it("points a silent board at installing MicroPython, keeping the raw error", () => {
    const out = explainInstallFailure(SILENT_S2, "silent");
    expect(out.doc).toBe(DOC_INSTALL_MICROPYTHON);
    expect(out.text).toContain("doesn't have MicroPython");
    expect(out.text).toContain(SILENT_S2);
  });

  it("tells a board stuck in its ROM bootloader to reset without BOOT", () => {
    expect(explainInstallFailure("x", "esp_rom").text).toContain("without holding BOOT");
  });

  it("returns the raw message unchanged with no diagnosis (failure mid-push)", () => {
    expect(explainInstallFailure("NODE_ERROR: boom", null)).toEqual({ text: "NODE_ERROR: boom" });
  });

  it("returns the raw message unchanged for an unknown diagnosis value", () => {
    expect(explainInstallFailure("NODE_ERROR: boom", "something-new")).toEqual({ text: "NODE_ERROR: boom" });
  });
});

describe("classifyDebugLines", () => {
  it("no lines at all is silent", () => {
    expect(classifyDebugLines([])).toBe("silent");
    expect(classifyDebugLines(["", "  "])).toBe("silent");
  });

  it("a SyntaxError echo means MicroPython with no runtime", () => {
    const lines = [">>> F64:AAIKoA==", "Traceback (most recent call last):", '  File "<stdin>", line 1', "SyntaxError: invalid syntax"];
    expect(classifyDebugLines(lines)).toBe("micropython");
  });

  it("listener boot lines mean the runtime is there but still starting", () => {
    expect(classifyDebugLines(["LISTENER_BOOTING"])).toBe("runtime");
  });

  it("recognises CircuitPython before the shared >>> prompt", () => {
    expect(classifyDebugLines(["Adafruit CircuitPython 9.1.4 on 2024-09-17", ">>> "])).toBe("circuitpython");
  });

  it("recognises ESP ROM bootloader output", () => {
    expect(classifyDebugLines(["ESP-ROM:esp32s2-rc4-20191025", "waiting for download"])).toBe("esp_rom");
  });

  it("anything else is other firmware", () => {
    expect(classifyDebugLines(["Hello from Arduino loop 42"])).toBe("other");
  });
});

describe("explainNoHello", () => {
  it("offers Install runtime when MicroPython is there", () => {
    expect(explainNoHello("micropython").text).toContain("Install runtime");
  });

  it("no longer points at a terminal script", () => {
    for (const r of ["silent", "micropython", "runtime", "circuitpython", "esp_rom", "other"] as const) {
      expect(explainNoHello(r).text).not.toContain("deploy_runtime.py");
    }
  });
});

describe("localDocUrl", () => {
  it("points at the backend's /docs/ copy", () => {
    expect(localDocUrl("http://127.0.0.1:8765", DOC_INSTALL_MICROPYTHON)).toBe(
      "http://127.0.0.1:8765/docs/installing-micropython/",
    );
  });

  it("says each silent case once, not twice", () => {
    expect(explainNoHello("silent").text).not.toMatch(/didn't reply.*didn't reply/);
  });

  it("tells the user to disconnect before flashing when advice sends them to install MicroPython", () => {
    for (const r of ["silent", "circuitpython", "esp_rom", "other"] as const) {
      expect(explainNoHello(r).text).toContain("Disconnect");
    }
    expect(explainNoHello("micropython").text).not.toContain("Disconnect");
  });
});
