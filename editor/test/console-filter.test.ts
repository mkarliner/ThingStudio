// SPDX-License-Identifier: Apache-2.0
// editor/test/console-filter.test.ts -- the device console's Normal / Info / Debug level (2026-10-07).

import { describe, expect, it } from "vitest";
import { consoleLevel, savedConsoleLevel, shownAt } from "../src/app/console-filter.js";

describe("consoleLevel", () => {
  it("keeps flow output, warnings, errors and outcomes at normal", () => {
    for (const line of [
      "DEBUG node=4ab9 msg={'payload': True}",
      "hello from print()",
      "NET_WARN dropped 40 bytes of output",
      "NODE_ERROR node=657a type=OSError msg=...",
      '[NODE_ERROR] {"type":"NODE_ERROR"}',
      "E (25385) wifi:sta is connecting, cannot set config",
      "LISTENER_ERR bad base64 ValueError('incorrect padding',) -- recovering",
      "[deploy OK -- flow is running on the device]",
      "[flow status] no flow currently running on this board",
      "[compile warning] display_spi dc pin 2 on ESP32: Strapping pin.",
      '[wifi] ts-fd3a04 only accepts USB until it has a password. Set one in "Tools → Board settings…".',
      "[install runtime] checking the board on /dev/cu.usbserial-110, then installing the runtime -- this resets the board",
      "[install runtime OK -- board reset into the new runtime.]",
      '[ports] found a board on /dev/cu.usbserial-110 -- click "Connect"',
    ]) {
      expect(consoleLevel(line), line).toBe("normal");
    }
  });

  it("puts routine reports at info", () => {
    for (const line of [
      "NET_INFO mqtt: waiting for WiFi, station status 1001",
      "NET_LISTENING 192.168.10.247:7462 (esp-2.local)",
      "LISTENER_BOOTING -- Ctrl-C within 3s drops to REPL instead of starting the listener",
      "LISTENER_BOOT no persisted flow at /_flow.mpy -- nothing to resume",
      "LISTENER_READY",
      '[board] Target: ESP32 (detected from "Generic ESP32 module with ESP32").',
      "[version check] device runtime 9.0.0 is compatible with this editor (targets 9.0.0).",
      "[memory] MicroPython 99 KB free · ESP-IDF heap 78 KB free, largest block 52 KB",
      "[libraries] sending st7789py (4 KB)",
      "[install runtime] 3/12 runtime.mpy",
    ]) {
      expect(consoleLevel(line), line).toBe("info");
    }
  });

  it("puts raw protocol, the boot ROM banner and tool chatter at debug", () => {
    for (const line of [
      '[HELLO] {"type":"HELLO"}',
      '[DEPLOY_ACK] {"type":"DEPLOY_ACK"}',
      "NODE_STATUS node=26e0 state=connected text=192.168.10.247",
      "ets Jul 29 2019 12:21:46",
      "rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)",
      "configsip: 0, SPIWP:0xee",
      "clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00",
      "mode:DIO, clock div:2",
      "load:0x3fff0030,len:4200",
      "entry 0x400805a8",
      "I (512) wifi:mode : sta (24:0a:c4:00:00:01)",
      "[runtime build check] device runtime build 0d10ac2 matches this editor's (0d10ac2).",
      "[compile] targeting mpy-cross -march=xtensawin (auto, from the ESP32 definition)",
      "[compiled -- 2630 bytes of bytecode]",
      "[backend] relay opened /dev/cu.usbserial-110",
    ]) {
      expect(consoleLevel(line), line).toBe("debug");
    }
  });

  it("keeps the backend's own back-again note", () => {
    expect(consoleLevel("[backend] back. If you rebuilt the editor, save your flow and reload this page to use the new build.", "ok")).toBe("normal");
  });

  it("never hides a line logged as an error", () => {
    expect(consoleLevel("[runtime build check] mismatch", "err")).toBe("normal");
    expect(consoleLevel("NET_INFO something", "err")).toBe("normal");
  });
});

describe("shownAt", () => {
  it("shows a row at its own level and every busier one", () => {
    expect(shownAt("normal", "normal")).toBe(true);
    expect(shownAt("info", "normal")).toBe(false);
    expect(shownAt("info", "info")).toBe(true);
    expect(shownAt("debug", "info")).toBe(false);
    expect(shownAt("debug", "debug")).toBe(true);
  });
});

describe("savedConsoleLevel", () => {
  it("reads the saved level, else carries over the old Verbose switch, else normal", () => {
    expect(savedConsoleLevel("info", "1")).toBe("info");
    expect(savedConsoleLevel(null, "1")).toBe("debug");
    expect(savedConsoleLevel(null, "0")).toBe("normal");
    expect(savedConsoleLevel("bogus", null)).toBe("normal");
  });
});
