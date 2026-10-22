#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// firmware/classic-esp32/gen_deps_index.mjs
//
// Writes /lib/_deps.json for a custom image: the library inventory the board reports in HELLO and
// checks on DEPLOY. Without it, every Deploy would push copies of libraries the image already
// freezes into /lib, where they shadow the frozen ones (deps.ensure_on_path() puts /lib first) and
// the whole heap saving is lost -- the libraries would sit in RAM again.
//
// The hashes must be the ones the editor computes, or nothing matches and the copies get pushed
// anyway (the safe failure: correct, just no saving). So this compiles with the *same* tool the
// editor uses -- the vendored mpy-cross WASM build in editor/public/vendor/mpy-cross -- with the
// same flags (no -march, input always at /in.py), and hashes with the same scheme as
// editor/src/compiler/flow-dependencies.ts's dependencyHash(): SHA-256 over each file's
// "<name>\n<length>\n" + bytes in name order, first 16 hex characters.
//
// Entries carry "files": [] on purpose. The module bytes are in flash as frozen code, not files on
// the filesystem, so deps.missing() must not look for them -- an empty file list means "installed,
// nothing to check", and a hash mismatch still makes the editor push a real copy, which then wins.
//
// Usage: node gen_deps_index.mjs <stage_dir> <out_file>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MPY_CROSS = join(REPO, "editor", "public", "vendor", "mpy-cross");

const [stageArg, outArg] = process.argv.slice(2);
if (!stageArg || !outArg) {
  console.error("usage: node gen_deps_index.mjs <stage_dir> <out_file>");
  process.exit(2);
}
const STAGE = resolve(stageArg);
const OUT = resolve(outArg);

/** Every declared flow dependency, straight from runtime_manifest.py -- not a second list. */
function dependencies() {
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(join(REPO, "device-runtime"))})`,
    "import runtime_manifest as m",
    "print(json.dumps([{'name': d['name'], 'files': [f[1] for f in d['files']]} for d in m.DEPENDENCIES]))",
  ].join("\n");
  const raw = execFileSync("python3", ["-c", script], { encoding: "utf8" });
  return JSON.parse(raw);
}

const { default: createMpyCross } = await import(join(MPY_CROSS, "mpy-cross.mjs"));
const module = await createMpyCross({
  // ENVIRONMENT=web,worker in the vendored build: hand it the bytes rather than relying on a
  // Node filesystem loader it was not built with.
  wasmBinary: readFileSync(join(MPY_CROSS, "mpy-cross.wasm")),
  print: () => {},
  printErr: (t) => console.error(`[mpy-cross] ${t}`),
});

/** Exactly the editor's compileToMpy(source, null): no -march, input at /in.py. */
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

/** Same bytes, same order, same hash as the editor's dependencyHash(). */
function dependencyHash(files) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    const data = Buffer.from(files[name]);
    hash.update(`${name}\n${data.length}\n`);
    hash.update(data);
  }
  return hash.digest("hex").slice(0, 16);
}

const index = {};
for (const dep of dependencies()) {
  const files = {};
  for (const name of dep.files) {
    const mpyName = name.replace(/\.py$/, ".mpy");
    files[mpyName] = compileToMpy(readFileSync(join(STAGE, name), "utf8"));
  }
  index[dep.name] = { hash: dependencyHash(files), files: [] };
}

writeFileSync(OUT, `${JSON.stringify(index, null, 0)}\n`);
console.log(`wrote ${OUT} (${Object.keys(index).length} libraries)`);
