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

/**
 * A pin identifier: a GPIO number, or a named pin on processors whose pins aren't numbered (the STM32
 * pyboard's "X1", "A13"). A string in a pin list is a range ("4-7") when it looks numeric -- those still
 * expand to numbers, so every existing definition and flow is unchanged -- and a named pin otherwise.
 */
export type PinId = number | string;

/** Pin list as written in a file: numbers, "a-b" range strings, or named pins. */
export type PinListJson = Array<number | string>;
/** Pin -> reason, keyed by "n", "a-b", or a named pin. */
export type PinReasonsJson = Record<string, string>;

/** "GPIO 5" for a number, "pin X1" for a name -- the wording every message and resource key uses. */
export function pinLabel(pin: PinId): string {
  return typeof pin === "number" ? `GPIO ${pin}` : `pin ${pin}`;
}

export interface SpiBusDef {
  /** Pins that reach this bus without the GPIO matrix (ESP32 family). Not a restriction. */
  readonly fastPins?: { readonly sck?: PinId; readonly mosi?: PinId; readonly miso?: PinId };
  /** When present, the ONLY pins this bus can use per role (RP2 family). */
  readonly pins?: { readonly sck?: readonly PinId[]; readonly mosi?: readonly PinId[]; readonly miso?: readonly PinId[] };
}

export interface I2cBusDef {
  /** When present, the ONLY pins this bus can use per role (RP2 family). */
  readonly pins?: { readonly sda?: readonly PinId[]; readonly scl?: readonly PinId[] };
}

export interface ProcessorDef {
  readonly id: string;
  readonly name: string;
  /** Substrings matched against the MCU part of HELLO's chipType (after " with "). */
  readonly match: readonly string[];
  readonly nativeArch: string;
  readonly nativeArchConfirmed: boolean;
  /** Hardware features the chip has (e.g. "wifi", "espnow", "pio"); a node's `requires` is checked
   * against these (capability-check.ts). Open vocabulary, lower-case words. */
  readonly capabilities: ReadonlySet<string>;
  readonly gpio: ReadonlySet<PinId>;
  readonly inputOnly: ReadonlySet<PinId>;
  readonly noPull: ReadonlySet<PinId>;
  /** Pins on the chip's second ADC (ESP32 family). ADC2 can't be used while WiFi is up, so the adc
   * node refuses one when the flow uses the network. Empty when the chip has no separate ADC2. */
  readonly adc2: ReadonlySet<PinId>;
  readonly reserved: ReadonlyMap<PinId, string>;
  readonly avoid: ReadonlyMap<PinId, string>;
  readonly spi: { readonly maxHz?: number; readonly otherPinsMaxHz?: number; readonly buses: ReadonlyMap<number, SpiBusDef> } | null;
  readonly i2c: { readonly buses: ReadonlyMap<number, I2cBusDef> } | null;
  readonly notes: string;
}

/** How to flash this board from blank (editor-firmware-flashing-scoping.md, revised 2026-10-25). Data, so a
 * third party's board can carry it; tool-shaped, so a new tool does not add a top-level key to every board.
 * `transport` is what the user picks in the dialog ("serial" port or "volume" mounted drive); `flash` is the
 * tool's own vocabulary. `runtime: "install"` means the image has no Thingstudio runtime, so the editor runs
 * the normal install after flashing. */
export interface FirmwareImageDef {
  readonly url: string;
  readonly sha256: string;
}

export type FirmwareRuntime = "none" | "install";

export interface EsptoolFirmwareDef {
  readonly tool: "esptool";
  readonly transport: "serial";
  readonly image: FirmwareImageDef;
  readonly runtime: FirmwareRuntime;
  /** `chip: null` means esptool identifies the chip itself (`--chip auto`). */
  readonly flash: { readonly chip: string | null; readonly baud: number; readonly offset: number };
}

export interface Uf2FirmwareDef {
  readonly tool: "uf2";
  readonly transport: "volume";
  readonly image: FirmwareImageDef;
  readonly runtime: FirmwareRuntime;
  /** A UF2 board takes no options: the volume is the target the user picked. */
  readonly flash: Readonly<Record<string, never>>;
}

export type BoardFirmwareDef = EsptoolFirmwareDef | Uf2FirmwareDef;

