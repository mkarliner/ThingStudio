// Tier 1 item 5's interrupt/pin-change node (editor/src/node-library/interrupt.ts),
// replacing gpio_in (removed the same session -- see registry.ts's own
// comment and mvp-feature-priorities.md item 2's superseded note).
//
// Same off-device testing constraint node-gpio-in.test.ts documented and
// worked around: pymock's runtime.py aliases CPython's real `asyncio`
// module, which has no MicroPython-specific ThreadSafeFlag the real
// vendored ThreadSafeEvent depends on, and there is no hard-IRQ context to
// simulate in a CPython test process at all -- no off-device test can fire
// a real interrupt or prove the hard-IRQ handler itself is safe (that's
// exactly why device-runtime/src/vendor/threadsafe_event/README.md traces
// hard-IRQ safety from upstream's own docs instead, and why Mike's
// hands-on hardware pass is this node's real proof, not this file).
//
// What these tests CAN actually prove off-device: codegenEventSource's
// property validation, the generated setup/wait/buildMsg text structure,
// and -- the part worth the most scrutiny, since it's real logic rather
// than a fixed template -- the debounce cooldown decision itself. That
// last part is tested by running buildMsg repeatedly against pymock's
// test-controllable clock (fixtures/pymock/time.py) and pin values
// (fixtures/pymock/machine.py), the same "skip the coroutine/asyncio
// machinery, drive the snippet directly" approach node-gpio-in.test.ts
// used, extended here to a *sequence* of simulated wakes since debounce is
// a decision made across iterations, not within one.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { interruptNode } from "../src/node-library/interrupt.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// resolveConfig is unused by this node type -- stub throws if ever called,
// same "fail loudly on the unexpected" instinct as the real compile.ts
// implementation (config-node-and-palette-implementation-briefing.md).
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/interrupt", properties };
}

/**
 * Runs codegenEventSource's setup once, then buildMsg once per (time, pinValue)
 * event in sequence -- each iteration simulates one IRQ-handler-triggered wake,
 * with time.CLOCK.now and the pin's driven value set immediately beforehand.
 * A `print(msg)` follows each buildMsg inside the same loop iteration, so a
 * buildMsg that `continue`s (debounced-out) produces no corresponding print --
 * the returned array has fewer entries than `events` exactly when, and only
 * when, an edge was suppressed.
 */
function runEvents(properties: Record<string, unknown>, events: Array<{ t: number; v: 0 | 1 }>): boolean[] {
  const result = interruptNode.codegenEventSource!(node(properties), ctx);
  const setup = [...(result.imports ?? []), ...(result.statements ?? []).map((s) => s.code)];
  const eventsLiteral = events.map((e) => `(${e.t}, ${e.v})`).join(", ");
  const pin = Number(properties.pin);
  // Wrapped in a real function, NOT run as bare top-level statements --
  // load-bearing, not style. buildMsg's `global _irq_debounce_ts_N` (etc.)
  // has to live in a scope that's genuinely distinct from `setup`'s
  // module-level `_irq_debounce_ts_N = ...` assignment, exactly like the
  // real generated code (buildMsg runs inside `async def _flow_0():`,
  // setup runs at true module scope, per compile.ts). A bare top-level
  // loop puts both in the SAME scope -- Python then rejects the `global`
  // statement outright ("name '...' is assigned to before global
  // declaration"), since a `global` declaration must textually precede
  // any assignment to that name within its own enclosing block, and
  // module-level code is itself one such block.
  const loop = [
    `def _run_events():`,
    `    for _t, _v in [${eventsLiteral}]:`,
    `        time.CLOCK.now = _t`,
    `        machine.Pin.INPUT_VALUES[${pin}] = _v`,
    ...result.buildMsg.split("\n").map((l) => `        ${l}`),
    `        print('ACCEPTED', msg['payload'])`,
    `_run_events()`,
  ];
  // `time` is a true CPython builtin (see fixtures/pymock/time_mock.py's
  // header) -- PYTHONPATH can't shadow it the way it shadows machine/
  // network/mqtt_as, so it has to be swapped into sys.modules explicitly,
  // before the generated code's own `import time` (in `setup`, from
  // result.imports) runs. time_mock.py itself passes through anything it
  // doesn't define (monotonic, etc.) to the real stdlib time module, so
  // this swap doesn't break Python's own internals if something else in
  // the process needs real time functions -- see that file's header.
  const preamble = ["import sys", "import time_mock", 'sys.modules["time"] = time_mock'];
  const lines = [...preamble, ...setup, ...loop];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  const output = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
  return output
    .split("\n")
    .filter((l) => l.startsWith("ACCEPTED"))
    .map((l) => l.endsWith("True"));
}

