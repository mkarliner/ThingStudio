// SPDX-License-Identifier: Apache-2.0
// editor/test/definitions.test.ts
//
// Processor/board definitions (src/definitions/): the built-in files, the
// validator a hand-written file goes through, HELLO chipType detection, and
// the pin/SPI/I2C checks the pin-taking nodes now call.

import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphLink, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { buildDefinitionSet, formatPinSet, parsePinSpec, type RawDefinitionFile } from "../src/definitions/definitions.js";
import { FALLBACK_MAX_PIN, NO_TARGET_WARNING } from "../src/definitions/pin-check.js";
import { buildTarget, choiceForConnectedBoard, resolveTarget, widestGpio, type Target } from "../src/definitions/target.js";
import { inferNativeArch } from "../src/app/native-arch.js";
import { gpioOutNode } from "../src/node-library/gpio-out.js";
import { ebuttonNode } from "../src/node-library/ebutton.js";
import { displaySpiNode } from "../src/node-library/display-spi.js";
import { displayI2cNode } from "../src/node-library/display-i2c.js";

const defs = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);

function targetFor(choice: string): Target {
  const r = resolveTarget(defs, choice, null);
  if (!r.target) throw new Error(`no target for ${choice}`);
  return r.target;
}

function ctxFor(target: Target | null): CodegenContext & { warnings: string[] } {
  const warnings: string[] = [];
  let n = 0;
  return {
    warnings,
    target,
    warn: (m) => {
      if (!warnings.includes(m)) warnings.push(m);
    },
    uniqueName: (hint) => `_${hint}_${++n}`,
    resolveConfig: () => ({}),
  };
}

function node(type: string, properties: Record<string, unknown>): GraphNode {
  return { id: "1", type, properties };
}

function user(kind: "processor" | "board", id: string, data: unknown): RawDefinitionFile {
  return { kind, id, source: `~/.thingstudio/${kind === "processor" ? "processors" : "boards"}/${id}.json`, data };
}

const minimalProcessor = { name: "Test", match: ["TEST1"], nativeArch: "armv6m", gpio: ["0-9"] };

describe("built-in definitions", () => {
  it("all load with no problems", () => {
    expect(defs.problems).toEqual([]);
    expect([...defs.processors.keys()].sort()).toEqual(["esp32", "esp32-c3", "esp32-s2", "esp32-s3", "rp2040", "rp2350"]);
    expect([...defs.boards.keys()].sort()).toEqual(["cyd", "lolin-s2-mini", "pico", "pico-2", "pico-w"]);
  });

  it("FALLBACK_MAX_PIN is the widest range any built-in processor has", () => {
    expect(Math.max(...widestGpio(defs))).toBe(FALLBACK_MAX_PIN);
  });

  it("keeps each processor's native arch in step with inferNativeArch's MCU mapping", () => {
    const samples: Record<string, string> = {
      esp32: "Generic ESP32 module with ESP32",
      "esp32-s2": "LOLIN_S2_MINI with ESP32-S2FN4R2",
      "esp32-s3": "Generic ESP32S3 module with ESP32-S3",
      "esp32-c3": "LuatOS-Core-ESP32C3 with ESP32C3",
      rp2040: "Raspberry Pi Pico W with RP2040",
      rp2350: "Raspberry Pi Pico2 with RP2350",
    };
    for (const [id, chipType] of Object.entries(samples)) {
      const p = defs.processors.get(id)!;
      expect({ arch: p.nativeArch, confirmed: p.nativeArchConfirmed }).toEqual(inferNativeArch(chipType));
    }
  });
});