export interface BoardDef {
  readonly id: string;
  readonly name: string;
  readonly processor: string;
  /** Exact (case-insensitive) matches for the board part of HELLO's chipType (before " with "). */
  readonly match: readonly string[];
  /** Label -> GPIO number, or a named pin on processors whose pins aren't numbered. UI only; flows store
   * whatever pin value the flow author picked. */
  readonly pins: ReadonlyMap<string, PinId>;
  /** Narrows the processor's gpio set when present. */
  readonly gpio: ReadonlySet<PinId> | null;
  readonly reserved: ReadonlyMap<PinId, string>;
  readonly avoid: ReadonlyMap<PinId, string>;
  /** Pins the processor reserves or warns about that are free on this board (2026-10-12: the LuatOS
   * ESP32C3-CORE runs its flash in DIO mode, so the C3's GPIO 12-13 flash pins carry its LEDs). */
  readonly free: ReadonlySet<PinId>;
  /** Whether the board has a WiFi radio (WiFi transport, 2026-09-24). false hides the network
   * connection and board password; null (not stated) offers them -- Mike's call: only a definition
   * that says "no radio" takes the option away. Folded into `capabilities` by target.ts's
   * effectiveCapabilities (false denies "wifi", true adds it). */
  readonly wifi: boolean | null;
  /** Hardware features this board adds to (or, via `wifi: false`, takes from) its processor's set. */
  readonly capabilities: ReadonlySet<string>;
  readonly notes: string;
  /** Physical header pin -> the GPIO on it, a named pin, or a label such as "GND", "3V3" or "RUN"
   * (2026-09-30). A string value that's a declared pin on this board is that pin; any other string is a
   * free label. Empty when the file doesn't say. Keys are as written ("1".."40", or "P3-1" for a board with
   * several connectors); in insertion order, except that JS sorts integer-like keys ascending. */
  readonly header: ReadonlyMap<string, PinId | string>;
  /** How a 1..N dual-row header is numbered (2026-10-12): "around" goes down the left side and back up the
   * right (the Pico), "down" goes down both sides (pin N/2+1 top right, the LuatOS ESP32C3-CORE). */
  readonly headerOrder: "around" | "down";
  /** Which end of the header drawing the USB connector is at: "top" is the pin 1 end. Needs `header`. */
  readonly usb: "top" | "bottom" | null;
  /** The flash-from-blank recipe, or null when this board has none. */
  readonly firmware: BoardFirmwareDef | null;
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
  /** The backend's copy of a built-in, unedited since it was copied (builtin_reference.py). */
  readonly untouchedCopy?: boolean;
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
  /** Unedited copies of a built-in that has changed since: in use, but out of date. Not in `overrides`. */
  readonly staleCopies: readonly { kind: DefinitionKind; id: string; source: string }[];
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

/** A named pin (STM32's "X1", "A13"): a letter first, then letters/digits/underscore/hyphen. */
const NAMED_PIN_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** True for a string that can be a named pin ("X1", "A13"), not a numeric pin or range. The one rule the
 * pin-check and the UI share. */
export function isNamedPinName(s: string): boolean {
  return NAMED_PIN_RE.test(s) && !isNumericPinToken(s);
}

/** True for "5" and "6-11" -- the strings parsePinSpec expands to numbers. */
function isNumericPinToken(spec: string): boolean {
  return /^\s*\d+\s*(?:-\s*\d+\s*)?$/.test(spec);
}

/** "5" -> [5], "6-11" -> [6..11]. Named pins never reach here. */
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

/** One pin-list item -> the pin id(s) it names: a number, a numeric range string, or a named pin. */
function parsePinToken(item: unknown, where: string): PinId[] {
  if (typeof item === "number") return [pinNumber(item, where)];
  if (typeof item === "string") {
    if (isNumericPinToken(item)) return parsePinSpec(item, where);
    const name = item.trim();
    if (NAMED_PIN_RE.test(name)) return [name];
  }
  throw new DefinitionError(`${where}: ${JSON.stringify(item)} isn't a pin or a range like "0-19", or a pin name`);
}

function pinList(v: unknown, where: string): PinId[] {
  if (!Array.isArray(v)) throw new DefinitionError(`${where}: must be a list, e.g. [0, 2, "4-7"]`);
  const out: PinId[] = [];
  for (const item of v) out.push(...parsePinToken(item, where));
  return out;
}

function pinReasons(v: unknown, where: string): Map<PinId, string> {
  if (!isObject(v)) throw new DefinitionError(`${where}: must be an object like {"6-11": "reason"}`);
  const out = new Map<PinId, string>();
  for (const [spec, reason] of Object.entries(v)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new DefinitionError(`${where}."${spec}": the reason must be a non-empty string`);
    }
    for (const p of parsePinToken(spec, where)) out.set(p, reason);
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

function subset(pins: Iterable<PinId>, gpio: ReadonlySet<PinId>, where: string): void {
  for (const p of pins) {
    if (!gpio.has(p)) throw new DefinitionError(`${where}: ${pinLabel(p)} isn't in "gpio"`);
  }
}

/** A single pin value (a board's `pins` map value): a number or a named pin. */
function parsePinValue(v: unknown, where: string): PinId {
  const pins = parsePinToken(v, where);
  if (pins.length !== 1) throw new DefinitionError(`${where}: ${JSON.stringify(v)} names more than one pin`);
  return pins[0]!;
}

// ---------------------------------------------------------------------
// Processor and board validation
// ---------------------------------------------------------------------

// The exact key set each definition file may contain. Exported so
// editor/test/board-descriptor-schema.test.ts can assert the published JSON
// Schemas in interfaces/board-descriptor/ list the same keys -- the schema is
// a contract for people writing ~/.thingstudio/{processors,boards}/*.json, so
// it must not drift from this parser.
export const PROCESSOR_KEYS = ["name", "match", "nativeArch", "nativeArchConfirmed", "capabilities", "gpio", "inputOnly", "noPull", "adc2", "reserved", "avoid", "spi", "i2c", "notes"];
export const BOARD_KEYS = ["name", "processor", "match", "pins", "gpio", "reserved", "avoid", "notes", "wifi", "capabilities", "header", "free", "headerOrder", "usb", "firmware"];

function parseSpi(v: unknown, gpio: ReadonlySet<PinId>): ProcessorDef["spi"] {
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
      const fp: { sck?: PinId; mosi?: PinId; miso?: PinId } = {};
      for (const role of ["sck", "mosi", "miso"] as const) {
        if (raw.fastPins[role] !== undefined) fp[role] = parsePinValue(raw.fastPins[role], `${where}.fastPins.${role}`);
      }
      subset(Object.values(fp), gpio, `${where}.fastPins`);
      bus.fastPins = fp;
    }
    if (raw.pins !== undefined) {
      if (!isObject(raw.pins)) throw new DefinitionError(`${where}.pins: must be an object`);
      checkKeys(raw.pins, ["sck", "mosi", "miso"], `${where}.pins`);
      const pins: { sck?: PinId[]; mosi?: PinId[]; miso?: PinId[] } = {};
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

function parseI2c(v: unknown, gpio: ReadonlySet<PinId>): ProcessorDef["i2c"] {
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
      const pins: { sda?: PinId[]; scl?: PinId[] } = {};
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
  const adc2 = new Set(data.adc2 === undefined ? [] : pinList(data.adc2, `"adc2"`));
  const reserved = data.reserved === undefined ? new Map<PinId, string>() : pinReasons(data.reserved, `"reserved"`);
  const avoid = data.avoid === undefined ? new Map<PinId, string>() : pinReasons(data.avoid, `"avoid"`);
  subset(inputOnly, gpio, `"inputOnly"`);
  subset(noPull, gpio, `"noPull"`);
  subset(adc2, gpio, `"adc2"`);
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
    capabilities: new Set(data.capabilities === undefined ? [] : strList(data.capabilities, `"capabilities"`)),
    gpio,
    inputOnly,
    noPull,
    adc2,
    reserved,
    avoid,
    spi: data.spi === undefined ? null : parseSpi(data.spi, gpio),
    i2c: data.i2c === undefined ? null : parseI2c(data.i2c, gpio),
    notes: data.notes === undefined ? "" : str(data.notes, `"notes"`),
  };
}

const FIRMWARE_TOOLS = ["esptool", "uf2"] as const;

function parseFirmwareImage(v: unknown): FirmwareImageDef {
  if (!isObject(v)) throw new DefinitionError(`"firmware.image": must be an object`);
  checkKeys(v, ["url", "sha256"], `"firmware.image"`);
  const url = str(v.url, `"firmware.image.url"`);
  const sha256 = str(v.sha256, `"firmware.image.sha256"`).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new DefinitionError(`"firmware.image.sha256": must be 64 hex characters`);
  return { url, sha256 };
}

function parseFirmware(v: unknown): BoardFirmwareDef {
  if (!isObject(v)) throw new DefinitionError(`"firmware": must be an object`);
  checkKeys(v, ["tool", "transport", "image", "runtime", "flash"], `"firmware"`);
  const tool = oneOf(v.tool, FIRMWARE_TOOLS, `"firmware.tool"`);
  const transport = oneOf(v.transport, ["serial", "volume"] as const, `"firmware.transport"`);
  const expected = tool === "esptool" ? "serial" : "volume";
  if (transport !== expected) {
    throw new DefinitionError(`"firmware.transport": "${tool}" flashes over "${expected}", not "${transport}"`);
  }
  const image = parseFirmwareImage(v.image);
  const runtime = v.runtime === undefined ? "none" : oneOf(v.runtime, ["none", "install"] as const, `"firmware.runtime"`);
  const flashObj = v.flash === undefined ? {} : v.flash;
  if (!isObject(flashObj)) throw new DefinitionError(`"firmware.flash": must be an object`);
  if (tool === "esptool") {
    checkKeys(flashObj, ["chip", "baud", "offset"], `"firmware.flash"`);
    const chip = flashObj.chip === undefined ? null : str(flashObj.chip, `"firmware.flash.chip"`);
    const baud = flashObj.baud === undefined ? 460800 : positiveInt(flashObj.baud, `"firmware.flash.baud"`);
    const offset = flashObj.offset === undefined ? 0 : flashObj.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      throw new DefinitionError(`"firmware.flash.offset": must be a whole number of bytes (0 for the start of flash)`);
    }
    return { tool, transport: "serial", image, runtime, flash: { chip, baud, offset } };
  }
  checkKeys(flashObj, [], `"firmware.flash"`);
  return { tool, transport: "volume", image, runtime, flash: {} };
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
  let gpio: Set<PinId> | null = null;
  if (data.gpio !== undefined) {
    gpio = new Set(pinList(data.gpio, `"gpio"`));
    subset(gpio, processor.gpio, `"gpio" (must be pins ${processor.name} has)`);
  }
  const available = gpio ?? processor.gpio;
  if (!isObject(data.pins)) throw new DefinitionError(`"pins": must be an object like {"LED": 15}`);
  const pins = new Map<string, PinId>();
  for (const [label, pin] of Object.entries(data.pins)) {
    if (label.trim() === "") throw new DefinitionError(`"pins": labels can't be empty`);
    const p = parsePinValue(pin, `"pins.${label}"`);
    if (!available.has(p)) throw new DefinitionError(`"pins.${label}": ${pinLabel(p)} doesn't exist on this board`);
    pins.set(label, p);
  }
  const reserved = data.reserved === undefined ? new Map<PinId, string>() : pinReasons(data.reserved, `"reserved"`);
  const avoid = data.avoid === undefined ? new Map<PinId, string>() : pinReasons(data.avoid, `"avoid"`);
  subset(reserved.keys(), available, `"reserved"`);
  subset(avoid.keys(), available, `"avoid"`);
  const free = new Set(data.free === undefined ? [] : pinList(data.free, `"free"`));
  subset(free, available, `"free"`);
  const headerOrder = data.headerOrder === undefined ? "around" : oneOf(data.headerOrder, ["around", "down"] as const, `"headerOrder"`);
  const usb = data.usb === undefined ? null : oneOf(data.usb, ["top", "bottom"] as const, `"usb"`);
  if ((data.headerOrder !== undefined || usb !== null) && data.header === undefined) {
    throw new DefinitionError(`"${data.usb !== undefined ? "usb" : "headerOrder"}": needs "header", the pins it describes`);
  }
  for (const p of free) {
    if (reserved.has(p) || avoid.has(p)) {
      throw new DefinitionError(`"free": ${pinLabel(p)} is also in this board's own "${reserved.has(p) ? "reserved" : "avoid"}"`);
    }
  }
  return {
    id,
    name: str(data.name, `"name"`),
    processor: processorId,
    match: strList(data.match, `"match"`),
    pins,
    gpio,
    reserved,
    avoid,
    free,
    notes: data.notes === undefined ? "" : str(data.notes, `"notes"`),
    wifi: data.wifi === undefined ? null : bool(data.wifi, `"wifi"`),
    capabilities: new Set(data.capabilities === undefined ? [] : strList(data.capabilities, `"capabilities"`)),
    header: data.header === undefined ? new Map() : parseHeader(data.header, available),
    headerOrder,
    usb,
    firmware: data.firmware === undefined ? null : parseFirmware(data.firmware),
  };
}

/** `"header": {"1": 0, "3": "GND", ...}`. A GPIO must exist on the board and appear once: a header that
 * says two physical pins carry the same GPIO is a typo, and this page exists to prevent wiring mistakes.
 * A string value that names a pin on this board is that pin; any other string is a free label ("GND"). */
function parseHeader(v: unknown, available: ReadonlySet<PinId>): Map<string, PinId | string> {
  if (!isObject(v)) throw new DefinitionError(`"header": must be an object like {"1": 0, "3": "GND"}`);
  const out = new Map<string, PinId | string>();
  const seen = new Map<PinId, string>();
  const claim = (pin: string, id: PinId): void => {
    const other = seen.get(id);
    if (other !== undefined) throw new DefinitionError(`"header.${pin}": ${pinLabel(id)} is already on header pin ${other}`);
    seen.set(id, pin);
    out.set(pin, id);
  };
  for (const [pin, what] of Object.entries(v)) {
    if (pin.trim() === "") throw new DefinitionError(`"header": physical pin names can't be empty`);
    if (typeof what === "string") {
      if (what.trim() === "") throw new DefinitionError(`"header.${pin}": the label can't be empty`);
      if (available.has(what)) claim(pin, what);
      else out.set(pin, what);
      continue;
    }
    const id = parsePinValue(what, `"header.${pin}"`);
    if (!available.has(id)) throw new DefinitionError(`"header.${pin}": ${pinLabel(id)} doesn't exist on this board`);
    claim(pin, id);
  }
  return out;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new DefinitionError(`${where}: must be ${allowed.map((a) => `"${a}"`).join(" or ")}`);
  }
  return v as T;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") throw new DefinitionError(`${where}: must be true or false`);
  return v;
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
 * `overrides` only when its content differs). An invalid user file does
 * NOT fall back silently to the built-in it would have replaced -- it's
 * reported in `problems`, and the
 * built-in stays in use, so the problem list is the one place to look.
 * Processors are resolved before boards, since a board names its processor.
 */
