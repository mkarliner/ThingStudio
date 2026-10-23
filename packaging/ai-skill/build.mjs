#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// packaging/ai-skill/build.mjs
//
// Builds the thingstudio-flow-author skill that Thingstudio users add to their AI assistant (2026-10-23): one folder,
// and a .zip of it, that carries everything needed to write and check a flow without the editor or this repo:
//
//   thingstudio-flow-author/
//     SKILL.md                     packaging/ai-skill/SKILL.md, with the version and docs URL filled in
//     scripts/thingstudio-compile.mjs   the built check command (editor/dist-cli), and the two WASM modules it loads:
//     scripts/vendor/mpy-cross/         the MicroPython syntax check
//     scripts/vendor/micropython-wasi/  the interpreter built-in nodes' compile hooks run in
//     reference/                   the authoring guide, node catalog and node pages, from docs/user-guide/. A link to
//                                  a page not carried here is rewritten to the docs site.
//     examples/                    the flows the guide points at, from test-flows/ and test-flows/ai-authoring/
//     LICENSE, THIRD-PARTY-NOTICES.txt
//
// The skill, checker and docs come from one checkout, so they always describe the same editor. The build refuses to
// package an example that does not compile or does not follow the layout rules, since authors copy the examples.
//
// Usage (from the repo root, after `npm run build:cli` in editor/):
//   node packaging/ai-skill/build.mjs [--out dist/ai-skill] [--version 0.3.0]
// `npm run build:skill` in editor/ does both.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const NAME = "thingstudio-flow-author";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = join(ROOT, "docs", "user-guide");

// The guide pages an author needs. Everything under nodes/ comes too.
const REFERENCE = ["ai-authoring.md", "nodes-catalog.md", "custom-nodes.md", "node-conventions.md", "boards.md", "supported-hardware.md", "check-a-flow.md"];
// The flows ai-authoring.md points at, plus every flow written in the AI-authoring test rounds.
const EXAMPLES = [
  "blink.flow.json",
  "basic-mqtt.flow.json",
  "basic-http-request.flow.json",
  "bmp280-test-flow.flow.json",
  "gui-headliner-sensor-freenove-s3-4in.flow.json",
  "gui-touch-freenove-s3-4in.flow.json",
  "gui-orientation-test-freenove-s3-4in.flow.json",
];

function fail(message) {
  console.error(`build-skill: ${message}`);
  process.exit(1);
}

function args(argv) {
  const a = { out: join(ROOT, "dist", "ai-skill"), version: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") a.out = resolve(argv[++i] ?? fail("--out needs a directory"));
    else if (argv[i] === "--version") a.version = argv[++i] ?? fail("--version needs a value");
    else fail(`unknown argument ${argv[i]}`);
  }
  return a;
}

function version(given) {
  if (given) return given;
  try {
    return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return `dev-${new Date().toISOString().slice(0, 10)}`;
  }
}

function docsUrl() {
  const m = /^site_url:\s*(\S+)/m.exec(readFileSync(join(ROOT, "mkdocs.yml"), "utf8"));
  const url = m ? m[1] : "https://docs.thingstudio.net/";
  return url.endsWith("/") ? url : url + "/";
}

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** The docs-site URL mkdocs gives a page (use_directory_urls): nodes/gui.md -> nodes/gui/, index.md -> "". */
function pageUrl(base, page) {
  const p = page.replace(/\.md$/, "");
  if (p === "index") return base;
  if (p.endsWith("/index")) return base + p.slice(0, -"index".length);
  return base + p + "/";
}

