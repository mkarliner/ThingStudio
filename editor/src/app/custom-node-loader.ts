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
// backend's: search folders in order, names sorted within a folder.
//
// No Vue or DOM here, so it can be tested with a fake backend (test/custom-node-loader.test.ts).

import { validateCustomNodeDescriptor, type CustomNodeDescriptor } from "../node-library/custom-node.js";

export interface CustomNodeListingEntry {
  name: string;
  /** The descriptor file, for messages, e.g. "~/.thingstudio/custom-nodes/dht22.node.json". */
  file: string;
  /** Set when an earlier search folder has a package of the same name, which is used instead. */
  shadowedBy?: string;
}

export interface CustomNodeListing {
  /** Package names to load, in order. */
  names: string[];
  /** Every package file found, including shadowed ones. */
  packages: CustomNodeListingEntry[];
}

/** The backend calls the loader needs. main.ts passes admin-api-client.ts's functions. */
export interface CustomNodeSource {
  list(): Promise<CustomNodeListing>;
  read(name: string): Promise<{ descriptor: string; implementation: string }>;
}

export interface LoadedCustomNode {
  descriptor: CustomNodeDescriptor;
  pythonSource: string;
  file: string;
}

export interface CustomNodeProblem {
  file: string;
  /** The type id the package claims, when its descriptor got far enough to say. */
  type?: string;
  message: string;
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

/** Lists and loads every package. Throws only if the listing itself fails (no backend, say); every
 * per-package failure is returned in `problems` instead. */
export async function loadAllCustomNodes(source: CustomNodeSource): Promise<CustomNodeLoadResult> {
  const listing = await source.list();
  const fileOf = new Map<string, string>();
  const problems: CustomNodeProblem[] = [];
  for (const p of listing.packages) {
    if (p.shadowedBy) problems.push({ file: p.file, message: `${p.shadowedBy} has the same name and is used instead` });
    else fileOf.set(p.name, p.file);
  }

  const loaded: LoadedCustomNode[] = [];
  const fileOfType = new Map<string, string>();
  for (const name of listing.names) {
    const file = fileOf.get(name) ?? `${name}.node.json`;
    let text: { descriptor: string; implementation: string };
    try {
      text = await source.read(name);
    } catch (err) {
      problems.push({ file, message: errorText(err) });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text.descriptor);
    } catch (err) {
      problems.push({ file, message: `not valid JSON: ${errorText(err)}` });
      continue;
    }
    const type = claimedType(raw);
    let descriptor: CustomNodeDescriptor;
    try {
      descriptor = validateCustomNodeDescriptor(raw);
    } catch (err) {
      problems.push({ file, type, message: errorText(err) });
      continue;
    }
    const earlier = fileOfType.get(descriptor.type);
    if (earlier !== undefined) {
      problems.push({ file, message: `type "${descriptor.type}" is already used by ${earlier}, which is loaded instead` });
      continue;
    }
    fileOfType.set(descriptor.type, file);
    loaded.push({ descriptor, pythonSource: text.implementation, file });
  }
  return { loaded, problems };
}
