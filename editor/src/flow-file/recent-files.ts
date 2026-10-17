// SPDX-License-Identifier: Apache-2.0
// editor/src/flow-file/recent-files.ts
//
// File -> Open Recent (Mike, 2026-10-17): the flow files this browser opened or saved most recently, newest
// first. Kept in this browser's IndexedDB, because a file handle (file-io.ts) can be stored there and nowhere
// else -- not in localStorage, and not on the backend, which never sees flow files (decisions/backend.md,
// 2026-09-08). So the list is per browser: another browser, or a private window, has its own.
//
// The list logic (addRecent/removeRecent) is pure and unit-tested; loadRecents/storeRecents are a thin
// IndexedDB wrapper and fail soft -- a browser that blocks storage just has no recent files, nothing breaks.

import type { FlowFileHandle } from "./file-io.js";

export const MAX_RECENT = 8;

export interface RecentFile {
  handle: FlowFileHandle;
  /** The file name when it was last used (the handle's own name). */
  name: string;
  /** The flow name inside the file, shown next to the file name. */
  flowName: string;
  /** When it was last opened or saved, ms since the epoch. */
  at: number;
}

async function sameFile(a: FlowFileHandle, b: FlowFileHandle): Promise<boolean> {
  if (a === b) return true;
  if (a.isSameEntry) {
    try {
      return await a.isSameEntry(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** The list with `entry` at the top: any older entry for the same file is dropped, and the list is capped. */
export async function addRecent(list: readonly RecentFile[], entry: RecentFile, max = MAX_RECENT): Promise<RecentFile[]> {
  const rest: RecentFile[] = [];
  for (const r of list) if (!(await sameFile(r.handle, entry.handle))) rest.push(r);
  return [entry, ...rest].slice(0, max);
}

/** The list without the entry for this file. */
export async function removeRecent(list: readonly RecentFile[], handle: FlowFileHandle): Promise<RecentFile[]> {
  const out: RecentFile[] = [];
  for (const r of list) if (!(await sameFile(r.handle, handle))) out.push(r);
  return out;
}

const DB_NAME = "thingstudio-editor";
const STORE = "recent-files";
const KEY = "list";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The stored list, or [] if there is none or storage is unavailable. */
export async function loadRecents(): Promise<RecentFile[]> {
  try {
    const db = await openDb();
    return await new Promise<RecentFile[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as RecentFile[]) : []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Stores the list. Returns false (never throws) if storage is unavailable. */
export async function storeRecents(list: readonly RecentFile[]): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put([...list], KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}
