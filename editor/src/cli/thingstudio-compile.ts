// SPDX-License-Identifier: Apache-2.0
// editor/src/cli/thingstudio-compile.ts
//
// The command line over check-flow.ts: compile and validate a flow file without a browser.
//
//   node dist-cli/thingstudio-compile.mjs [options] <flow.json> [more.json ...]
//
// Exit codes: 0 every flow is valid, 1 a flow has errors (or warnings with --strict), 2 bad usage or a file that
// could not be read. Build it with `npm run build:cli` in editor/.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boardChoices, checkFlowText, type CheckResult } from "./check-flow.js";

const USAGE = `thingstudio-compile: compile and check a Thingstudio flow file without the editor.

Usage: node dist-cli/thingstudio-compile.mjs [options] <flow.json> [more.json ...]

Options:
  --board <choice>   Check pins against a board or processor, e.g. board:freenove-s3-4in (see --list-boards)
  --out <file.py>    Write the generated MicroPython here (one flow only)
  --json             Print the result as JSON (one object per flow, in an array) instead of text
  --strict           Warnings fail the check too
  --no-syntax        Skip the MicroPython syntax check of the generated code (mpy-cross)
  --arch <march>     mpy-cross -march for that check (default xtensawin)
  --list-boards      Print the values --board takes
  --help             This text

Checks: the file parses, every node type exists, every wire is one the editor would accept, the flow compiles
(pins, properties, GUI layouts), and the generated code is valid MicroPython. It cannot check WiFi or MQTT
credentials (the secrets live in the backend) or a custom node package.`;

interface Args {
  files: string[];
  board?: string;
  out?: string;
  json: boolean;
  strict: boolean;
  syntax: boolean;
  arch: string;
}

function parseArgs(argv: string[]): Args | string {
  const a: Args = { files: [], json: false, strict: false, syntax: true, arch: "xtensawin" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string | undefined => {
      const v = argv[++i];
      return v === undefined || v.startsWith("--") ? undefined : v;
    };
    switch (arg) {
      case "--help": case "-h": return "help";
      case "--list-boards": return "boards";
      case "--json": a.json = true; break;
      case "--strict": a.strict = true; break;
      case "--no-syntax": a.syntax = false; break;
      case "--board": { const v = value(); if (!v) return "--board needs a value (see --list-boards)"; a.board = v; break; }
      case "--out": { const v = value(); if (!v) return "--out needs a file name"; a.out = v; break; }
      case "--arch": { const v = value(); if (!v) return "--arch needs a value, e.g. xtensawin"; a.arch = v; break; }
      default:
        if (arg.startsWith("--")) return `unknown option ${arg}`;
        a.files.push(arg);
    }
  }
  if (a.files.length === 0) return "no flow file given";
  if (a.out && a.files.length > 1) return "--out takes one flow file";
  return a;
}

interface MpyModule {
  FS: { writeFile(p: string, d: string): void; unlink(p: string): void };
  callMain(args: string[]): number;
}

/** The mpy-cross check: the same WASM the editor deploys with, found beside the built CLI. Null when unavailable. */
async function loadMpyCross(): Promise<((source: string, arch: string) => string | null) | { unavailable: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromEnv = process.env.THINGSTUDIO_MPY_CROSS_DIR;
  const candidates = [...(fromEnv ? [join(fromEnv, "mpy-cross.mjs")] : []), join(here, "..", "public", "vendor", "mpy-cross", "mpy-cross.mjs"), join(here, "..", "..", "public", "vendor", "mpy-cross", "mpy-cross.mjs")];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return { unavailable: "mpy-cross was not found next to the CLI (editor/public/vendor/mpy-cross), so the MicroPython syntax check was skipped." };
  try {
    const mod = (await import(pathToFileURL(path).href)) as { default: (o: object) => Promise<MpyModule> };
    const lines: string[] = [];
    const wasmBinary = readFileSync(join(dirname(path), "mpy-cross.wasm"));
    const m = await mod.default({ wasmBinary, print: () => {}, printErr: (t: string) => lines.push(t) });
    return (source, arch) => {
      lines.length = 0;
      m.FS.writeFile("/in.py", source);
      try { m.FS.unlink("/out.mpy"); } catch { /* no earlier output */ }
      const code = m.callMain(["-march=" + arch, "-o", "/out.mpy", "/in.py"]);
      return code === 0 ? null : lines.join("\n") || `mpy-cross exited ${code}`;
    };
  } catch (err) {
    return { unavailable: `mpy-cross could not be loaded (${err instanceof Error ? err.message : String(err)}), so the MicroPython syntax check was skipped.` };
  }
}

function printText(file: string, r: CheckResult): void {
  if (r.ok) {
    const s = r.stats!;
    console.log(`OK  ${file}: ${s.nodes} nodes, ${s.wires} wires, ${s.configs} configs, ${s.bytes} bytes of MicroPython, ${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}`);
  } else {
    console.log(`FAIL  ${file}: ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}`);
  }
  for (const e of r.errors) console.log(`  error: ${e.message}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  for (const n of r.notes) console.log(`  note: ${n}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === "help") { console.log(USAGE); return 0; }
  if (args === "boards") { console.log(boardChoices().join("\n")); return 0; }
  if (typeof args === "string") { console.error(`thingstudio-compile: ${args}\n\n${USAGE}`); return 2; }

  const mpy = args.syntax ? await loadMpyCross() : null;
  const results: { file: string; result: CheckResult }[] = [];
  let code = 0;
  for (const file of args.files) {
    let text: string;
    try {
      text = readFileSync(resolve(file), "utf8");
    } catch (err) {
      console.error(`thingstudio-compile: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    const result = checkFlowText(text, { board: args.board });
    if (result.ok && mpy) {
      if (typeof mpy === "function") {
        const problem = mpy(result.source!, args.arch);
        if (problem) {
          result.ok = false;
          result.errors.push({ message: `the generated MicroPython does not compile (mpy-cross): ${problem}` });
        }
      } else {
        result.notes.push(mpy.unavailable);
      }
    }
    if (!result.ok || (args.strict && result.warnings.length > 0)) code = 1;
    if (result.ok && args.out) writeFileSync(resolve(args.out), result.source!);
    results.push({ file, result });
  }
  if (args.json) {
    // The source is large and the agent usually wants it in a file: include it only when there is no --out.
    console.log(JSON.stringify(results.map(({ file, result }) => ({ file, ...result, source: args.out ? undefined : result.source })), null, 2));
  } else {
    for (const { file, result } of results) printText(file, result);
    if (args.out && code === 0) console.log(`wrote ${args.out}`);
  }
  return code;
}

main().then((c) => { process.exitCode = c; }, (err) => {
  console.error(`thingstudio-compile: internal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 2;
});
