// Every flow in tutorials/ checks clean. Newcomers open these with File -> Open... and copy from them, so a broken
// one fails at the front door. Before this test the examples had a layout check (flow-layout.test.ts) and the
// blink and GUI ones a compile check (cli-check-flow.test.ts, gui-compile.test.ts); the rest were never compiled.
//
// Two checks per flow, the two the command-line check makes (src/cli/thingstudio-compile.ts): checkFlowText resolves
// the flow's credentials to stand-ins, checks node types, wires and ports, and compiles; then the generated
// MicroPython goes through the editor's own mpy-cross, which is what catches a syntax error inside a function node.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { checkFlowText } from "../src/cli/check-flow.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "..", "tutorials");
const mpyDir = join(here, "..", "public", "vendor", "mpy-cross");
const files = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".flow.json"))
  .sort();

type MpyModule = {
  FS: { writeFile(path: string, data: string): void; unlink(path: string): void };
  callMain(args: string[]): number;
};

let syntaxProblem: (source: string) => string | null;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(mpyDir, "mpy-cross.mjs")).href)) as {
    default: (o: object) => Promise<MpyModule>;
  };
  const lines: string[] = [];
  const m = await mod.default({
    wasmBinary: readFileSync(join(mpyDir, "mpy-cross.wasm")),
    print: () => {},
    printErr: (t: string) => lines.push(t),
  });
  syntaxProblem = (source) => {
    lines.length = 0;
    m.FS.writeFile("/in.py", source);
    try {
      m.FS.unlink("/out.mpy");
    } catch {
      /* no earlier output */
    }
    const code = m.callMain(["-march=xtensawin", "-o", "/out.mpy", "/in.py"]);
    return code === 0 ? null : lines.join("\n") || `mpy-cross exited ${code}`;
  };
});

describe("the shipped tutorial flows", () => {
  it("are there to check", () => {
    // tools/make_bundle.py refuses to build a bundle with fewer than two.
    expect(files.length).toBeGreaterThan(1);
  });

  it.each(files)("%s compiles with no errors", (file) => {
    const r = checkFlowText(readFileSync(join(examplesDir, file), "utf8"));
    expect(r.errors, file).toEqual([]);
    expect(r.ok, file).toBe(true);
    expect(r.source, file).toBeTruthy();
    expect(syntaxProblem(r.source!), `${file}: the generated MicroPython does not compile (mpy-cross)`).toBeNull();
  });
});
