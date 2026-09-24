// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/target.ts
//
// Works out which processor (and, if known, which board) a flow is being
// compiled for, and flattens the two definitions into one Target the pin
// checks read. Sources, in order: the Board menu's manual pick, then the
// connected board's HELLO chipType, then nothing (pin-check.ts then falls
// back to the widest known range and says so).
//
// HELLO's chipType is MicroPython's sys.implementation._machine,
// "<board name> with <MCU name>" (e.g. "LOLIN_S2_MINI with ESP32-S2FN4R2",
// "Raspberry Pi Pico W with RP2040", "Generic ESP32 module with ESP32").
// Board `match` strings compare exactly (case-insensitive) with the part
// before " with " -- a substring match would let "Raspberry Pi Pico" claim
// a Pico W. Processor `match` strings are substrings of the MCU part, with
// case and punctuation ignored ("ESP32S2" matches "ESP32-S2FN4R2"), and the
// longest match wins so "ESP32" never beats "ESP32S2".

import { formatPinSet, type BoardDef, type DefinitionSet, type ProcessorDef } from "./definitions.js";

export interface Target {
  readonly processor: ProcessorDef;
  readonly board: BoardDef | null;
  /** "LOLIN S2 Mini (ESP32-S2)" or "ESP32-S2". */
  readonly label: string;
  readonly gpio: ReadonlySet<number>;
  readonly inputOnly: ReadonlySet<number>;
  readonly noPull: ReadonlySet<number>;
  /** Board entries win over the processor's for the same pin. */
  readonly reserved: ReadonlyMap<number, string>;
  readonly avoid: ReadonlyMap<number, string>;
  /** GPIO -> board labels ("LED"). Empty without a board. */
  readonly pinLabels: ReadonlyMap<number, readonly string[]>;
}

/** Board menu value: "auto", "board:<id>" or "processor:<id>". */
export type TargetChoice = string;

export interface TargetResolution {
  readonly target: Target | null;
  readonly how: "manual" | "detected" | "none";
  /** One line for the console: what was picked and why, or why nothing was. */
  readonly note: string;
  /** Set when a manual pick disagrees with the connected board. */
  readonly mismatch: string | null;
}

