// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/definitions.ts
//
// Processor and board definitions (MVP item 4, docs/working-notes/decisions/
// chip-board-definitions.md). A definition is a small hand-writable JSON
// file: built-ins live next to this file (processors/*.json, boards/*.json,
// loaded by builtin.ts), and a user's own files live in
// ~/.thingstudio/processors/ and ~/.thingstudio/boards/ (served by the
// backend's GET /api/definitions). The id is the file name without `.json`,
// never a field inside the file, so the two can't disagree. A user file with
// the same id as a built-in replaces it whole -- no field-level merging.
//
// This module is pure: parsing, validating and merging only. It doesn't
// fetch anything or know about the DOM, so it's unit-testable and usable
// from dev-tools scripts. Validation is strict on purpose: these files are
// written by hand, and a typo'd key ("reserverd") silently ignored would
// mean a pin check silently not happening. Every problem is reported with
// the file it came from, never dropped (presets.md's "invalid must be
// flagged loudly" rule).

/** Pin list as written in a file: numbers, or "a-b" range strings. */
export type PinListJson = Array<number | string>;
/** Pin -> reason, keyed by "n" or "a-b". */
export type PinReasonsJson = Record<string, string>;

export interface SpiBusDef {
  /** Pins that reach this bus without the GPIO matrix (ESP32 family). Not a restriction. */
  readonly fastPins?: { readonly sck?: number; readonly mosi?: number; readonly miso?: number };
  /** When present, the ONLY pins this bus can use per role (RP2 family). */
  readonly pins?: { readonly sck?: readonly number[]; readonly mosi?: readonly number[]; readonly miso?: readonly number[] };
}

export interface I2cBusDef {
  /** When present, the ONLY pins this bus can use per role (RP2 family). */
  readonly pins?: { readonly sda?: readonly number[]; readonly scl?: readonly number[] };
}

export interface ProcessorDef {
  readonly id: string;
  readonly name: string;
  /** Substrings matched against the MCU part of HELLO's chipType (after " with "). */
  readonly match: readonly string[];
  readonly nativeArch: string;
  readonly nativeArchConfirmed: boolean;
  readonly gpio: ReadonlySet<number>;
  readonly inputOnly: ReadonlySet<number>;
  readonly noPull: ReadonlySet<number>;
  readonly reserved: ReadonlyMap<number, string>;
  readonly avoid: ReadonlyMap<number, string>;
  readonly spi: { readonly maxHz?: number; readonly otherPinsMaxHz?: number; readonly buses: ReadonlyMap<number, SpiBusDef> } | null;
  readonly i2c: { readonly buses: ReadonlyMap<number, I2cBusDef> } | null;
  readonly notes: string;
}

export interface BoardDef {
  readonly id: string;
  readonly name: string;
  readonly processor: string;
  /** Exact (case-insensitive) matches for the board part of HELLO's chipType (before " with "). */
  readonly match: readonly string[];
  /** Label -> GPIO number. UI only; flows always store GPIO numbers. */
  readonly pins: ReadonlyMap<string, number>;
  /** Narrows the processor's gpio set when present. */
  readonly gpio: ReadonlySet<number> | null;
  readonly reserved: ReadonlyMap<number, string>;
  readonly avoid: ReadonlyMap<number, string>;
  readonly notes: string;
}

export type DefinitionKind = "processor" | "board";

/** One definition file as it arrived, before validation. */
export interface RawDefinitionFile {
  readonly kind: DefinitionKind;
  /** File name without .json. */
  readonly id: string;
  /** Where it came from, for messages: "built-in" or "~/.thingstudio/boards/x.json". */
  readonly source: string;
  /** Parsed JSON, or null when the file didn't parse. */
  readonly data: unknown;
  /** Set when the file didn't even parse (the backend reports this). */
  readonly parseError?: string | null;
}

export interface DefinitionProblem {
  readonly kind: DefinitionKind;
  readonly id: string;
  readonly source: string;
  readonly message: string;
}

export interface DefinitionSet {
  readonly processors: ReadonlyMap<string, ProcessorDef>;
  readonly boards: ReadonlyMap<string, BoardDef>;
  /** Invalid files, and user files that replaced a built-in. Show every one. */
  readonly problems: readonly DefinitionProblem[];
  readonly overrides: readonly { kind: DefinitionKind; id: string; source: string }[];
}

export class DefinitionError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_PIN = 255;

// ---------------------------------------------------------------------
// Small parsers. Each throws DefinitionError with a message naming the key.
// ---------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new DefinitionError(`${where}: unknown key "${key}" (allowed: ${allowed.join(", ")})`);
    }
  }
}

