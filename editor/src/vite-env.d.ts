/// <reference types="vite/client" />
// SPDX-License-Identifier: Apache-2.0
// editor/src/vite-env.d.ts
//
// Ambient global injected by vite.config.ts's `define` -- see that
// file's runtimeBuildSha() and CLAUDE.md's "Device-runtime version bump
// discipline". tsc has no visibility into Vite's `define` mechanism, so
// this declares the TYPE only (no value -- `define` supplies the actual
// string at dev-server-start/build/vitest-run time via a real
// find-and-replace; tsc only needs to know it's there and what shape it
// is to typecheck main.ts's reference to it).
declare const __RUNTIME_BUILD_SHA__: string | null;

// The editor's own build identity (vite.config.ts's editorBuild()), shown in the toolbar and About.
declare const __EDITOR_BUILD__: { version: string | null; commit: string | null; dirty: boolean; builtAt: string };

// True only in the online demo build (`vite build --mode demo`, vite.config.ts): no board, no backend.
declare const __DEMO__: boolean;

// The firmware catalogue and the images this site serves (vite.config.ts's firmwareMirror()): the install page's
// only source of builds, so it offers exactly what was built into the site.
declare module "virtual:firmware-catalogue" {
  export const catalogue: import("./install/catalogue.js").Catalogue;
  export const mirrored: readonly string[];
}

// The runtime's files, read from device-runtime/ at build time (vite.config.ts's runtimeSources()).
declare module "virtual:runtime-sources" {
  export const runtimeSources: import("./raw-repl/runtime-files.js").RuntimeSources;
}
