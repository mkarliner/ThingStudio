// SPDX-License-Identifier: Apache-2.0
// editor/src/compiler/flow-dependencies.ts
//
// Flow dependencies (2026-10-07, docs/working-notes/flow-dependencies-scoping.md): which libraries a
// compiled flow imports, and which of those a board still needs sent. Pure functions only; main.ts's
// Deploy handler does the fetching, compiling and sending.
//
// What a flow needs is read from the final generated Python, not declared per node type: every
// `import x` / `from x import` line, so node codegen imports and function-node code are covered by
// the same rule. A module the library list (runtime_manifest.py's DEPENDENCIES, served by the backend
// at /api/dependencies) doesn't know is assumed to be built into the firmware (machine, network...).
// Matches test/hil/hil_common.py's imported_modules(), which host test tools use.

import type { DepCommitMessage, DepPutMessage } from "../protocol/messages.js";

/** One library, as /api/dependencies describes it. */
export interface DependencyInfo {
  readonly name: string;
  readonly requires: readonly string[];
  /** Board file name ("mqtt_as.py") and Python source. */
  readonly files: readonly { readonly name: string; readonly source: string }[];
}

const IMPORT_LINE = /^[ \t]*(?:import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)|from[ \t]+([\w.]+)[ \t]+import\b)/gm;

/** Top-level module names imported anywhere in `source` ("from a.b import c" -> "a"). A line inside a
 * string can match too; harmless, since only names in the library list matter. */
export function findImportedModules(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(IMPORT_LINE)) {
    const names = m[1] !== undefined ? m[1].split(",") : [m[2]!];
    for (const n of names) {
      const top = n.trim().split(".")[0]!;
      if (top) out.add(top);
    }
  }
  return out;
}

/** The libraries `modules` need, including what they `require`, each once. Throws on a `requires` the
 * list doesn't contain (a broken list, said plainly rather than a half-installed flow). */
export function resolveDependencies(modules: Iterable<string>, list: readonly DependencyInfo[]): DependencyInfo[] {
  const byName = new Map(list.map((d) => [d.name, d]));
  const byModule = new Map<string, DependencyInfo>();
  for (const d of list) for (const f of d.files) byModule.set(f.name.replace(/\.py$/, ""), d);

  const out: DependencyInfo[] = [];
  const seen = new Set<string>();
  const todo: DependencyInfo[] = [];
  for (const m of [...modules].sort()) {
    const d = byModule.get(m);
    if (d) todo.push(d);
  }
  while (todo.length > 0) {
    const d = todo.shift()!;
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    out.push(d);
    for (const r of d.requires) {
      const req = byName.get(r);
      if (!req) throw new Error(`library "${d.name}" requires "${r}", which isn't in the library list`);
      todo.push(req);
    }
  }
  return out;
}

/** Content fingerprint for one library's compiled files: SHA-256 over each file's name, length and
 * bytes in name order, first 16 hex characters. Same scheme as hil_common.py's dependency_hash(). */
export async function dependencyHash(files: Readonly<Record<string, Uint8Array>>): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const name of Object.keys(files).sort()) {
    const data = files[name]!;
    parts.push(enc.encode(`${name}\n${data.length}\n`), data);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Which of `needed` ({name: hash}) to send, given what the board reported holding. With no
 * inventory (no HELLO, or a board too old to report one) everything is sent. */
export function librariesToSend(needed: Readonly<Record<string, string>>, inventory: Readonly<Record<string, string>> | null): string[] {
  return Object.keys(needed)
    .sort()
    .filter((name) => inventory === null || inventory[name] !== needed[name]);
}

/** Size of one DEP_PUT piece. Small on purpose: the board decodes each message whole, and a fragmented
 * heap (a display flow's framebuffer on a classic ESP32, 2026-10-07) may not have one large block. */
export const LIBRARY_PIECE_BYTES = 1024;

/** The DEP_PUT pieces for one library's compiled files, in order, then its DEP_COMMIT. */
export function libraryMessages(
  name: string,
  hash: string,
  files: Readonly<Record<string, Uint8Array>>,
  pieceBytes = LIBRARY_PIECE_BYTES,
): { pieces: DepPutMessage[]; commit: DepCommitMessage } {
  const pieces: DepPutMessage[] = [];
  const sizes: Record<string, number> = {};
  for (const file of Object.keys(files).sort()) {
    const data = files[file]!;
    sizes[file] = data.length;
    for (let offset = 0; offset < Math.max(data.length, 1); offset += pieceBytes) {
      pieces.push({ type: "DEP_PUT", name, file, offset, total: data.length, data: data.subarray(offset, offset + pieceBytes) });
    }
  }
  return { pieces, commit: { type: "DEP_COMMIT", name, hash, files: sizes } };
}