export function buildTarget(processor: ProcessorDef, board: BoardDef | null): Target {
  const gpio = board?.gpio ?? processor.gpio;
  const reserved = new Map<number, string>();
  const avoid = new Map<number, string>();
  for (const [p, r] of processor.avoid) if (gpio.has(p)) avoid.set(p, r);
  for (const [p, r] of board?.avoid ?? []) avoid.set(p, r);
  for (const [p, r] of processor.reserved) if (gpio.has(p)) reserved.set(p, r);
  for (const [p, r] of board?.reserved ?? []) reserved.set(p, r);
  const pinLabels = new Map<number, string[]>();
  for (const [label, p] of board?.pins ?? []) {
    if (!pinLabels.has(p)) pinLabels.set(p, []);
    pinLabels.get(p)!.push(label);
  }
  // A pin the board labels is wired to something on purpose (the CYD's
  // display DC is strapping pin 2), so the processor's generic warning for
  // it is noise. The board's own avoid entries still apply.
  for (const p of pinLabels.keys()) if (!board?.avoid.has(p)) avoid.delete(p);
  for (const p of reserved.keys()) avoid.delete(p);
  return {
    processor,
    board,
    label: board ? `${board.name} (${processor.name})` : processor.name,
    gpio,
    inputOnly: new Set([...processor.inputOnly].filter((p) => gpio.has(p))),
    noPull: new Set([...processor.noPull].filter((p) => gpio.has(p))),
    reserved,
    avoid,
    pinLabels,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitChipType(chipType: string): { boardPart: string; mcuPart: string } {
  const at = chipType.lastIndexOf(" with ");
  if (at < 0) return { boardPart: chipType.trim(), mcuPart: chipType.trim() };
  return { boardPart: chipType.slice(0, at).trim(), mcuPart: chipType.slice(at + " with ".length).trim() };
}

/** The board and/or processor a HELLO chipType names, or nulls. */
export function detectFromChipType(defs: DefinitionSet, chipType: string): { board: BoardDef | null; processor: ProcessorDef | null } {
  const { boardPart, mcuPart } = splitChipType(chipType);
  const boardKey = boardPart.toLowerCase();
  for (const board of defs.boards.values()) {
    if (board.match.some((m) => m.toLowerCase() === boardKey)) {
      return { board, processor: defs.processors.get(board.processor) ?? null };
    }
  }
  const mcu = normalize(mcuPart);
  let best: ProcessorDef | null = null;
  let bestLen = 0;
  for (const proc of defs.processors.values()) {
    for (const m of proc.match) {
      const n = normalize(m);
      if (n !== "" && mcu.includes(n) && n.length > bestLen) {
        best = proc;
        bestLen = n.length;
      }
    }
  }
  return { board: null, processor: best };
}

export function resolveTarget(defs: DefinitionSet, choice: TargetChoice, chipType: string | null): TargetResolution {
  const detected = chipType ? detectFromChipType(defs, chipType) : { board: null, processor: null };

  if (choice !== "auto") {
    const [kind, id] = choice.split(":", 2) as [string, string | undefined];
    let target: Target | null = null;
    if (kind === "board" && id && defs.boards.has(id)) {
      const board = defs.boards.get(id)!;
      const proc = defs.processors.get(board.processor);
      if (proc) target = buildTarget(proc, board);
    } else if (kind === "processor" && id && defs.processors.has(id)) {
      target = buildTarget(defs.processors.get(id)!, null);
    }
    if (target) {
      const mismatch =
        detected.processor && detected.processor.id !== target.processor.id
          ? `The Board menu says ${target.label}, but the connected board reports "${chipType}" (${detected.processor.name}).`
          : null;
      return { target, how: "manual", note: `Target: ${target.label} (picked in the Board menu).`, mismatch };
    }
    // A pick that no longer exists (e.g. its user file became invalid): say so, then carry on as Auto.
    const fallback = resolveTarget(defs, "auto", chipType);
    return { ...fallback, note: `The Board menu's choice "${choice}" isn't defined any more. ${fallback.note}` };
  }

  if (detected.processor) {
    const target = buildTarget(detected.processor, detected.board);
    return { target, how: "detected", note: `Target: ${target.label} (detected from "${chipType}").`, mismatch: null };
  }
  if (chipType) {
    return {
      target: null,
      how: "none",
      note: `The connected board reports "${chipType}", which matches no processor definition. Pick your board in the Board menu.`,
      mismatch: null,
    };
  }
  return { target: null, how: "none", note: "No board connected and none picked in the Board menu.", mismatch: null };
}

/**
 * The Board menu value to use once a board connects. A manual pick for a different processor than the
 * connected board goes back to Auto (Mike, 2026-09-24): a different processor means a different board,
 * and keeping the pick would check pins and compile native code for the wrong chip. A pick for the same
 * processor stays, since that's how a board that reports only its processor (the CYD) gets picked.
 * `note` says what changed, or is null when nothing did.
 */
export function choiceForConnectedBoard(
  defs: DefinitionSet,
  choice: TargetChoice,
  chipType: string,
): { choice: TargetChoice; note: string | null } {
  const r = resolveTarget(defs, choice, chipType);
  if (r.how !== "manual" || !r.mismatch || !r.target) return { choice, note: null };
  const found = resolveTarget(defs, "auto", chipType).target;
  return {
    choice: "auto",
    note:
      `The Board menu was set to ${r.target.label}, but the connected board reports "${chipType}". ` +
      `Switched it back to Auto${found ? ` (${found.label})` : ""}.`,
  };
}

/** Every pin any known processor has -- the fallback range when there's no target. */
export function widestGpio(defs: DefinitionSet): ReadonlySet<number> {
  const all = new Set<number>();
  for (const p of defs.processors.values()) for (const g of p.gpio) all.add(g);
  return all;
}

export function describeTarget(target: Target): string {
  return `${target.label}: GPIO ${formatPinSet(target.gpio)}`;
}
