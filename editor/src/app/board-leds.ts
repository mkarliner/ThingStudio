// SPDX-License-Identifier: Apache-2.0
// editor/src/app/board-leds.ts
//
// One console line naming the board's LED pins, from its definition (Mike, 2026-11-18: "which gpio to use for
// the blink" was the hurdle once the board ran). Says what the definition says and nothing more: the editor never
// changes a flow's pin itself. A pin counts as an LED when its name has LED in it (LED, LED_RED, RGB_LED, CHG_LED).

import { pinLabel, type BoardDef, type ProcessorDef } from "../definitions/definitions.js";

/** "LEDs: LED_RED = GPIO 4, LED_GREEN = GPIO 16", a hint when only the processor is known, or null. */
export function ledPinsLine(target: { readonly board: BoardDef | null; readonly processor: ProcessorDef } | null): string | null {
  if (!target) return null;
  if (!target.board) {
    return `No board picked, so no LED pin is known for this ${target.processor.name}. Pick your board in the Board menu to see its LED pins.`;
  }
  const leds = [...target.board.pins].filter(([name]) => /LED/i.test(name));
  if (leds.length === 0) return `${target.board.name}: its definition names no LED pin.`;
  const list = leds.map(([name, pin]) => `${name} = ${pinLabel(pin)}`).join(", ");
  return `${target.board.name} LEDs: ${list}. Use one in gpio out to blink it.`;
}
