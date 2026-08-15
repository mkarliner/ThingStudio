import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    // real bundle-size number for rete-spike-briefing.md's "also worth
    // recording" section — no minify-skip, no source maps inflating it.
    sourcemap: false,
  },
});