/** A guide page with links to pages the skill doesn't carry pointed at the docs site, and test-flows/ read as examples/. */
function rewritePage(text, page, carried, base) {
  const dir = posix.dirname(page);
  const out = text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) return whole;
    const [path, hash] = target.split("#");
    const resolved = posix.normalize(posix.join(dir, path));
    if (path.endsWith(".md")) {
      if (carried.has(resolved)) return whole;
      return `](${pageUrl(base, resolved)}${hash ? "#" + hash : ""})`;
    }
    // An image or other file: the docs site serves it at the same path.
    return `](${base}${resolved}${hash ? "#" + hash : ""})`;
  });
  return out
    .replaceAll("dist-cli/thingstudio-compile.mjs", "scripts/thingstudio-compile.mjs")
    .replace(/`test-flows\/(ai-authoring\/)?`/g, "`examples/`").replace(/`test-flows\/(ai-authoring\/)?([^`]+\.flow\.json)`/g, "`examples/$2`");
}

function check(cli, flows) {
  const r = spawnSync(process.execPath, [cli, "--layout", "--json", ...flows], { encoding: "utf8" });
  if (r.status === 2 || !r.stdout) fail(`the packaged check could not run:\n${r.stderr}`);
  const results = JSON.parse(r.stdout);
  const problems = [];
  for (const { file, ok, errors, warnings, notes } of results) {
    const name = relative(process.cwd(), file);
    if (!ok) problems.push(`${name}: ${errors.map((e) => e.message).join("; ")}`);
    for (const w of warnings.filter((w) => w.startsWith("layout:"))) problems.push(`${name}: ${w}`);
    for (const n of notes.filter((n) => /skipped|not found|could not/.test(n))) problems.push(`${name}: ${n}`);
  }
  if (problems.length > 0) fail(`an example would teach the wrong thing; fix it in the repo (\`node editor/dist-cli/thingstudio-compile.mjs --relayout <flow>\` fixes the layout):\n  ${problems.join("\n  ")}`);
  return results.length;
}

// A zip with the skill folder at its root, which is the shape Claude's skill upload takes. Deflate, no extras.
function zip(dir, file) {
  const entries = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push(full);
    }
  };
  walk(dir);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const full of entries) {
    const name = Buffer.from(posix.join(NAME, relative(dir, full).split("\\").join("/")));
    const data = readFileSync(full);
    const packed = deflateRawSync(data, { level: 9 });
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, so the same input gives the same zip
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x031e, 4); // made by: unix
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(sum, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...chunks, cd, end]));
  return entries.length;
}

function main() {
  const a = args(process.argv.slice(2));
  const cli = join(ROOT, "editor", "dist-cli", "thingstudio-compile.mjs");
  if (!existsSync(cli)) fail("editor/dist-cli/thingstudio-compile.mjs is missing: run `npm run build:cli` in editor/ first");
  const ver = version(a.version);
  const base = docsUrl();
  const out = join(a.out, NAME);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, "SKILL.md"), readFileSync(join(ROOT, "packaging", "ai-skill", "SKILL.md"), "utf8").replaceAll("{{VERSION}}", ver).replaceAll("{{DOCS_URL}}", base));
  writeFileSync(join(out, "VERSION"), ver + "\n");

  copy(cli, join(out, "scripts", "thingstudio-compile.mjs"));
  const vendor = join(ROOT, "editor", "public", "vendor");
  for (const f of ["mpy-cross/mpy-cross.mjs", "mpy-cross/mpy-cross.wasm", "micropython-wasi/micropython-wasi.wasm"]) copy(join(vendor, f), join(out, "scripts", "vendor", f));

  const pages = [...REFERENCE, ...readdirSync(join(DOCS, "nodes")).filter((f) => f.endsWith(".md")).map((f) => `nodes/${f}`)];
  const carried = new Set(pages);
  for (const page of pages) {
    const text = readFileSync(join(DOCS, page), "utf8");
    mkdirSync(dirname(join(out, "reference", page)), { recursive: true });
    writeFileSync(join(out, "reference", page), rewritePage(text, page, carried, base));
  }

  const flowsDir = join(ROOT, "test-flows");
  const examples = [...EXAMPLES.map((f) => join(flowsDir, f)), ...readdirSync(join(flowsDir, "ai-authoring")).filter((f) => f.endsWith(".flow.json")).sort().map((f) => join(flowsDir, "ai-authoring", f))];
  for (const f of examples) copy(f, join(out, "examples", f.split(/[\\/]/).pop()));

  copy(join(ROOT, "LICENSE"), join(out, "LICENSE"));
  copy(join(ROOT, "packaging", "ai-skill", "THIRD-PARTY-NOTICES.txt"), join(out, "THIRD-PARTY-NOTICES.txt"));

  // The packaged copy, not the repo's, is what is checked: that also proves it finds its own WASM.
  const exampleFiles = readdirSync(join(out, "examples")).map((f) => join(out, "examples", f));
  const n = check(join(out, "scripts", "thingstudio-compile.mjs"), exampleFiles);

  const zipFile = join(a.out, `${NAME}-${ver}.zip`);
  const files = zip(out, zipFile);
  console.log(`built ${relative(process.cwd(), out)} (${ver}): ${files} files, ${n} examples checked\nzip: ${relative(process.cwd(), zipFile)} (${Math.round(statSync(zipFile).size / 1024)} KB)`);
}

main();
