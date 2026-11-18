// SPDX-License-Identifier: Apache-2.0
// editor/src/raw-repl/runtime-files.ts
//
// Which files an install puts on a board and which it removes first: the browser's copy of runtime_installer.py's
// build_file_list(), with_compiled() and install(). The sources come from device-runtime/ at build time
// (vite.config.ts's `virtual:runtime-sources`, read from the same runtime_manifest.py the backend reads), so the
// two installers push the same files. No I/O here.

/** What device-runtime/runtime_manifest.py says, plus the source of each runtime file. */
export interface RuntimeSources {
  /** CORE_FILES then LISTENER_FILE, as (board file name, source text), in push order. */
  readonly files: readonly { readonly name: string; readonly source: string }[];
  readonly mainFile: string;
  readonly bootScript: string;
  /** Vendored libraries runtimes before 7.0.0 kept in the board's root; removed so they don't shadow /lib. */
  readonly legacyRootFiles: readonly string[];
}

/** Holds the git SHA of device-runtime/src, echoed back in HELLO as runtimeBuild (runtime_installer.py). */
export const RUNTIME_BUILD_FILE = "_runtime_build.txt";

export interface RuntimePlan {
  readonly files: { name: string; data: Uint8Array }[];
  readonly remove: string[];
}

const enc = new TextEncoder();

/** The full install for a stock board. Each .py is swapped for its .mpy when `compiled` has one (2026-09-25: an
 * ESP32-C3 compiling mqtt_as at import ran its WiFi out of memory), and the other format's copy is removed, since
 * MicroPython imports x.py before x.mpy. main.py always stays source. */
export function fullInstall(sources: RuntimeSources, compiled: ReadonlyMap<string, Uint8Array>, buildSha: string | null): RuntimePlan {
  const files: { name: string; data: Uint8Array }[] = [];
  const remove: string[] = [];
  for (const f of sources.files) {
    const mpy = f.name.replace(/\.py$/, ".mpy");
    const bytecode = f.name.endsWith(".py") ? compiled.get(mpy) : undefined;
    if (bytecode) {
      files.push({ name: mpy, data: bytecode });
      remove.push(f.name);
    } else {
      files.push({ name: f.name, data: enc.encode(f.source) });
      if (f.name.endsWith(".py")) remove.push(mpy);
    }
  }
  files.push({ name: sources.mainFile, data: enc.encode(sources.bootScript) });
  if (buildSha) files.push({ name: RUNTIME_BUILD_FILE, data: enc.encode(buildSha) });
  for (const name of sources.legacyRootFiles) {
    for (const legacy of name.endsWith(".py") ? [name, name.replace(/\.py$/, ".mpy")] : [name]) {
      if (!remove.includes(legacy)) remove.push(legacy);
    }
  }
  return { files, remove };
}

/** The install for a ThingStudio image, whose runtime is frozen into flash: the boot script only. Pushing the core
 * would shadow the frozen copies and undo the memory the image saves (2026-10-25). */
export function frozenInstall(sources: RuntimeSources): RuntimePlan {
  return { files: [{ name: sources.mainFile, data: enc.encode(sources.bootScript) }], remove: [] };
}