function pinNumber(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_PIN) {
    throw new DefinitionError(`${where}: ${JSON.stringify(v)} isn't a GPIO number`);
  }
  return v;
}

/** "5" -> [5], "6-11" -> [6..11]. */
export function parsePinSpec(spec: string, where: string): number[] {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(spec);
  if (!m) throw new DefinitionError(`${where}: "${spec}" isn't a pin or a range like "0-19"`);
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (a > MAX_PIN || b > MAX_PIN || b < a) throw new DefinitionError(`${where}: "${spec}" isn't a valid range`);
  const out: number[] = [];
  for (let p = a; p <= b; p++) out.push(p);
  return out;
}

function pinList(v: unknown, where: string): number[] {
  if (!Array.isArray(v)) throw new DefinitionError(`${where}: must be a list, e.g. [0, 2, "4-7"]`);
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === "number") out.push(pinNumber(item, where));
    else if (typeof item === "string") out.push(...parsePinSpec(item, where));
    else throw new DefinitionError(`${where}: ${JSON.stringify(item)} isn't a pin number or range`);
  }
  return out;
}

function pinReasons(v: unknown, where: string): Map<number, string> {
  if (!isObject(v)) throw new DefinitionError(`${where}: must be an object like {"6-11": "reason"}`);
  const out = new Map<number, string>();
  for (const [spec, reason] of Object.entries(v)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new DefinitionError(`${where}."${spec}": the reason must be a non-empty string`);
    }
    for (const p of parsePinSpec(spec, where)) out.set(p, reason);
  }
  return out;
}

function str(v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new DefinitionError(`${where}: must be a non-empty string`);
  return v;
}

function strList(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string" || s.trim() === "")) {
    throw new DefinitionError(`${where}: must be a list of strings (may be empty)`);
  }
  return v as string[];
}

function positiveInt(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new DefinitionError(`${where}: must be a positive whole number`);
  return v;
}

function busId(key: string, where: string): number {
  if (!/^\d+$/.test(key)) throw new DefinitionError(`${where}: bus id "${key}" must be a number, e.g. "1"`);
  return Number(key);
}

function subset(pins: Iterable<number>, gpio: ReadonlySet<number>, where: string): void {
  for (const p of pins) {
    if (!gpio.has(p)) throw new DefinitionError(`${where}: GPIO ${p} isn't in "gpio"`);
  }
}

// ---------------------------------------------------------------------
// Processor and board validation
// ---------------------------------------------------------------------

const PROCESSOR_KEYS = ["name", "match", "nativeArch", "nativeArchConfirmed", "gpio", "inputOnly", "noPull", "reserved", "avoid", "spi", "i2c", "notes"];
const BOARD_KEYS = ["name", "processor", "match", "pins", "gpio", "reserved", "avoid", "notes"];

function parseSpi(v: unknown, gpio: ReadonlySet<number>): ProcessorDef["spi"] {
  if (!isObject(v)) throw new DefinitionError(`"spi": must be an object`);
  checkKeys(v, ["maxHz", "otherPinsMaxHz", "buses"], `"spi"`);
  const maxHz = v.maxHz === undefined ? undefined : positiveInt(v.maxHz, `"spi.maxHz"`);
  const otherPinsMaxHz = v.otherPinsMaxHz === undefined ? undefined : positiveInt(v.otherPinsMaxHz, `"spi.otherPinsMaxHz"`);
  if (!isObject(v.buses)) throw new DefinitionError(`"spi.buses": must be an object like {"1": {}}`);
  const buses = new Map<number, SpiBusDef>();
  for (const [key, raw] of Object.entries(v.buses)) {
    const where = `"spi.buses.${key}"`;
    const id = busId(key, where);
    if (!isObject(raw)) throw new DefinitionError(`${where}: must be an object (use {} for "any pins")`);
    checkKeys(raw, ["fastPins", "pins"], where);
    const bus: { fastPins?: SpiBusDef["fastPins"]; pins?: SpiBusDef["pins"] } = {};
    if (raw.fastPins !== undefined) {
      if (!isObject(raw.fastPins)) throw new DefinitionError(`${where}.fastPins: must be an object`);
      checkKeys(raw.fastPins, ["sck", "mosi", "miso"], `${where}.fastPins`);
      const fp: { sck?: number; mosi?: number; miso?: number } = {};
      for (const role of ["sck", "mosi", "miso"] as const) {
        if (raw.fastPins[role] !== undefined) fp[role] = pinNumber(raw.fastPins[role], `${where}.fastPins.${role}`);
      }
      subset(Object.values(fp), gpio, `${where}.fastPins`);
      bus.fastPins = fp;
    }
    if (raw.pins !== undefined) {
      if (!isObject(raw.pins)) throw new DefinitionError(`${where}.pins: must be an object`);
      checkKeys(raw.pins, ["sck", "mosi", "miso"], `${where}.pins`);
      const pins: { sck?: number[]; mosi?: number[]; miso?: number[] } = {};
      for (const role of ["sck", "mosi", "miso"] as const) {
        if (raw.pins[role] !== undefined) {
          pins[role] = pinList(raw.pins[role], `${where}.pins.${role}`);
          subset(pins[role]!, gpio, `${where}.pins.${role}`);
        }
      }
      bus.pins = pins;
    }
    buses.set(id, bus);
  }
  return { maxHz, otherPinsMaxHz, buses };
}