describe("definition file validation", () => {
  it("parses pin specs and formats pin sets", () => {
    expect(parsePinSpec("6-9", "x")).toEqual([6, 7, 8, 9]);
    expect(parsePinSpec(" 5 ", "x")).toEqual([5]);
    expect(() => parsePinSpec("9-6", "x")).toThrow(/valid range/);
    expect(() => parsePinSpec("a", "x")).toThrow(/isn't a pin/);
    expect(formatPinSet([3, 0, 1, 2, 5, 7, 8])).toBe("0-3, 5, 7-8");
  });

  it("accepts a minimal user processor and board", () => {
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [
      user("processor", "test-chip", minimalProcessor),
      user("board", "test-board", { name: "Test board", processor: "test-chip", match: [], pins: { LED: 3 } }),
    ]);
    expect(set.problems).toEqual([]);
    expect(set.boards.get("test-board")!.pins.get("LED")).toBe(3);
  });

  it("rejects an unknown key, naming it -- a typo must not silently disable a check", () => {
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [user("processor", "typo", { ...minimalProcessor, reserverd: { "1": "x" } })]);
    expect(set.processors.has("typo")).toBe(false);
    expect(set.problems).toHaveLength(1);
    expect(set.problems[0]!.message).toMatch(/unknown key "reserverd"/);
    expect(set.problems[0]!.source).toBe("~/.thingstudio/processors/typo.json");
  });

  it("rejects missing required keys, bad pins, and pins outside gpio", () => {
    const cases: [unknown, RegExp][] = [
      [{ ...minimalProcessor, gpio: undefined }, /missing required key "gpio"/],
      [{ ...minimalProcessor, gpio: ["0-x"] }, /isn't a pin or a range/],
      [{ ...minimalProcessor, inputOnly: [12] }, /"inputOnly": GPIO 12 isn't in "gpio"/],
      [{ ...minimalProcessor, avoid: { "3": "" } }, /reason must be a non-empty string/],
      [{ ...minimalProcessor, spi: { buses: { one: {} } } }, /bus id "one" must be a number/],
      [[], /must be a JSON object/],
    ];
    for (const [data, re] of cases) {
      const set = buildDefinitionSet([], [user("processor", "bad", data)]);
      expect(set.problems[0]?.message).toMatch(re);
    }
  });

  it("rejects a board naming an unknown processor, or a pin its processor lacks", () => {
    const a = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [user("board", "b", { name: "B", processor: "esp99", match: [], pins: {} })]);
    expect(a.problems[0]!.message).toMatch(/no processor "esp99"/);
    const b = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [user("board", "b", { name: "B", processor: "rp2040", match: [], pins: { LED: 40 } })]);
    expect(b.problems[0]!.message).toMatch(/GPIO 40 doesn't exist on this board/);
  });

  it("rejects a file name that isn't a plain id", () => {
    const set = buildDefinitionSet([], [user("processor", "My Chip", minimalProcessor)]);
    expect(set.problems[0]!.message).toMatch(/file name "My Chip"/);
  });

  it("lets a valid user file replace a built-in, and reports it", () => {
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [
      user("board", "pico", { name: "My Pico", processor: "rp2040", match: ["Raspberry Pi Pico"], pins: { LED: 25, BUZZER: 15 } }),
    ]);
    expect(set.boards.get("pico")!.name).toBe("My Pico");
    expect(set.overrides).toEqual([{ kind: "board", id: "pico", source: "~/.thingstudio/boards/pico.json" }]);
  });

  it("doesn't report an untouched copy of a built-in as an override", () => {
    const pico = BUILTIN_DEFINITION_FILES.find((f) => f.kind === "board" && f.id === "pico")!;
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [user("board", "pico", JSON.parse(JSON.stringify(pico.data)))]);
    expect(set.overrides).toEqual([]);
    expect(set.problems).toEqual([]);
  });

  it("keeps the built-in and reports the problem when a replacing user file is invalid", () => {
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [user("board", "pico", { name: "My Pico" })]);
    expect(set.boards.get("pico")!.name).toBe("Raspberry Pi Pico");
    expect(set.problems[0]!.message).toMatch(/missing required key "processor"/);
  });

  it("passes a file's JSON syntax error straight through as a problem", () => {
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [
      { kind: "board", id: "broken", source: "~/.thingstudio/boards/broken.json", data: null, parseError: "Expecting ',' delimiter: line 3 column 5" },
    ]);
    expect(set.problems).toEqual([
      { kind: "board", id: "broken", source: "~/.thingstudio/boards/broken.json", message: "Expecting ',' delimiter: line 3 column 5" },
    ]);
  });
});