export function buildDefinitionSet(builtin: readonly RawDefinitionFile[], user: readonly RawDefinitionFile[]): DefinitionSet {
  const problems: DefinitionProblem[] = [];
  const overrides: { kind: DefinitionKind; id: string; source: string }[] = [];
  const staleCopies: { kind: DefinitionKind; id: string; source: string }[] = [];
  const processors = new Map<string, ProcessorDef>();
  const boards = new Map<string, BoardDef>();
  // The backend copies every missing built-in into the user folders (builtin_reference.py), so most
  // user files are untouched copies. Only one that differs from its built-in counts as an override.
  const builtinData = new Map(builtin.map((f) => [`${f.kind}:${f.id}`, JSON.stringify(f.data)]));

  const ordered = [...builtin, ...user];
  const tryAdd = (file: RawDefinitionFile): void => {
    if (file.parseError) {
      problems.push({ kind: file.kind, id: file.id, source: file.source, message: file.parseError });
      return;
    }
    try {
      if (file.kind === "processor") processors.set(file.id, parseProcessor(file.id, file.data));
      else boards.set(file.id, parseBoard(file.id, file.data, processors));
      const original = builtinData.get(`${file.kind}:${file.id}`);
      if (!builtin.includes(file) && original !== undefined && original !== JSON.stringify(file.data)) {
        (file.untouchedCopy ? staleCopies : overrides).push({ kind: file.kind, id: file.id, source: file.source });
      }
    } catch (err) {
      problems.push({ kind: file.kind, id: file.id, source: file.source, message: errorText(err) });
    }
  };
  for (const f of ordered) if (f.kind === "processor") tryAdd(f);
  for (const f of ordered) if (f.kind === "board") tryAdd(f);
  return { processors, boards, problems, overrides, staleCopies };
}