function parseI2c(v: unknown, gpio: ReadonlySet<number>): ProcessorDef["i2c"] {
  if (!isObject(v)) throw new DefinitionError(`"i2c": must be an object`);
  checkKeys(v, ["buses"], `"i2c"`);
  if (!isObject(v.buses)) throw new DefinitionError(`"i2c.buses": must be an object like {"0": {}}`);
  const buses = new Map<number, I2cBusDef>();
  for (const [key, raw] of Object.entries(v.buses)) {
    const where = `"i2c.buses.${key}"`;
    const id = busId(key, where);
    if (!isObject(raw)) throw new DefinitionError(`${where}: must be an object (use {} for "any pins")`);
    checkKeys(raw, ["pins"], where);
    const bus: { pins?: I2cBusDef["pins"] } = {};
    if (raw.pins !== undefined) {
      if (!isObject(raw.pins)) throw new DefinitionError(`${where}.pins: must be an object`);
      checkKeys(raw.pins, ["sda", "scl"], `${where}.pins`);
      const pins: { sda?: number[]; scl?: number[] } = {};
      for (const role of ["sda", "scl"] as const) {
        if (raw.pins[role] !== undefined) {
          pins[role] = pinList(raw.pins[role], `${where}.pins.${role}`);
          subset(pins[role]!, gpio, `${where}.pins.${role}`);
        }
      }
      bus.pins = pins;
    }
    buses.set(id, bus);
  }
  return { buses };
}

export function parseProcessor(id: string, data: unknown): ProcessorDef {
  if (!ID_RE.test(id)) throw new DefinitionError(`file name "${id}" must be lowercase letters, digits, "-" or "_"`);
  if (!isObject(data)) throw new DefinitionError(`must be a JSON object`);
  checkKeys(data, PROCESSOR_KEYS, "processor");
  for (const required of ["name", "match", "nativeArch", "gpio"]) {
    if (data[required] === undefined) throw new DefinitionError(`missing required key "${required}"`);
  }
  const gpio = new Set(pinList(data.gpio, `"gpio"`));
  if (gpio.size === 0) throw new DefinitionError(`"gpio": must list at least one pin`);
  const inputOnly = new Set(data.inputOnly === undefined ? [] : pinList(data.inputOnly, `"inputOnly"`));
  const noPull = new Set(data.noPull === undefined ? [] : pinList(data.noPull, `"noPull"`));
  const reserved = data.reserved === undefined ? new Map<number, string>() : pinReasons(data.reserved, `"reserved"`);
  const avoid = data.avoid === undefined ? new Map<number, string>() : pinReasons(data.avoid, `"avoid"`);
  subset(inputOnly, gpio, `"inputOnly"`);
  subset(noPull, gpio, `"noPull"`);
  subset(reserved.keys(), gpio, `"reserved"`);
  subset(avoid.keys(), gpio, `"avoid"`);
  if (data.nativeArchConfirmed !== undefined && typeof data.nativeArchConfirmed !== "boolean") {
    throw new DefinitionError(`"nativeArchConfirmed": must be true or false`);
  }
  return {
    id,
    name: str(data.name, `"name"`),
    match: strList(data.match, `"match"`),
    nativeArch: str(data.nativeArch, `"nativeArch"`),
    nativeArchConfirmed: data.nativeArchConfirmed !== false,
    gpio,
    inputOnly,
    noPull,
    reserved,
    avoid,
    spi: data.spi === undefined ? null : parseSpi(data.spi, gpio),
    i2c: data.i2c === undefined ? null : parseI2c(data.i2c, gpio),
    notes: data.notes === undefined ? "" : str(data.notes, `"notes"`),
  };
}

