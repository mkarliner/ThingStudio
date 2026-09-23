// SPDX-License-Identifier: Apache-2.0
// Tests for ../src/app/port-choice.ts. Port shapes from a real macOS list (2026-09-23).

import { describe, expect, it } from "vitest";
import { choosePort } from "../src/app/port-choice.js";
import type { SerialPortInfo } from "../src/protocol/backend-transport.js";

const port = (device: string, vid: number | null = null): SerialPortInfo => ({
  device,
  description: "",
  manufacturer: null,
  vid,
  pid: vid === null ? null : 1,
  serial_number: null,
});

const BT = port("/dev/cu.Bluetooth-Incoming-Port");
const DBG = port("/dev/cu.debug-console");
const S2 = port("/dev/cu.usbmodem14201", 0x303a);
const PICO = port("/dev/cu.usbmodem1101", 0x2e8a);

describe("choosePort", () => {
  it("puts the board first and pre-selects it when it's the only USB device", () => {
    const c = choosePort([BT, DBG, S2], "");
    expect(c.ordered.map((p) => p.device)).toEqual([S2.device, BT.device, DBG.device]);
    expect(c.selected).toBe(S2.device);
  });

  it("doesn't guess between two boards", () => {
    expect(choosePort([BT, S2, PICO], "").selected).toBe("");
  });

  it("keeps the previous choice if that port is still there", () => {
    expect(choosePort([BT, S2, PICO], PICO.device).selected).toBe(PICO.device);
  });

  it("drops a previous choice that has gone, then applies the one-board rule", () => {
    expect(choosePort([BT, S2], PICO.device).selected).toBe(S2.device);
  });

  it("selects nothing when no USB device is plugged in", () => {
    expect(choosePort([BT, DBG], "").selected).toBe("");
    expect(choosePort([], "").selected).toBe("");
  });
});
