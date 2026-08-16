// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// vue() is needed for `.vue` SFCs to compile at all (rete-migration-
// decision.md's Phase 0 package table) -- src/app/rete/*.vue isn't wired
// into index.html/main.ts yet (that's Phase 3), but this plugin has to be
// registered before any build touches a `.vue` import, so it's added here
// alongside the dependency itself rather than deferred to when main.ts
// actually imports one.
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