export function parseBoard(id: string, data: unknown, processors: ReadonlyMap<string, ProcessorDef>): BoardDef {
  if (!ID_RE.test(id)) throw new DefinitionError(`file name "${id}" must be lowercase letters, digits, "-" or "_"`);
  if (!isObject(data)) throw new DefinitionError(`must be a JSON object`);
  checkKeys(data, BOARD_KEYS, "board");
  for (const required of ["name", "processor", "match", "pins"]) {
    if (data[required] === undefined) throw new DefinitionError(`missing required key "${required}"`);
  }
  const processorId = str(data.processor, `"processor"`);
  const processor = processors.get(processorId);
  if (!processor) {
    throw new DefinitionError(`"processor": no processor "${processorId}" (known: ${[...processors.keys()].sort().join(", ")})`);
  }
  let gpio: Set<number> | null = null;
  if (data.gpio !== undefined) {
    gpio = new Set(pinList(data.gpio, `"gpio"`));
    subset(gpio, processor.gpio, `"gpio" (must be pins ${processor.name} has)`);
  }
  const available = gpio ?? processor.gpio;
  if (!isObject(data.pins)) throw new DefinitionError(`"pins": must be an object like {"LED": 15}`);
  const pins = new Map<string, number>();
  for (const [label, pin] of Object.entries(data.pins)) {
    if (label.trim() === "") throw new DefinitionError(`"pins": labels can't be empty`);
    const p = pinNumber(pin, `"pins.${label}"`);
    if (!available.has(p)) throw new DefinitionError(`"pins.${label}": GPIO ${p} doesn't exist on this board`);
    pins.set(label, p);
  }
  const reserved = data.reserved === undefined ? new Map<number, string>() : pinReasons(data.reserved, `"reserved"`);
  const avoid = data.avoid === undefined ? new Map<number, string>() : pinReasons(data.avoid, `"avoid"`);
  subset(reserved.keys(), available, `"reserved"`);
  subset(avoid.keys(), available, `"avoid"`);
  return {
    id,
    name: str(data.name, `"name"`),
    processor: processorId,
    match: strList(data.match, `"match"`),
    pins,
    gpio,
    reserved,
    avoid,
    notes: data.notes === undefined ? "" : str(data.notes, `"notes"`),
  };
}

// ---------------------------------------------------------------------
// Merging built-ins with user files
// ---------------------------------------------------------------------

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validates and merges definition files. `builtin` first, then `user`: a
 * valid user file replaces the built-in with the same id (reported in
 * `overrides`). An invalid user file does NOT fall back silently to the
 * built-in it would have replaced -- it's reported in `problems`, and the
 * built-in stays in use, so the problem list is the one place to look.
 * Processors are resolved before boards, since a board names its processor.
 */
export function buildDefinitionSet(builtin: readonly RawDefinitionFile[], user: readonly RawDefinitionFile[]): DefinitionSet {
  const problems: DefinitionProblem[] = [];
  const overrides: { kind: DefinitionKind; id: string; source: string }[] = [];
  const processors = new Map<string, ProcessorDef>();
  const boards = new Map<string, BoardDef>();
  const builtinIds = new Set(builtin.map((f) => `${f.kind}:${f.id}`));

  const ordered = [...builtin, ...user];
  const tryAdd = (file: RawDefinitionFile): void => {
    if (file.parseError) {
      problems.push({ kind: file.kind, id: file.id, source: file.source, message: file.parseError });
      return;
    }
    try {
      if (file.kind === "processor") processors.set(file.id, parseProcessor(file.id, file.data));
      else boards.set(file.id, parseBoard(file.id, file.data, processors));
      if (!builtin.includes(file) && builtinIds.has(`${file.kind}:${file.id}`)) {
        overrides.push({ kind: file.kind, id: file.id, source: file.source });
      }
    } catch (err) {
      problems.push({ kind: file.kind, id: file.id, source: file.source, message: errorText(err) });
    }
  };
  for (const f of ordered) if (f.kind === "processor") tryAdd(f);
  for (const f of ordered) if (f.kind === "board") tryAdd(f);
  return { processors, boards, problems, overrides };
}

/** "0-19, 21-23, 32-39" -- compact text for a pin set, used in messages and the UI. */
export function formatPinSet(pins: Iterable<number>): string {
  const sorted = [...new Set(pins)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j === i ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Turns the backend's /api/definitions listing into RawDefinitionFiles. */
export function userDefinitionFiles(listing: {
  processors: readonly { name: string; valid: boolean; error: string | null; data: unknown }[];
  boards: readonly { name: string; valid: boolean; error: string | null; data: unknown }[];
}): RawDefinitionFile[] {
  const convert = (kind: DefinitionKind, dir: string) => (f: { name: string; valid: boolean; error: string | null; data: unknown }) => ({
    kind,
    id: f.name,
    source: `~/.thingstudio/${dir}/${f.name}.json`,
    data: f.valid ? f.data : null,
    parseError: f.valid ? null : (f.error ?? "invalid file"),
  });
  return [...listing.processors.map(convert("processor", "processors")), ...listing.boards.map(convert("board", "boards"))];
}
