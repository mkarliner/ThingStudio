// outstanding-items.md's "[P4] eswitch/ebutton nodes" item -- eswitch.ts's
// own header has the full design story (topic-carries-event-identity
// single output, WaitAny multiplexing, why polling not IRQ).
//
// Unlike node-interrupt.test.ts, this file's behavioral tests run the REAL
// vendored driver (device-runtime/src/vendor/primitives_events/events.py,
// unmodified logic -- see that directory's README for the two import-only
// patches) through a real CPython asyncio loop, not just this project's
// own buildMsg text. That's possible here in a way it isn't for
// interrupt/ThreadSafeEvent: ESwitch has no hard-IRQ dependency at all --
// its own `_poll()` coroutine polls the pin via plain `asyncio.sleep_ms`
// (shimmed in fixtures/pymock/runtime.py), so the actual debounce/
// state-change logic under test is real, not a stand-in. What still can't
// be proven off-device: real electrical debounce/bounce timing and actual
// GPIO behavior -- a real-hardware pass is still the final proof, same
// standing note as every other node type here.
//
// Pin values are driven by fixtures/pymock/machine.py's Pin.SCHEDULE (a
// real-wall-clock schedule), not time_mock.py's virtual clock --
// interrupt's tests could use a virtual clock because interrupt's own
// buildMsg was tested in isolation, synchronously, with no real event loop
// running at all. Here the polling loop genuinely has to observe real
// elapsed time passing.

import { execFileSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { eswitchNode } from "../src/node-library/eswitch.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pymockDir = join(__dirname, "fixtures", "pymock");
// The REAL vendored driver, not a stand-in -- see this file's header.
const vendorDir = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "primitives_events");

let uniqueCounter = 0;
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}_${++uniqueCounter}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/eswitch", properties };
}

/**
 * Wraps a compiled flow's source so it runs the way it actually does on
 * real hardware: `listener.py`'s `import _flow` (device-runtime/src/
 * listener.py's own comment: "executes _flow's top-level code, which
 * calls runtime.spawn(...)") happens from INSIDE the listener's own
 * already-running asyncio dispatch coroutine, not from a bare top-level
 * script -- so a flow's module-level setup code can safely call
 * `asyncio.create_task()` during construction, which is exactly what the
 * REAL vendored ESwitch/EButton do (`events.py`'s own `__init__`).
 * pymock's own `runtime.spawn()` (fixtures/pymock/runtime.py) doesn't
 * match this: it's a simplified stand-in that starts its OWN fresh
 * `asyncio.run()` bounded loop per call, written before any node
 * constructed an asyncio task outside a coroutine -- fine for every
 * pre-existing node (none of them do that), but it means a flow's
 * module-level statements run with NO loop active yet, which is where a
 * bare `python3 _flow.py` invocation would hit
 * `RuntimeError: no running event loop` the instant ESwitch/EButton's own
 * constructor calls `asyncio.create_task()`.
 *
 * Rather than changing pymock/runtime.py's shared `spawn()` (risking every
 * other test file that depends on its current "call it, it runs its own
 * bounded loop" behavior), this wraps the WHOLE compiled source -- not
 * just this test's own snippet -- inside `async def _flow_main():`, driven
 * by one real `asyncio.run()`, with a local `runtime.spawn` override
 * (plain `asyncio.create_task`, matching device-runtime/src/runtime.py's
 * own real implementation exactly) installed before `_flow_main` runs.
 * Scoped entirely to these two test files' own runner -- no other test's
 * behavior changes.
 */
function buildRunnerScript(source: string, scheduleLiteral: string, maxRunS: number): string {
  const outerPreamble = [
    "import time",
    "_real_t0 = time.monotonic()",
    // machine imported BEFORE the time_mock swap below, so its own
    // `import time as _real_time` (machine.py's header) unambiguously
    // binds the real stdlib module, not time_mock's __getattr__ passthrough.
    "import machine",
    "import sys",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    `machine.Pin.SCHEDULE = {${scheduleLiteral}}`,
    "machine.Pin.T0 = _real_t0",
    "import asyncio as _real_asyncio",
    "import runtime as _runtime_mod",
    "",
    "async def _real_spawn_coro(coro, node_id):",
    "    try:",
    "        await coro",
    "    except Exception as e:",
    '        print("NODE_ERROR node=%s type=%s msg=%s" % (node_id, type(e).__name__, str(e)))',
    "",
    "def _real_spawn(coro, node_id=None):",
    "    return _real_asyncio.create_task(_real_spawn_coro(coro, node_id))",
    "",
    "_runtime_mod.spawn = _real_spawn",
    "",
    "async def _flow_main():",
  ];
  const indentedSource = source
    .split("\n")
    .map((l) => (l.length ? `    ${l}` : l))
    .join("\n");
  const trailer = [`    await _real_asyncio.sleep(${maxRunS})`, "", "_real_asyncio.run(_flow_main())"];
  return [...outerPreamble, indentedSource, ...trailer].join("\n");
}
function runScheduledFlow(graph: GraphData, schedule: Record<number, Array<[number, 0 | 1]>>, maxRunS = 1.0): string[] {
  const { source } = compile(graph, buildRegistry());
  const scheduleLiteral = Object.entries(schedule)
    .map(([pin, entries]) => `${pin}: [${entries.map(([t, v]) => `(${t}, ${v})`).join(", ")}]`)
    .join(", ");
  const fullSource = buildRunnerScript(source, scheduleLiteral, maxRunS);

  const dir = mkdtempSync(join(tmpdir(), "thingstudio-eswitch-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, fullSource);
  const output = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: `${pymockDir}${delimiter}${vendorDir}`, PYMOCK_MAX_RUN_S: String(maxRunS) },
    encoding: "utf8",
  });
  return [...output.matchAll(/'topic': '(\w+)'/g)].map((m) => m[1]!);
}

