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