describe("thingstudio/interrupt node", () => {
  it("rejects an out-of-range pin", () => {
    expect(() => interruptNode.codegenEventSource!(node({ pin: 99, edge: "rising" }), ctx)).toThrow(CompileError);
    expect(() => interruptNode.codegenEventSource!(node({ pin: 99, edge: "rising" }), ctx)).toThrow(/out of range/);
  });

  it("rejects an invalid edge mode", () => {
    expect(() => interruptNode.codegenEventSource!(node({ pin: 12, edge: "sideways" }), ctx)).toThrow(/rising.*falling.*both/);
  });

  it("rejects a non-positive debounceMs when debounce is enabled", () => {
    expect(() => interruptNode.codegenEventSource!(node({ pin: 12, debounce: true, debounceMs: 0 }), ctx)).toThrow(/positive number/);
  });

  it("defaults edge to rising and debounce to enabled with debounceMs 50", () => {
    const result = interruptNode.codegenEventSource!(node({ pin: 12 }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin.IRQ_RISING");
    expect(result.statements?.[0]?.code).not.toContain("IRQ_FALLING");
  });

  it("compiles into a full flow with the expected structure -- event-driven, not repeatMs/sleep_ms", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/interrupt", properties: { pin: 14, edge: "both", debounce: true, debounceMs: 30 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(source).toContain("machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING");
    expect(source).toMatch(/\.irq\(trigger=.*handler=/);
    expect(source).toContain("while True:");
    expect(source).toMatch(/await .*\.wait\(\)/);
    expect(source).toMatch(/\.clear\(\)/);
    expect(source).not.toContain("asyncio.sleep_ms");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("an interrupt and gpio_out on the same pin number get two independently-configured Pin objects", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/interrupt", properties: { pin: 12, edge: "rising" } },
        { id: "2", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [[1, "2", 0, "3", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("machine.Pin(12, machine.Pin.IN)");
    expect(source).toContain("machine.Pin(12, machine.Pin.OUT)");
  });

  describe("debounce cooldown (single-edge trigger)", () => {
    it("reports every edge when debounce is off", () => {
      const accepted = runEvents({ pin: 12, edge: "rising", debounce: false }, [
        { t: 0, v: 1 },
        { t: 1, v: 0 },
        { t: 2, v: 1 },
      ]);
      expect(accepted).toEqual([true, false, true]);
    });

    it("suppresses a second edge that arrives within the cooldown window of the last accepted one", () => {
      const accepted = runEvents({ pin: 12, edge: "rising", debounce: true, debounceMs: 50 }, [
        { t: 1000, v: 1 }, // accepted (first ever)
        { t: 1010, v: 0 }, // 10ms later, within 50ms cooldown -- suppressed
        { t: 1030, v: 1 }, // 30ms after the ACCEPTED edge, still within cooldown -- suppressed
      ]);
      expect(accepted.length).toBe(1);
      expect(accepted[0]).toBe(true);
    });

    it("accepts a new edge once the cooldown window has elapsed", () => {
      const accepted = runEvents({ pin: 12, edge: "rising", debounce: true, debounceMs: 50 }, [
        { t: 1000, v: 1 }, // accepted
        { t: 1060, v: 0 }, // 60ms later, past the 50ms cooldown -- accepted
      ]);
      expect(accepted).toEqual([true, false]);
    });
  });

  describe("debounce cooldown (both-edges trigger)", () => {
    it("also requires a genuine level change from the last accepted edge, not just elapsed time", () => {
      // Regression case for the exact hazard interrupt.ts's header describes:
      // a pure time-based cooldown would wrongly accept a late bounce that
      // lands back on the SAME level as the last accepted edge.
      const accepted = runEvents({ pin: 12, edge: "both", debounce: true, debounceMs: 20 }, [
        { t: 1000, v: 1 }, // accepted: first ever, level 1
        { t: 1025, v: 1 }, // 25ms later (past cooldown) but SAME level as last accepted -- must be suppressed
        { t: 1050, v: 0 }, // 50ms later, past cooldown AND a real level change -- accepted
      ]);
      expect(accepted).toEqual([true, false]);
    });
  });
});
