// The headless compile/validate check (src/cli/check-flow.ts) and the command over it (src/cli/thingstudio-compile.ts,
// built to dist-cli/ by vite.cli.config.ts). The command is built into a temp directory for these tests and run with
// node, so they cover what an agent or a script really does.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { checkFlowText } from "../src/cli/check-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorDir = join(__dirname, "..");
const flowsDir = join(__dirname, "..", "..", "test-flows");

function flow(nodes: Array<Record<string, unknown>>, edges: unknown[] = [], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ formatVersion: 1, flowName: "t", nodes, edges, layout: {}, configs: [], ...extra });
}
const timer = { id: "t1", type: "thingstudio/timer", properties: { intervalMs: 500 } };
const fn = (code: string) => ({ id: "f1", type: "thingstudio/function", properties: { code, outputCount: 1 } });
const gpio = { id: "g1", type: "thingstudio/gpio_out", properties: { pin: 15 } };

describe("checkFlowText", () => {
  it("compiles a good flow and returns the MicroPython", () => {
    const r = checkFlowText(flow([timer, fn("return msg"), gpio], [["t1", 0, "f1", 0], ["f1", 0, "g1", 0]]));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.source).toContain("async def");
    expect(r.stats).toMatchObject({ nodes: 3, wires: 2 });
  });

  it("uses the editor's defaults for properties the file leaves out", () => {
    const r = checkFlowText(flow([{ id: "t1", type: "thingstudio/timer", properties: {} }, gpio, ], [["t1", 0, "g1", 0]]));
    // gpio_out has no default pin, so the flow is rejected for that, not for the timer's missing interval.
    expect(r.errors.map((e) => e.message).join("\n")).not.toMatch(/interval/i);
  });

  it("says a file that is not JSON is not a flow", () => {
    const r = checkFlowText("{ nope");
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/not a readable flow file/);
  });

  it("names an unknown node type and its node", () => {
    const r = checkFlowText(flow([{ id: "x1", type: "thingstudio/teleporter", properties: {} }]));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ node: "x1" });
    expect(r.errors[0]!.message).toMatch(/unknown node type "thingstudio\/teleporter"/);
  });

  it("reports every bad wire, not just the first", () => {
    const r = checkFlowText(flow([timer, gpio], [["t1", 3, "g1", 0], ["t1", 0, "g1", 5], ["t1", 0, "nope", 0]]));
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/node t1 has no output 4 \(it has 1\)/),
      expect.stringMatching(/node g1 has no input 6 \(it has 1\)/),
      expect.stringMatching(/a node it names is not in the flow/),
    ]);
  });

  it("refuses a wire the canvas would refuse", () => {
    const r = checkFlowText(flow([{ id: "i1", type: "thingstudio/inject", properties: {} }, { id: "d1", type: "thingstudio/display_spi", properties: {} }], [["i1", 0, "d1", 0]]));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/the editor would refuse this wire \(bool from inject into bytes to display_spi\)/);
  });

  it("reports a compile error with its node", () => {
    const r = checkFlowText(flow([timer, { id: "orphan", type: "thingstudio/function", properties: { code: "return msg", outputCount: 1 } }, gpio], [["t1", 0, "g1", 0]]));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ node: "orphan" });
    expect(r.errors[0]!.message).toMatch(/disconnected from any source/);
  });

  it("checks pins against a board when given one, and rejects an unknown board", () => {
    const pin99 = { ...gpio, properties: { pin: 99 } };
    const f = flow([timer, pin99], [["t1", 0, "g1", 0]]);
    expect(checkFlowText(f, { board: "board:freenove-s3-4in" }).ok).toBe(false);
    const bad = checkFlowText(f, { board: "board:nope" });
    expect(bad.errors[0]!.message).toMatch(/unknown board "board:nope"\. Choices: .*board:freenove-s3-4in/);
  });

  it("says when credentials were stand-ins", () => {
    const f = readFileSync(join(flowsDir, "gui-headliner-sensor-freenove-s3-4in.flow.json"), "utf8");
    const r = checkFlowText(f, { board: "board:freenove-s3-4in" });
    expect(r.ok).toBe(true);
    expect(r.notes.join("\n")).toMatch(/WiFi credentials were not resolved/);
    expect(r.notes.join("\n")).toMatch(/MQTT broker credentials were not resolved/);
  });

  it("accepts every example GUI flow and the blink flow", () => {
    for (const file of readdirSync(flowsDir).filter((f) => /^(gui-|blink).*\.flow\.json$/.test(f))) {
      const r = checkFlowText(readFileSync(join(flowsDir, file), "utf8"));
      expect(r.errors, file).toEqual([]);
    }
  });
});

describe("the command", () => {
  let cli: string;
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-cli-"));
  const run = (args: string[]) =>
    spawnSync("node", [cli, ...args], { encoding: "utf8", env: { ...process.env, THINGSTUDIO_MPY_CROSS_DIR: join(editorDir, "public", "vendor", "mpy-cross") } });
  const write = (name: string, content: string) => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  beforeAll(() => {
    execFileSync(join(editorDir, "node_modules", ".bin", "vite"), ["build", "--config", "vite.cli.config.ts", "--outDir", join(dir, "dist-cli")], { cwd: editorDir, stdio: "pipe" });
    cli = join(dir, "dist-cli", "thingstudio-compile.mjs");
  }, 60000);

  it("exits 0 and says OK for a good flow", () => {
    const r = run([join(flowsDir, "blink.flow.json")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OK .*blink\.flow\.json: 3 nodes, 2 wires/);
  });

  it("exits 1 and lists the errors for a bad flow", () => {
    const r = run([write("bad.json", flow([{ id: "x1", type: "thingstudio/teleporter", properties: {} }]))]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL/);
    expect(r.stdout).toMatch(/error: node x1: unknown node type/);
  });

  it("exits 2 for a missing file and for bad usage", () => {
    expect(run([join(dir, "missing.json")]).status).toBe(2);
    expect(run([]).status).toBe(2);
    expect(run(["--wat", "x.json"]).status).toBe(2);
  });

  it("prints JSON with --json, including the source when there is no --out", () => {
    const r = run(["--json", join(flowsDir, "blink.flow.json")]);
    const out = JSON.parse(r.stdout);
    expect(out[0]).toMatchObject({ ok: true, errors: [] });
    expect(out[0].source).toContain("async def");
  });

  it("writes the source with --out", () => {
    const out = join(dir, "blink.py");
    const r = run(["--out", out, join(flowsDir, "blink.flow.json")]);
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("async def");
  });

  it("catches a syntax error in a function node's Python (mpy-cross) that the compiler passes", () => {
    const f = write("syntax.json", flow([timer, fn("return msg +"), gpio], [["t1", 0, "f1", 0], ["f1", 0, "g1", 0]]));
    const r = run([f]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/does not compile \(mpy-cross\)/);
    expect(run(["--no-syntax", f]).status).toBe(0);
  });

  it("fails on warnings with --strict", () => {
    const f = join(flowsDir, "blink.flow.json");
    // blink without a board has the "no board known" warning.
    expect(run([f]).status).toBe(0);
    expect(run(["--strict", f]).status).toBe(1);
    expect(run(["--strict", "--board", "board:freenove-s3-4in", f]).status).toBe(0);
  });

  it("lists the boards", () => {
    expect(run(["--list-boards"]).stdout).toMatch(/board:freenove-s3-4in/);
  });
});
