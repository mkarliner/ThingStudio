// SPDX-License-Identifier: Apache-2.0
// editor/src/flow-file/custom-node-io.ts
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20) -- the browser-facing half of loading a custom
// node package, same split file-io.ts already established for flow files
// (this module owns raw file access only; parsing/validating what comes
// back is node-library/custom-node.ts's job, same as flow-file.ts owns
// flow file parsing while file-io.ts just gets bytes off disk).
//
// A custom node package is exactly two files sharing a base name --
// `<name>.node.json` (descriptor) and `<name>.node.py` (behavior), picked
// together in one native multi-select file dialog (no directory picker,
// no project-scan -- see the scoping note's Decision 4 for why: this
// reuses file-io.ts's existing picker pattern rather than building new
// browser-permission/directory-watch machinery for a session-scoped
// feature). Deliberately reuses file-io.ts's own two-tier approach
// (File System Access API where available, `<input type=file multiple>`
// fallback for Safari/Firefox) rather than inventing a third pattern.

interface FileSystemFileHandleLike {
  getFile(): Promise<{ name: string; text(): Promise<string> }>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface FileSystemAccessWindow {
  showOpenFilePicker?(opts: OpenFilePickerOptions): Promise<FileSystemFileHandleLike[]>;
}

const CUSTOM_NODE_FILE_TYPES = [{ description: "Thingstudio custom node package", accept: { "application/json": [".json"], "text/x-python": [".py"] } }];

export class CustomNodeFileIoError extends Error {}

export interface CustomNodePackageFiles {
  jsonText: string;
  jsonName: string;
  pythonText: string;
  pythonName: string;
}

function baseName(name: string, suffix: string): string | null {
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : null;
}

/** Matches exactly two picked files as one `<name>.node.json` +
 * `<name>.node.py` pair. Throws CustomNodeFileIoError with a specific,
 * actionable reason on anything else (wrong count, wrong extensions,
 * mismatched base names) -- this project's fault-handling priority applied
 * to file I/O the same way flow-file.ts's parseFlowFile already gets it
 * for the flow-file format. */
function pairFiles(files: { name: string; text: string }[]): CustomNodePackageFiles {
  if (files.length !== 2) {
    throw new CustomNodeFileIoError(`select exactly 2 files (a "<name>.node.json" and a "<name>.node.py"), got ${files.length}`);
  }
  const json = files.find((f) => f.name.endsWith(".node.json"));
  const py = files.find((f) => f.name.endsWith(".node.py"));
  if (!json || !py) {
    throw new CustomNodeFileIoError(`expected one "*.node.json" and one "*.node.py" file, got "${files[0]!.name}" and "${files[1]!.name}"`);
  }
  const jsonBase = baseName(json.name, ".node.json");
  const pyBase = baseName(py.name, ".node.py");
  if (jsonBase !== pyBase) {
    throw new CustomNodeFileIoError(`"${json.name}" and "${py.name}" don't share a base name -- rename them to e.g. "my_sensor.node.json" / "my_sensor.node.py"`);
  }
  return { jsonText: json.text, jsonName: json.name, pythonText: py.text, pythonName: py.name };
}

/** Resolves to the matched pair's text, or `null` if the user cancels.
 * Throws CustomNodeFileIoError if what was picked doesn't form a valid
 * pair (see pairFiles above). */
export async function loadCustomNodePackageFromDisk(): Promise<CustomNodePackageFiles | null> {
  const w = window as unknown as FileSystemAccessWindow;
  if (w.showOpenFilePicker) {
    let handles: FileSystemFileHandleLike[];
    try {
      handles = await w.showOpenFilePicker({ multiple: true, types: CUSTOM_NODE_FILE_TYPES });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null; // user cancelled the picker
      throw err;
    }
    const files = await Promise.all(handles.map(async (h) => ({ file: await h.getFile() })));
    const withText = await Promise.all(files.map(async ({ file }) => ({ name: file.name, text: await file.text() })));
    return pairFiles(withText);
  }

  // Fallback: a hidden <input type=file multiple>, same pattern
  // file-io.ts's openFlowFileFromDisk() uses for browsers without the
  // File System Access API.
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.py";
    input.addEventListener("change", () => {
      const picked = input.files;
      if (!picked || picked.length === 0) {
        resolve(null);
        return;
      }
      Promise.all(Array.from(picked).map(async (f) => ({ name: f.name, text: await f.text() })))
        .then((withText) => resolve(pairFiles(withText)))
        .catch(reject);
    });
    // Same "no reliable cross-browser cancel event" caveat file-io.ts's
    // own fallback documents -- if the user dismisses without choosing
    // files, this promise never resolves. Only reached on browsers
    // without the real picker API.
    input.click();
  });
}
