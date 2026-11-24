// SPDX-License-Identifier: Apache-2.0
// editor/src/app/custom-node-loader.ts
//
// Loads every custom node package the backend has (~/.thingstudio/custom-nodes/, and any other folder
// the backend searches), replacing the old one-at-a-time "Load custom node..." picker (Mike, 2026-09-30,
// reversing the 2026-08-20 "session-scoped only" decision -- decisions/node-authoring.md).
//
// Fault handling (CLAUDE.md): one broken package never stops the others. Each problem is returned with
// the file it came from, so the console can name the file to fix. Two packages claiming the same type
// id: the first one wins and the second is reported, never silently replaced. The order is the
// backend's: search folders in order, names sorted within a folder, then the folder's bundles.
//
// Bundles (2026-11-24, interfaces/node-descriptor/SPEC.md §3.1) are all or nothing: if any package in a bundle fails
// to read, parse, validate, or claims a type already taken, every package of that bundle is left out and the bundle is
// reported. The backend already skips bundles with structural problems (a missing .node.py, a taken name, a refused
// library) and says so in `skippedBundles`; refused user libraries arrive as ready-made console lines.
//
// No Vue or DOM here, so it can be tested with a fake backend (test/custom-node-loader.test.ts).

import { validateCustomNodeDescriptor, type CustomNodeDescriptor } from "../node-library/custom-node.js";

export interface CustomNodeListingEntry {
  name: string;
  /** The descriptor file, for messages, e.g. "~/.thingstudio/custom-nodes/dht22.node.json". */
  file: string;
  /** Set when an earlier search folder has a package of the same name, which is used instead. */
  shadowedBy?: string;
  /** The bundle folder name when the package is part of a bundle. */
  bundle?: string;
}

export interface SkippedBundle {
  bundle: string;
  /** The bundle folder, for messages. */
  folder: string;
  problems: string[];
}

export interface CustomNodeListing {
  /** Package names to load, in order. */
  names: string[];
  /** Every package file found, including shadowed ones. */
  packages: CustomNodeListingEntry[];
  /** Bundles the backend skipped whole, with why. */
  skippedBundles?: SkippedBundle[];
  /** One console line per refused user library (library-format SPEC §4). */
  libraryRefusals?: string[];
}

/** The backend calls the loader needs. main.ts passes admin-api-client.ts's functions. */
export interface CustomNodeSource {
  list(): Promise<CustomNodeListing>;
  read(name: string): Promise<{ descriptor: string; implementation: string; compile?: string | null }>;
}

export interface LoadedCustomNode {
  descriptor: CustomNodeDescriptor;
  pythonSource: string;
  /** The package's optional compile-time hook (<name>.compile.py), when it ships one. */
  compileHook?: string;
  file: string;
}

export interface CustomNodeProblem {
  file: string;
  /** The type id the package claims, when its descriptor got far enough to say. */
  type?: string;
  message: string;
  /** A complete console line, used as it is instead of "<file> is not loaded: <message>". */
  line?: string;
}

export interface CustomNodeLoadResult {
  loaded: LoadedCustomNode[];
  problems: CustomNodeProblem[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The `type` a raw descriptor claims, if it's readable at all -- so a flow using that type can be told
 * which file failed, even when the descriptor is otherwise invalid. */
function claimedType(raw: unknown): string | undefined {
  if (typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).type === "string") {
    return (raw as Record<string, unknown>).type as string;
  }
  return undefined;
}

interface Attempt {
  name: string;
  file: string;
  bundle?: string;
  node?: LoadedCustomNode;
  problem?: CustomNodeProblem;
}

/** Lists and loads every package. Throws only if the listing itself fails (no backend, say); every
 * per-package failure is returned in `problems` instead. */
export async function loadAllCustomNodes(source: CustomNodeSource): Promise<CustomNodeLoadResult> {
  const listing = await source.list();
  const fileOf = new Map<string, string>();
  const bundleOf = new Map<string, string>();
  const problems: CustomNodeProblem[] = [];
  for (const line of listing.libraryRefusals ?? []) problems.push({ file: "", message: line, line: `[libraries] ${line}` });
  for (const b of listing.skippedBundles ?? []) {
    for (const why of b.problems) {
      problems.push({ file: b.folder, message: why, line: `[custom nodes] bundle ${b.bundle} is not loaded: ${why}` });
    }
  }
  for (const p of listing.packages) {
    if (p.shadowedBy) problems.push({ file: p.file, message: `${p.shadowedBy} has the same name and is used instead` });
    else {
      fileOf.set(p.name, p.file);
      if (p.bundle) bundleOf.set(p.name, p.bundle);
    }
  }

  // Pass 1: read, parse and validate every package.
  const attempts: Attempt[] = [];
  for (const name of listing.names) {
    const file = fileOf.get(name) ?? `${name}.node.json`;
    const bundle = bundleOf.get(name);
    const attempt: Attempt = { name, file, ...(bundle ? { bundle } : {}) };
    attempts.push(attempt);
    let text: { descriptor: string; implementation: string; compile?: string | null };
    try {
      text = await source.read(name);
    } catch (err) {
      attempt.problem = { file, message: errorText(err) };
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text.descriptor);
    } catch (err) {
      attempt.problem = { file, message: `not valid JSON: ${errorText(err)}` };
      continue;
    }
    const type = claimedType(raw);
    try {
      const descriptor = validateCustomNodeDescriptor(raw);
      attempt.node = { descriptor, pythonSource: text.implementation, ...(text.compile ? { compileHook: text.compile } : {}), file };
    } catch (err) {
      attempt.problem = { file, ...(type !== undefined ? { type } : {}), message: errorText(err) };
    }
  }

  // Pass 2: claim types in order, leaving out failed bundles. A bundle package that loses a type clash fails its
  // bundle, which can free types for later packages, so repeat until nothing changes.
  const failedBundles = new Map<string, string>(); // bundle -> the package file that failed it
  for (const a of attempts) if (a.problem && a.bundle && !failedBundles.has(a.bundle)) failedBundles.set(a.bundle, a.file);
  let loaded: LoadedCustomNode[] = [];
  let clashes: CustomNodeProblem[] = [];
  for (;;) {
    loaded = [];
    clashes = [];
    const fileOfType = new Map<string, string>();
    let newlyFailed = false;
    for (const a of attempts) {
      if (!a.node || (a.bundle && failedBundles.has(a.bundle))) continue;
      const earlier = fileOfType.get(a.node.descriptor.type);
      if (earlier !== undefined) {
        clashes.push({ file: a.file, message: `type "${a.node.descriptor.type}" is already used by ${earlier}, which is loaded instead` });
        if (a.bundle) {
          failedBundles.set(a.bundle, a.file);
          newlyFailed = true;
        }
        continue;
      }
      fileOfType.set(a.node.descriptor.type, a.file);
      loaded.push(a.node);
    }
    if (!newlyFailed) break;
  }

  for (const a of attempts) if (a.problem) problems.push(a.problem);
  problems.push(...clashes);
  for (const [bundle, file] of failedBundles) {
    const message = `${file} didn't load, so the whole bundle is left out`;
    problems.push({ file, message, line: `[custom nodes] bundle ${bundle} is not loaded: ${message}` });
  }
  return { loaded, problems };
}