/** "0-19, 21-23, 32-39" -- compact text for named pins, used in messages and the UI. Numbers are
 * range-compacted and listed first; named pins (STM32's "X1") follow, sorted for stable output. */
export function formatPinSet(pins: Iterable<PinId>): string {
  const numbers: number[] = [];
  const names: string[] = [];
  for (const p of pins) {
    if (typeof p === "number") numbers.push(p);
    else if (!names.includes(p)) names.push(p);
  }
  const parts: string[] = [];
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j === i ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  parts.push(...names.sort((a, b) => a.localeCompare(b)));
  return parts.join(", ");
}

type DefinitionListingEntry = { name: string; valid: boolean; error: string | null; data: unknown; untouchedCopy?: boolean };

/** Turns the backend's /api/definitions listing into RawDefinitionFiles. */
export function userDefinitionFiles(listing: {
  processors: readonly DefinitionListingEntry[];
  boards: readonly DefinitionListingEntry[];
}): RawDefinitionFile[] {
  const convert = (kind: DefinitionKind, dir: string) => (f: DefinitionListingEntry) => ({
    kind,
    id: f.name,
    source: `~/.thingstudio/${dir}/${f.name}.json`,
    data: f.valid ? f.data : null,
    parseError: f.valid ? null : (f.error ?? "invalid file"),
    untouchedCopy: f.untouchedCopy === true,
  });
  return [...listing.processors.map(convert("processor", "processors")), ...listing.boards.map(convert("board", "boards"))];
}
