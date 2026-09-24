import { describe, expect, it } from "vitest";
import {
  DEFAULT_TCP_PORT,
  MANUAL_NETWORK_VALUE,
  hostnameProblem,
  networkOptionLabel,
  networkOptionValue,
  parseNetworkAddress,
  parsePortSelection,
  passwordProblem,
  wifiReadiness,
} from "../src/app/network-choice.js";

const board = { hostname: "kitchen", address: "192.168.1.42", port: 7462, chip: "ESP32", flow: null, wifiTransport: true, busy: false };

describe("network port menu values", () => {
  it("round-trips a discovered board", () => {
    expect(parsePortSelection(networkOptionValue(board))).toEqual({ kind: "network", host: "192.168.1.42", tcpPort: 7462 });
  });
  it("keeps serial ports, manual entry and empty apart", () => {
    expect(parsePortSelection("/dev/tty.usbmodem1")).toEqual({ kind: "serial", port: "/dev/tty.usbmodem1" });
    expect(parsePortSelection("COM3")).toEqual({ kind: "serial", port: "COM3" });
    expect(parsePortSelection(MANUAL_NETWORK_VALUE)).toEqual({ kind: "manual" });
    expect(parsePortSelection("")).toEqual({ kind: "none" });
    expect(parsePortSelection("net:not a host")).toEqual({ kind: "none" });
  });
  it("labels boards that can't take a connection yet", () => {
    expect(networkOptionLabel(board)).toBe("kitchen (192.168.1.42) -- WiFi");
    expect(networkOptionLabel({ ...board, wifiTransport: false })).toContain("no password set");
    expect(networkOptionLabel({ ...board, busy: true })).toContain("in use");
  });
});

describe("parseNetworkAddress", () => {
  it("adds .local to a bare name and lower-cases", () => {
    expect(parseNetworkAddress(" Kitchen ")).toEqual({ host: "kitchen.local", tcpPort: DEFAULT_TCP_PORT });
    expect(parseNetworkAddress("kitchen.local")).toEqual({ host: "kitchen.local", tcpPort: DEFAULT_TCP_PORT });
  });
  it("takes an IP and an optional port", () => {
    expect(parseNetworkAddress("10.0.0.5")).toEqual({ host: "10.0.0.5", tcpPort: DEFAULT_TCP_PORT });
    expect(parseNetworkAddress("10.0.0.5:9000")).toEqual({ host: "10.0.0.5", tcpPort: 9000 });
  });
  it("rejects junk", () => {
    for (const bad of ["", "   ", "10.0.0.256", "a b", "-x", "host:0", "host:70000", "host:abc", "under_score"]) {
      expect(parseNetworkAddress(bad), bad).toBeNull();
    }
  });
});

describe("wifiReadiness", () => {
  const hello = { hostname: "kitchen", hasWifi: true, authRequired: true };
  it("follows the definition's no-radio flag first", () => {
    expect(wifiReadiness(hello, false)).toBe("no_radio");
  });
  it("offers WiFi when the definition says nothing", () => {
    expect(wifiReadiness(hello, null)).toBe("ready");
    expect(wifiReadiness({ ...hello, authRequired: false }, null)).toBe("no_password");
  });
  it("spots an old runtime and a firmware without WiFi", () => {
    expect(wifiReadiness({ ...hello, hostname: null }, true)).toBe("old_runtime");
    expect(wifiReadiness({ ...hello, hasWifi: false }, null)).toBe("no_radio");
  });
});

describe("board settings checks", () => {
  it("matches board_settings.py's password rule", () => {
    expect(passwordProblem("short", "short")).not.toBeNull();
    expect(passwordProblem("x".repeat(65), "x".repeat(65))).not.toBeNull();
    expect(passwordProblem("correct horse", "correct hose")).toContain("match");
    expect(passwordProblem("correct horse", "correct horse")).toBeNull();
  });
  it("matches board_settings.py's hostname rule", () => {
    for (const good of ["kitchen", "ts-a1b2c3", "a", "x".repeat(32)]) expect(hostnameProblem(good), good).toBeNull();
    for (const bad of ["", "Kitchen", "-a", "a-", "a.b", "x".repeat(33)]) expect(hostnameProblem(bad), bad).not.toBeNull();
  });
});
