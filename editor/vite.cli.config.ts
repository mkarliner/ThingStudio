// Builds the headless compile/validate command (src/cli/thingstudio-compile.ts) to one Node script,
// dist-cli/thingstudio-compile.mjs. `npm run build:cli`. Everything is bundled so the script runs without
// node_modules; the mpy-cross WASM is loaded at run time from public/vendor/mpy-cross.
import { defineConfig } from "vite";

export default defineConfig({
  define: { __RUNTIME_BUILD_SHA__: JSON.stringify(null), __EDITOR_BUILD__: JSON.stringify(null) },
  build: {
    ssr: "src/cli/thingstudio-compile.ts",
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "thingstudio-compile.mjs", format: "es" } },
  },
  ssr: { noExternal: true },
});
