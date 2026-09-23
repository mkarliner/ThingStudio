// SPDX-License-Identifier: Apache-2.0
// editor/src/app/port-choice.ts
//
// Orders the backend's serial port list and picks which one to pre-select. Pure, so testable.
//
// Mike, 2026-09-23: "the editor should probably do a port scan on loading." A newcomer shouldn't have
// to know to click "⟳ ports" first, or pick their board out of a list that also holds macOS's
// Bluetooth-Incoming-Port and debug-console. Any port with a USB vendor ID is a real USB device
// (every supported board is one), so those go first; if there's exactly one, it's pre-selected.
// With several USB devices plugged in, nothing is guessed -- the user picks.

import type { SerialPortInfo } from "../protocol/backend-transport.js";

export interface PortChoice {
  /** USB devices first, then everything else; each group in the backend's order. */
  readonly ordered: readonly SerialPortInfo[];
  /** Device to pre-select, or "" to leave the choice to the user. */
  readonly selected: string;
}

export function isUsbPort(p: SerialPortInfo): boolean {
  return p.vid !== null && p.vid !== undefined;
}

/** `previous` is the device selected before this refresh; it stays selected if still present, so a
 * rescan never silently moves the user to a different board. */
export function choosePort(ports: readonly SerialPortInfo[], previous: string): PortChoice {
  const usb = ports.filter(isUsbPort);
  const ordered = [...usb, ...ports.filter((p) => !isUsbPort(p))];
  if (previous && ports.some((p) => p.device === previous)) return { ordered, selected: previous };
  return { ordered, selected: usb.length === 1 ? usb[0]!.device : "" };
}
