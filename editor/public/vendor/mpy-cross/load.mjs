// Thingstudio -- HTML-tag-loaded bridge for the vendored mpy-cross WASM
// build (see mpy-cross.mjs / mpy-cross.wasm in this same directory, and
// docs/third-party-licenses.md for provenance).
//
// Vite's dev server explicitly refuses to have public-dir files imported
// from bundled source (src/app/main.ts originally tried a dynamic
// `import()` of "/vendor/mpy-cross/mpy-cross.mjs" and got: "This file is
// in /public and will be copied as-is during build without going through
// the plugin transforms, and therefore should not be imported from
// source code. It can only be referenced via HTML tags.") -- so this
// file IS that HTML-tag reference: it's loaded via a plain
// `<script type="module" src="/vendor/mpy-cross/load.mjs">` in
// index.html, completely outside Vite's module graph, and its only job
// is to import the real (untouched, hash-verified) mpy-cross.mjs the
// normal unbundled-browser way -- exactly how pocs/poc-d/app.js loaded
// it, no bundler involved -- and publish the factory somewhere
// src/app/main.ts (which Vite DOES bundle) can pick it up from: a global.
import createMpyCross from "./mpy-cross.mjs";
window.__thingstudioCreateMpyCross = createMpyCross;
