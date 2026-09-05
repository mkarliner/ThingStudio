// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Belt-and-braces runtime-build check (CLAUDE.md's "Device-runtime
// version bump discipline", version.ts's checkRuntimeBuild): this
// editor's own git SHA for device-runtime/src, computed once here (Node
// context -- browser code can't shell out) and inlined into the bundle
// via `define` below. Evaluated once per dev-server start/build/vitest
// run, not per-request -- if device-runtime/src changes while `npm run
// dev` is already running, this goes stale until restart, same category
// of staleness as any other Vite config value; restart after runtime.py
// work, same as you'd restart after editing this file. Fails open
// (null, not a thrown error) if git isn't available -- must never break
// the build/dev-server/test run over a diagnostic-only value.
function runtimeBuildSha(): string | null {
  try {
    const out = execSync("git log -1 --format=%H -- device-runtime/src", {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    const sha = out.trim();
    return sha || null;
  } catch {
    return null;
  }
}

// vue() is needed for `.vue` SFCs to compile at all (rete-migration-
// decision.md's Phase 0 package table) -- src/app/rete/*.vue isn't wired
// into index.html/main.ts yet (that's Phase 3), but this plugin has to be
// registered before any build touches a `.vue` import, so it's added here
// alongside the dependency itself rather than deferred to when main.ts
// actually imports one.
export default defineConfig({
  plugins: [vue()],
  define: {
    __RUNTIME_BUILD_SHA__: JSON.stringify(runtimeBuildSha()),
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
