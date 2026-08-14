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

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<{ text(): Promise<string> }>;
}

interface FileSystemAccessWindow {
  showSaveFilePicker?(opts: SaveFilePickerOptions): Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?(opts: SaveFilePickerOptions): Promise<FileSystemFileHandleLike[]>;
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

/** Resolves once the file is written; resolves to `false` (not rejects) if
 * the user cancels the picker -- cancellation isn't an error, same
 * reasoning transport.ts's own connect-failure handling gives for
 * distinguishing "the user chose not to" from "something actually broke". */
export async function saveFlowFileToDisk(text: string, suggestedName: string): Promise<boolean> {
  const w = window as unknown as FileSystemAccessWindow;
  if (w.showSaveFilePicker) {
    let handle: FileSystemFileHandleLike;
    try {
      handle = await w.showSaveFilePicker({ suggestedName, types: FLOW_FILE_TYPES });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return false; // user cancelled the picker
      throw err;
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
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
  return true;
}

/** Resolves to the file's text, or `null` if the user cancels. */
export async function openFlowFileFromDisk(): Promise<string | null> {
  const w = window as unknown as FileSystemAccessWindow;
  if (w.showOpenFilePicker) {
    let handles: FileSystemFileHandleLike[];
    try {
      handles = await w.showOpenFilePicker({ types: FLOW_FILE_TYPES });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null;
      throw err;
    }
    const file = await handles[0]!.getFile();
    return file.text();
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
      file.text().then(resolve);
    });
    // No reliable cross-browser "cancelled" event on <input type=file> --
    // if the user dismisses the dialog without choosing a file, this
    // promise simply never resolves. Acceptable for a fallback path only
    // reached on browsers without the real picker API; the primary path
    // above handles cancellation properly.
    input.click();
  });
}
