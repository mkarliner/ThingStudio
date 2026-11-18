// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
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

// The editor's own version, shown in the toolbar, Help -> About and the browser console (Mike,
// 2026-10-07: a stale build was hard to spot). Release version from backend/pyproject.toml, plus the
// git commit it was built from and whether the tree had uncommitted changes, plus the build time.
// Each part fails open (null) -- a diagnostic must never break the build. --no-optional-locks keeps
// git status from writing .git/index.lock (CLAUDE.md, "Git writes from the agent sandbox").
function editorBuild(): { version: string | null; commit: string | null; dirty: boolean; builtAt: string } {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let version: string | null = null;
  try {
    const m = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(`${root}/backend/pyproject.toml`, "utf8"));
    version = m ? m[1]! : null;
  } catch {
    version = null;
  }
  let commit: string | null = null;
  let dirty = false;
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    dirty = execSync("git --no-optional-locks status --porcelain --untracked-files=no", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch {
    commit = null;
  }
  return { version, commit, dirty, builtAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" };
}

// vue() is needed for `.vue` SFCs to compile at all (rete-migration-
// decision.md's Phase 0 package table) -- src/app/rete/*.vue isn't wired
// into index.html/main.ts yet (that's Phase 3), but this plugin has to be
// registered before any build touches a `.vue` import, so it's added here
// alongside the dependency itself rather than deferred to when main.ts
// actually imports one.
// The demo's page carries class="demo" from the start, so index.html's CSS hides the controls that need a board
// before any script runs (no flash of Connect and Deploy), and the narrow-screen message works without JavaScript.
function demoPage(mode: string): Plugin {
  return {
    name: "thingstudio-demo-page",
    transformIndexHtml(html) {
      if (mode !== "demo") return html;
      const out = html.replace("<body>", '<body class="demo">').replace("<title>Thingstudio</title>", "<title>Thingstudio editor demo</title>");
      if (!out.includes('<body class="demo">')) throw new Error("demo build: index.html has no plain <body> tag to mark");
      return out;
    },
  };
}

// The install page's firmware (docs/working-notes/online-editor-webserial-briefing.md, sections C and D). The page
// offers the newest version of every catalogue build and serves each image from its own origin, named by its sha256:
// a browser can't fetch GitHub release assets, and the page's CSP allows its own origin only. The images come from
// firmware/mirror/, which tools/fetch_firmware_mirror.py fills (downloaded and hash-checked) on a machine with the
// network. A missing image doesn't fail the build: the page lists that build as not on this site, and the plugin
// says which are missing. `virtual:firmware-catalogue` gives the page the catalogue and the set it can offer.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIRROR_DIR = `${REPO_ROOT}/firmware/mirror`;
const FIRMWARE_PATH = /^\/firmware\/([0-9a-f]{64})\.(bin|uf2)$/;

interface MirrorImage {
  sha256: string;
  ext: "bin" | "uf2";
  file: string;
}

function mirrorImages(): { catalogue: unknown; present: MirrorImage[]; missing: string[] } {
  const catalogue = JSON.parse(readFileSync(`${REPO_ROOT}/firmware/builds.json`, "utf8")) as {
    builds: { id: string; versions: { url: string; sha256: string }[] }[];
  };
  const present: MirrorImage[] = [];
  const missing: string[] = [];
  for (const build of catalogue.builds) {
    const newest = build.versions[0];
    if (!newest) continue;
    const ext = newest.url.toLowerCase().endsWith(".uf2") ? "uf2" : "bin";
    const file = `${MIRROR_DIR}/${newest.sha256}.${ext}`;
    if (existsSync(file)) present.push({ sha256: newest.sha256, ext, file });
    else missing.push(build.id);
  }
  return { catalogue, present, missing };
}

function firmwareMirror(mode: string): Plugin {
  const virtualId = "virtual:firmware-catalogue";
  const resolved = `\0${virtualId}`;
  return {
    name: "thingstudio-firmware-mirror",
    resolveId(id) {
      return id === virtualId ? resolved : null;
    },
    load(id) {
      if (id !== resolved) return null;
      const { catalogue, present } = mirrorImages();
      return `export const catalogue = ${JSON.stringify(catalogue)};\nexport const mirrored = ${JSON.stringify(present.map((p) => p.sha256))};\n`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = FIRMWARE_PATH.exec((req.url ?? "").split("?")[0]!);
        const file = m ? `${MIRROR_DIR}/${m[1]}.${m[2]}` : "";
        if (!m || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (mode !== "demo") return;
      const { present, missing } = mirrorImages();
      for (const img of present) {
        this.emitFile({ type: "asset", fileName: `firmware/${img.sha256}.${img.ext}`, source: readFileSync(img.file) });
      }
      if (missing.length > 0) {
        this.warn(`install page: no image in firmware/mirror/ for ${missing.join(", ")} -- run tools/fetch_firmware_mirror.py`);
      }
    },
  };
}

// The online demo (`vite build --mode demo`, docs/working-notes/online-editor-demo-scoping.md): the same editor with
// nothing behind it -- no board, no backend. __DEMO__ is a compile-time constant, so every `if (!__DEMO__)` branch is
// dropped from the demo bundle along with the transports, the admin-API client and the firmware dialog it alone
// reaches (test/demo-build.test.ts checks). Output goes to dist-demo/, beside the normal dist/.
export default defineConfig(({ mode }) => ({
  plugins: [vue(), demoPage(mode), firmwareMirror(mode)],
  define: {
    __RUNTIME_BUILD_SHA__: JSON.stringify(runtimeBuildSha()),
    __EDITOR_BUILD__: JSON.stringify(editorBuild()),
    __DEMO__: JSON.stringify(mode === "demo"),
  },
  // The editor is one ~600 kB chunk (~170 kB gzipped), mostly Vue, Rete and our own code. Vite's 500 kB warning is
  // aimed at sites loaded over the internet; the editor is served by the local backend, so splitting it would add
  // complexity for no load-time gain (2026-10-12). Raise the limit rather than ignore a standing warning, so a
  // real jump (a large dependency pulled in by mistake) still shows up.
  // The online build has a second page, install.html (set up a board: flash it, then the runtime). The installed
  // editor doesn't: its backend flashes, and has its own dialog.
  build: {
    chunkSizeWarningLimit: 800,
    outDir: mode === "demo" ? "dist-demo" : "dist",
    rollupOptions: mode === "demo" ? { input: { index: `${REPO_ROOT}/editor/index.html`, install: `${REPO_ROOT}/editor/install.html` } } : {},
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
}));
