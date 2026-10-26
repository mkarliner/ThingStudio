#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// test/hil/dep_compile.mjs
//
// Compiles a flowed library's files the way the editor does, for the host tools that deploy flows
// (test-flows/device_cli.py, deploy_flow.py, the HIL drivers). Prints, per library, the hash the
// board uses in its inventory and where each .mpy was written.
//
// Why not the native mpy-cross the rest of the host tools use: the hash is over the .mpy bytes, and
// mpy-cross embeds the source file's own name in them (byte 7). The editor always compiles the input
// as /in.py; a native build compiling "font_body12.py" therefore produces different bytes, and its
// hash can never match the one a board reports -- which is why a CLI deploy used to push every
// library a flow imports, frozen image or not (2026-10-26). So this uses the same vendored WASM
// mpy-cross as the editor and firmware/classic-esp32/gen_deps_index.mjs, with the same input name and
// no -march, then hashes exactly as editor/src/compiler/flow-dependencies.ts does.
//
// Usage: node dep_compile.mjs <spec.json> <outdir>
//   spec: [{"name": "font_body12", "files": [{"board": "font_body12.mpy", "source": "/abs/font_body12.py"}]}]
//   out:  {"deps": [{"name", "hash", "files": [{"board", "path", "bytes"}]}]}

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MPY_CROSS = join(REPO, "editor", "public", "vendor", "mpy-cross");

const [specArg, outArg] = process.argv.slice(2);
if (!specArg || !outArg) {
  console.error("usage: node dep_compile.mjs <spec.json> <outdir>");
  process.exit(2);
}
const OUT = resolve(outArg);

const { default: createMpyCross } = await import(join(MPY_CROSS, "mpy-cross.mjs"));
const module = await createMpyCross({
  // ENVIRONMENT=web,worker in the vendored build: hand it the bytes rather than relying on a Node
  // filesystem loader it was not built with.
  wasmBinary: readFileSync(join(MPY_CROSS, "mpy-cross.wasm")),
  print: () => {},
  printErr: (t) => console.error(`[mpy-cross] ${t}`),
});

/** Exactly the editor's compileToMpy(source, null): no -march, input always at /in.py. */
function compileToMpy(source) {
  module.FS.writeFile("/in.py", source);
  try {
    module.FS.unlink("/out.mpy");
  } catch {
    // nothing from a previous file to remove
  }
  const rc = module.callMain(["-o", "/out.mpy", "/in.py"]);
  if (rc !== 0) throw new Error(`mpy-cross exited ${rc}`);
  return module.FS.readFile("/out.mpy");
}

/** The editor's dependencyHash(): "<name>\n<length>\n" + bytes per file, in name order, first 16 hex. */
function dependencyHash(files) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    const data = Buffer.from(files[name]);
    hash.update(`${name}\n${data.length}\n`);
    hash.update(data);
  }
  return hash.digest("hex").slice(0, 16);
}

const spec = JSON.parse(readFileSync(specArg, "utf8"));
const deps = [];
for (const dep of spec) {
  const files = {};
  const written = [];
  const dir = join(OUT, dep.name);
  mkdirSync(dir, { recursive: true });
  for (const f of dep.files) {
    const mpy = compileToMpy(readFileSync(f.source, "utf8"));
    const path = join(dir, f.board);
    writeFileSync(path, mpy);
    files[f.board] = mpy;
    written.push({ board: f.board, path, bytes: mpy.length });
  }
  deps.push({ name: dep.name, hash: dependencyHash(files), files: written });
}
process.stdout.write(JSON.stringify({ deps }));