describe("target resolution from HELLO chipType", () => {
  const detect = (chipType: string): string | null => {
    const t = resolveTarget(defs, "auto", chipType).target;
    return t ? `${t.board?.id ?? "-"}/${t.processor.id}` : null;
  };

  it("recognises every board seen on real hardware by its exact board name", () => {
    expect(detect("LOLIN_S2_MINI with ESP32-S2FN4R2")).toBe("lolin-s2-mini/esp32-s2");
    expect(detect("Raspberry Pi Pico with RP2040")).toBe("pico/rp2040");
    expect(detect("Raspberry Pi Pico W with RP2040")).toBe("pico-w/rp2040");
    expect(detect("Raspberry Pi Pico2 with RP2350")).toBe("pico-2/rp2350");
  });

  it("falls back to the processor alone when the board isn't known (the CYD reports as a generic ESP32)", () => {
    expect(detect("Generic ESP32 module with ESP32")).toBe("-/esp32");
    expect(detect("LuatOS-Core-ESP32C3 with ESP32C3")).toBe("-/esp32-c3");
    expect(detect("Generic ESP32S3 module with ESP32-S3")).toBe("-/esp32-s3");
  });

  it("prefers the longest processor match (ESP32-S2 over ESP32)", () => {
    expect(detect("Some S2 board with ESP32S2")).toBe("-/esp32-s2");
  });

  it("returns no target, with a note saying what to do, for an unknown chip or no board", () => {
    const r = resolveTarget(defs, "auto", "Mystery board with XYZ123");
    expect(r.target).toBeNull();
    expect(r.note).toMatch(/Pick your board in the Board menu/);
    expect(resolveTarget(defs, "auto", null).target).toBeNull();
  });

  it("uses a manual pick over detection, and flags a processor mismatch", () => {
    const r = resolveTarget(defs, "board:cyd", "Raspberry Pi Pico with RP2040");
    expect(r.target!.label).toBe("CYD (ESP32-2432S028, ST7789) (ESP32)");
    expect(r.how).toBe("manual");
    expect(r.mismatch).toMatch(/connected board reports "Raspberry Pi Pico with RP2040"/);
    expect(resolveTarget(defs, "board:cyd", "Generic ESP32 module with ESP32").mismatch).toBeNull();
  });

  it("drops a manual pick back to Auto when a board with a different processor connects", () => {
    const r = choiceForConnectedBoard(defs, "board:cyd", "Raspberry Pi Pico with RP2040");
    expect(r.choice).toBe("auto");
    expect(r.note).toMatch(/was set to CYD .* Switched it back to Auto \(Raspberry Pi Pico \(RP2040\)\)/);
    expect(choiceForConnectedBoard(defs, "processor:esp32-s3", "LOLIN_S2_MINI with ESP32-S2FN4R2").choice).toBe("auto");
  });

  it("keeps a manual pick for the same processor, Auto, and picks it can't judge", () => {
    expect(choiceForConnectedBoard(defs, "board:cyd", "Generic ESP32 module with ESP32")).toEqual({ choice: "board:cyd", note: null });
    expect(choiceForConnectedBoard(defs, "auto", "Raspberry Pi Pico with RP2040")).toEqual({ choice: "auto", note: null });
    expect(choiceForConnectedBoard(defs, "board:cyd", "Mystery board with XYZ123")).toEqual({ choice: "board:cyd", note: null });
  });

  it("carries on as Auto, and says so, when a manual pick no longer exists", () => {
    const r = resolveTarget(defs, "board:gone", "Raspberry Pi Pico with RP2040");
    expect(r.target!.board!.id).toBe("pico");
    expect(r.note).toMatch(/"board:gone" isn't defined any more/);
  });

  it("lets a board's own reserved entry override the processor's avoid entry", () => {
    const t = targetFor("board:lolin-s2-mini");
    expect(t.reserved.has(19)).toBe(true);
    expect(t.avoid.has(19)).toBe(false);
  });

  it("narrows the pin set on a board with a smaller package (Pico 2 is RP2350A)", () => {
    expect(Math.max(...targetFor("board:pico-2").gpio)).toBe(29);
    expect(Math.max(...targetFor("processor:rp2350").gpio)).toBe(47);
  });
});

describe("pin checks in nodes", () => {
  const gpioOut = (pin: unknown, target: Target | null) => {
    const ctx = ctxFor(target);
    gpioOutNode.codegenSink!(node("thingstudio/gpio_out", { pin }), ctx);
    return ctx.warnings;
  };

  it("accepts S2 pins above the old 0-39 limit, and rejects pins the chip doesn't have", () => {
    expect(gpioOut(40, targetFor("board:lolin-s2-mini"))).toEqual([]);
    expect(() => gpioOut(23, targetFor("board:lolin-s2-mini"))).toThrow(/gpio_out pin 23 doesn't exist on LOLIN S2 Mini \(ESP32-S2\)\. Pins: 0-21, 26-46/);
    expect(() => gpioOut(30, targetFor("processor:rp2040"))).toThrow(/doesn't exist on RP2040/);
  });

  it("rejects reserved pins with the reason, and outputs on input-only pins", () => {
    expect(() => gpioOut(25, targetFor("board:pico-w"))).toThrow(/pin 25 can't be used on Raspberry Pi Pico W \(RP2040\): Wired to the WiFi chip/);
    expect(() => gpioOut(8, targetFor("processor:esp32"))).toThrow(/Wired to the flash chip/);
    expect(() => gpioOut(46, targetFor("processor:esp32-s2"))).toThrow(/input-only on ESP32-S2/);
  });

  it("warns, but compiles, for an avoid pin", () => {
    expect(gpioOut(45, targetFor("board:lolin-s2-mini"))).toEqual([
      "gpio_out pin 45 on LOLIN S2 Mini (ESP32-S2): Strapping pin. Sets flash voltage at reset.",
    ]);
    expect(gpioOut(15, targetFor("board:lolin-s2-mini"))).toEqual([]);
  });

  it("drops the processor's avoid warning for a pin the board labels, but keeps the board's own", () => {
    expect(gpioOut(0, targetFor("processor:esp32-s2"))).toHaveLength(1);
    expect(gpioOut(0, targetFor("board:lolin-s2-mini"))).toEqual([]);
    expect(gpioOut(24, targetFor("board:pico"))).toEqual(["gpio_out pin 24 on Raspberry Pi Pico (RP2040): Senses USB power (VBUS)."]);
  });

  it("with no target, allows 0-48 and warns once that checks are limited", () => {
    expect(gpioOut(40, null)).toEqual([NO_TARGET_WARNING]);
    expect(() => gpioOut(49, null)).toThrow(/out of range \(0-48/);
    expect(() => gpioOut("LED", null)).toThrow(/isn't a GPIO number/);
  });

  it("warns when a pull resistor is asked of a pin without one", () => {
    const ctx = ctxFor(targetFor("processor:esp32"));
    ebuttonNode.codegenEventSource!(node("thingstudio/ebutton", { pin: 34, pull: "up" }), ctx);
    expect(ctx.warnings.join("\n")).toMatch(/no internal pull resistor on ESP32/);
    const ok = ctxFor(targetFor("processor:esp32"));
    ebuttonNode.codegenEventSource!(node("thingstudio/ebutton", { pin: 34 }), ok);
    expect(ok.warnings).toEqual([]);
  });

  it("works through compile() end to end: warnings come back on the result", async () => {
    const { compile } = await import("../src/compiler/compile.js");
    const { buildRegistry } = await import("../src/node-library/registry.js");
    const graph = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true" } },
        { id: "2", type: "thingstudio/gpio_out", properties: { pin: 45 } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]] as GraphLink[],
    };
    const result = compile(graph, buildRegistry(), { target: targetFor("board:lolin-s2-mini") });
    expect(result.warnings).toHaveLength(1);
    expect(() => compile({ ...graph, nodes: [graph.nodes[0]!, { id: "2", type: "thingstudio/gpio_out", properties: { pin: 22 } }] }, buildRegistry(), { target: targetFor("board:lolin-s2-mini") })).toThrow(CompileError);
  });
});

describe("SPI and I2C checks", () => {
  const cydDisplay = { controller: "st7789", spiBus: 2, sck: 14, mosi: 13, dc: 2, cs: 15, reset: -1, backlight: 21, width: 240, height: 320 };
  const spi = (props: Record<string, unknown>, target: Target | null) => {
    const ctx = ctxFor(target);
    displaySpiNode.codegenSink!(node("thingstudio/display_spi", props), ctx);
    return ctx.warnings;
  };

  it("accepts the CYD's tested setup (bus 2, pins 14/13, 27 MHz)", () => {
    expect(spi({ ...cydDisplay, baudrate: 27000000 }, targetFor("board:cyd"))).toEqual([]);
  });

  it("rejects the CYD at 40 MHz on those pins -- the setting that crashed it -- and points at bus 1", () => {
    expect(() => spi({ ...cydDisplay, baudrate: 40000000 }, targetFor("board:cyd"))).toThrow(
      /baudrate 40 MHz is too fast for these pins on CYD.*Use 27 MHz or less, or move SCK and MOSI to bus 2's fast pins \(18 and 23\)\. These pins are SPI bus 1's fast pins, so spiBus 1 would also work\./,
    );
    expect(spi({ ...cydDisplay, spiBus: 1, baudrate: 40000000 }, targetFor("board:cyd"))).toEqual([]);
  });

  it("rejects an SPI bus the chip doesn't have (ESP32-C3 has only bus 1)", () => {
    expect(() => spi({ ...cydDisplay, sck: 6, mosi: 7, dc: 3, cs: 10, backlight: -1, baudrate: 40000000 }, targetFor("processor:esp32-c3"))).toThrow(
      /spiBus 2 doesn't exist on ESP32-C3\. SPI buses: 1/,
    );
  });

  it("rejects RP2040 pins that can't carry the chosen bus's signal", () => {
    const pico = { ...cydDisplay, spiBus: 0, sck: 18, mosi: 19, dc: 20, cs: 17, backlight: -1, baudrate: 40000000 };
    expect(spi(pico, targetFor("board:pico"))).toEqual([]);
    expect(() => spi({ ...pico, sck: 10 }, targetFor("board:pico"))).toThrow(/sck pin 10 can't be SPI bus 0 SCK on Raspberry Pi Pico \(RP2040\)\. Use one of: 2, 6, 18, 22/);
    expect(() => spi({ ...pico, baudrate: 70000000 }, targetFor("board:pico"))).toThrow(/faster than .* SPI maximum of 62.5 MHz/);
  });

  it("checks I2C bus and pins on RP2040, and bus count on ESP32-C3", () => {
    const i2c = (props: Record<string, unknown>, target: Target) => displayI2cNode.codegenSink!(node("thingstudio/display_i2c", props), ctxFor(target));
    expect(() => i2c({ i2cBus: 0, scl: 5, sda: 4 }, targetFor("board:pico"))).not.toThrow();
    expect(() => i2c({ i2cBus: 1, scl: 5, sda: 4 }, targetFor("board:pico"))).toThrow(/scl pin 5 can't be I2C bus 1 SCL/);
    expect(() => i2c({ i2cBus: 1, scl: 5, sda: 4 }, targetFor("processor:esp32-c3"))).toThrow(/i2cBus 1 doesn't exist on ESP32-C3/);
  });

  it("skips bus checks with no target", () => {
    expect(spi({ ...cydDisplay, baudrate: 40000000 }, null)).toEqual([NO_TARGET_WARNING]);
  });
});

describe("buildTarget", () => {
  it("labels a processor-only target with just the processor name", () => {
    expect(buildTarget(defs.processors.get("esp32")!, null).label).toBe("ESP32");
  });
});
