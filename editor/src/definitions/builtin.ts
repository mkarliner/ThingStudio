// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/builtin.ts
//
// The built-in processor and board definitions, bundled into the editor so
// they work with no backend (direct WebSerial mode) and no user files. Kept
// separate from definitions.ts because import.meta.glob is a Vite/Vitest
// feature -- definitions.ts itself stays plain TypeScript.

import type { RawDefinitionFile } from "./definitions.js";

const processorFiles = import.meta.glob<unknown>("./processors/*.json", { eager: true, import: "default" });
const boardFiles = import.meta.glob<unknown>("./boards/*.json", { eager: true, import: "default" });

function idOf(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.json$/, "");
}

export const BUILTIN_DEFINITION_FILES: readonly RawDefinitionFile[] = [
  ...Object.entries(processorFiles).map(([path, data]) => ({ kind: "processor" as const, id: idOf(path), source: "built-in", data })),
  ...Object.entries(boardFiles).map(([path, data]) => ({ kind: "board" as const, id: idOf(path), source: "built-in", data })),
];
