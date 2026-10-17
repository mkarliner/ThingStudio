// SPDX-License-Identifier: Apache-2.0
// editor/src/flow-file/file-io.ts
//
// The browser-facing half of flow save/load -- File System Access API
// (Chrome/Edge) with manual download/upload as the fallback elsewhere
// (design doc §4: "manual export/import as the fallback where that API
// isn't available (Safari, Firefox)"). Deliberately separate from
// flow-file.ts's pure format logic, same split as protocol/transport.ts
// (the actual WebSerial I/O) vs. protocol/messages.ts (the wire format) --
// and, like transport.ts's raw port access, this is inherently
// browser-only and NOT unit-testable off-device; that's why it's kept
// this thin, with every real decision (what the file contains, whether
// it's valid) pushed into flow-file.ts instead.
//
// Save / Save As / Open Recent (Mike, 2026-10-17): the picker hands back a
// file handle, kept by main.ts as the flow's current file, so Save writes
// back to it without a dialog, the way any desktop editor does. Handles can
// be stored in IndexedDB (recent-files.ts) and reopened after a reload; the
// browser then asks for permission again (ensurePermission below). The
// fallback browsers have no handles: Save always downloads, and there are no
// recent files. Still no backend involvement (decisions/backend.md,
// 2026-09-08: "just like saving a file from any other editing program").
//
// No `@types/file-system-access` dependency exists for this project (same
// reasoning transport.ts gives for hand-rolling WebSerialPort instead of
// pulling in `@types/web-serial`), so the File System Access API surface
// used here is typed narrowly and locally rather than assumed globally
// ambient.

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

type PermissionMode = "read" | "readwrite";

/** A flow file the browser has given us a handle to (File System Access API). */
export interface FlowFileHandle {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<{ text(): Promise<string>; lastModified: number }>;
  queryPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>;
  isSameEntry?(other: FlowFileHandle): Promise<boolean>;
}

interface FileSystemAccessWindow {
  showSaveFilePicker?(opts: SaveFilePickerOptions): Promise<FlowFileHandle>;
  showOpenFilePicker?(opts: SaveFilePickerOptions): Promise<FlowFileHandle[]>;
}

// A single plain extension, not ".flow.json" -- Chromium's File System
// Access API doesn't reliably match compound/multi-dot extensions in
// `accept`, which is exactly what caused every file (including one just
// saved with that name) to show up greyed out/unselectable in the open
// picker. The OS/browser reports a file's extension as whatever follows
// the LAST dot regardless of what precedes it, so a file literally named
// "flow.flow.json" still has extension ".json" as far as this filter is
// concerned -- the compound name in the suggested filename below is just
// a naming convention, not something the picker needs to match on.
const FLOW_FILE_TYPES = [{ description: "Thingstudio flow", accept: { "application/json": [".json"] } }];

/** A file the editor read or wrote, with the modification time it had then (to spot a change on disk). */
export interface FlowFileRef {
  handle: FlowFileHandle;
  lastModified: number;
}

/** True where the browser can hand back file handles (Chrome, Edge): Save, Save As and recent files work. */
export function supportsFileHandles(): boolean {
  const w = window as unknown as FileSystemAccessWindow;
  return typeof w.showSaveFilePicker === "function" && typeof w.showOpenFilePicker === "function";
}

/** Thrown when the browser refuses access to a file (the user said no, or the browser never asked). */
export class FilePermissionError extends Error {
  constructor(name: string) {
    super(`no permission to use ${name}`);
    this.name = "FilePermissionError";
  }
}

/** Asks for access to a stored handle when the browser doesn't already grant it. Needs a user gesture
 * (a click or key press) to show the prompt; refused access is a FilePermissionError. */
export async function ensurePermission(handle: FlowFileHandle, mode: PermissionMode): Promise<void> {
  if (!handle.queryPermission || !handle.requestPermission) return; // a handle that has no permission model
  if ((await handle.queryPermission({ mode })) === "granted") return;
  if ((await handle.requestPermission({ mode })) !== "granted") throw new FilePermissionError(handle.name);
}

/** Writes `text` to a file the editor already has a handle to (Save). */
export async function writeFlowFile(handle: FlowFileHandle, text: string): Promise<FlowFileRef> {
  await ensurePermission(handle, "readwrite");
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return { handle, lastModified: (await handle.getFile()).lastModified };
}

/** Reads a file the editor already has a handle to (Open Recent). Asks for read and write together, so a
 * Save afterwards needs no second prompt. A moved or deleted file rejects with a NotFoundError. */
export async function readFlowFile(handle: FlowFileHandle): Promise<{ text: string; ref: FlowFileRef }> {
  await ensurePermission(handle, "readwrite");
  const file = await handle.getFile();
  return { text: await file.text(), ref: { handle, lastModified: file.lastModified } };
}

/** The file's modification time now, or null if it can't be read (gone, or no permission). */
export async function currentLastModified(handle: FlowFileHandle): Promise<number | null> {
  try {
    return (await handle.getFile()).lastModified;
  } catch {
    return null;
  }
}

/** Save As: asks where to save and writes there. Resolves to the new file, `null` if the user cancels,
 * or `"downloaded"` on a browser without the picker (a plain download, nothing to save back to). */
export async function saveFlowFileAs(text: string, suggestedName: string): Promise<FlowFileRef | null | "downloaded"> {
  const w = window as unknown as FileSystemAccessWindow;
  if (w.showSaveFilePicker) {
    let handle: FlowFileHandle;
    try {
      handle = await w.showSaveFilePicker({ suggestedName, types: FLOW_FILE_TYPES });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null; // user cancelled the picker
      throw err;
    }
    return writeFlowFile(handle, text);
  }

  // Fallback: manual download, no file handle to write back to later --
  // matches design doc §4's "manual export/import" framing for Safari/
  // Firefox exactly (there's no File System Access API there to pick a
  // real save target, only a browser-driven download).
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return "downloaded";
}

/** Open: resolves to the file's text and, where the browser gives one, its handle; `null` if the user
 * cancels. */
export async function openFlowFileFromDisk(): Promise<{ text: string; ref: FlowFileRef | null } | null> {
  const w = window as unknown as FileSystemAccessWindow;
  if (w.showOpenFilePicker) {
    let handles: FlowFileHandle[];
    try {
      handles = await w.showOpenFilePicker({ types: FLOW_FILE_TYPES });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null;
      throw err;
    }
    const handle = handles[0]!;
    const file = await handle.getFile();
    return { text: await file.text(), ref: { handle, lastModified: file.lastModified } };
  }

  // Fallback: a hidden <input type=file>, the standard workaround where
  // File System Access API isn't available.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.flow.json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then((text) => resolve({ text, ref: null }));
    });
    // No reliable cross-browser "cancelled" event on <input type=file> --
    // if the user dismisses the dialog without choosing a file, this
    // promise simply never resolves. Acceptable for a fallback path only
    // reached on browsers without the real picker API; the primary path
    // above handles cancellation properly.
    input.click();
  });
}