describe("thingstudio/eswitch node", () => {
  it("rejects an out-of-range pin", () => {
    expect(() => eswitchNode.codegenEventSource!(node({ pin: 99 }), ctx)).toThrow(CompileError);
    expect(() => eswitchNode.codegenEventSource!(node({ pin: 99 }), ctx)).toThrow(/out of range/);
  });

  it("rejects an invalid lopen value", () => {
    expect(() => eswitchNode.codegenEventSource!(node({ pin: 4, lopen: 2 }), ctx)).toThrow(/must be 0 or 1/);
  });

  it("defaults lopen to 1", () => {
    const result = eswitchNode.codegenEventSource!(node({ pin: 4 }), ctx);
    expect(result.statements?.[0]?.code).toContain("ESwitch(_eswitch_pin_4, lopen=1)");
  });

  it("rejects an invalid pull value", () => {
    expect(() => eswitchNode.codegenEventSource!(node({ pin: 4, pull: "sideways" }), ctx)).toThrow(
      /must be "none", "up", or "down"/,
    );
  });

  it("defaults pull to none -- no internal pull configured, matching this node's original 2026-09-08 behavior", () => {
    const result = eswitchNode.codegenEventSource!(node({ pin: 4 }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin(4, machine.Pin.IN)");
  });

  it("enables the internal pull-up when pull is 'up' -- real-hardware finding, TiDAL badge buttons", () => {
    const result = eswitchNode.codegenEventSource!(node({ pin: 4, pull: "up" }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin(4, machine.Pin.IN, machine.Pin.PULL_UP)");
  });

  it("enables the internal pull-down when pull is 'down'", () => {
    const result = eswitchNode.codegenEventSource!(node({ pin: 4, pull: "down" }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin(4, machine.Pin.IN, machine.Pin.PULL_DOWN)");
  });

  it("compiles into a full flow with the expected structure -- event-driven WaitAny, not repeatMs/sleep_ms in this node's own codegen", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/eswitch", properties: { pin: 6, lopen: 1 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("from events import ESwitch, WaitAny");
    expect(source).toContain("ESwitch(_eswitch_pin_6, lopen=1)");
    expect(source).toContain("WaitAny([_eswitch_6.close, _eswitch_6.open])");
    expect(source).toContain("while True:");
    expect(source).toMatch(/_trig = await .*\.wait\(\)/);
    expect(source).toContain("_trig.clear()");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("two eswitch nodes on the same pin share one underlying driver instance (first-writer-wins, matching gpio-out/interrupt's own precedent)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/eswitch", properties: { pin: 8, lopen: 1 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        { id: "3", type: "thingstudio/eswitch", properties: { pin: 8, lopen: 1 } },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "3", 0, "4", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/ESwitch\(_eswitch_pin_8/g)?.length).toBe(1);
    // But each node instance still gets its OWN WaitAny wrapper -- exactly
    // two, not deduped onto one, per this file's header on why sharing a
    // WaitAny across two independent coroutines would be a real race.
    expect(source.match(/= WaitAny\(\[_eswitch_8\.close, _eswitch_8\.open\]\)/g)?.length).toBe(2);
  });

  it("reports a real close-then-open transition through the actual vendored ESwitch driver", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/eswitch", properties: { pin: 10, lopen: 1, debounceMs: 10 } },
        { id: "2", type: "thingstudio/debug", properties: { fullMessage: true } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    // lopen=1: electrical 1 = open, electrical 0 = closed. Boot state 1
    // (open) -- no event for the boot state itself, only for the CHANGES
    // that follow.
    const topics = runScheduledFlow(graph, { 10: [[0.0, 1], [0.06, 0], [0.12, 1]] });
    expect(topics).toEqual(["close", "open"]);
  });
});
