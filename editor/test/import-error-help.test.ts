// SPDX-License-Identifier: Apache-2.0
// editor/test/import-error-help.test.ts -- advice for a deploy that fails on a missing module (2026-10-07).

import { describe, expect, it } from "vitest";
import { explainDeployImportError, missingModuleName, networkWarningBeforeDeploy } from "../src/app/import-error-help.js";

const LIBS = new Set(["mqtt_as", "st7789py"]);

describe("missingModuleName", () => {
  it("reads MicroPython's ImportError wording", () => {
    expect(missingModuleName("no module named 'socket'")).toBe("socket");
    expect(missingModuleName("ImportError: no module named 'a.b'")).toBe("a.b");
    expect(missingModuleName("can't import name x")).toBeNull();
  });
});

describe("explainDeployImportError", () => {
  it("explains a missing networking module as a board without WiFi (the plain-Pico case)", () => {
    const advice = explainDeployImportError("no module named 'socket'", LIBS)!;
    expect(advice.text).toContain("needs networking");
    expect(advice.text).toContain("'socket'");
    expect(advice.text).toContain("previous flow is still running");
    expect(advice.doc?.path).toBe("debugging/#module-missing-on-the-board");
  });

  it("names any other firmware module and points at the per-port docs", () => {
    const advice = explainDeployImportError("no module named 'esp32'", LIBS)!;
    expect(advice.text).toContain("imports 'esp32'");
    expect(advice.text).toContain("docs.micropython.org");
  });

  it("treats Thingstudio's own library differently: resend, then reinstall", () => {
    const advice = explainDeployImportError("no module named 'mqtt_as'", LIBS)!;
    expect(advice.text).toContain("Thingstudio's mqtt_as library");
    expect(advice.text).toContain("Install runtime");
  });

  it("gives nothing for a message that names no module", () => {
    expect(explainDeployImportError("something else", LIBS)).toBeNull();
  });
});

describe("networkWarningBeforeDeploy", () => {
  const mods = new Set(["runtime", "mqtt_as", "network", "machine"]);
  it("warns when the board said it has no WiFi and the flow uses networking", () => {
    expect(networkWarningBeforeDeploy(mods, false)).toContain("mqtt_as, network");
  });
  it("stays quiet when the board has WiFi, or hasn't said", () => {
    expect(networkWarningBeforeDeploy(mods, true)).toBeNull();
    expect(networkWarningBeforeDeploy(mods, null)).toBeNull();
  });
  it("stays quiet for a flow without networking", () => {
    expect(networkWarningBeforeDeploy(new Set(["runtime", "machine"]), false)).toBeNull();
  });
});
