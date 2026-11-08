// SPDX-License-Identifier: Apache-2.0
// editor/test/demo-build.test.ts
//
// The online demo (`vite build --mode demo`, docs/working-notes/online-editor-demo-scoping.md) has no board
// and no backend. This builds both bundles and checks that the demo's JavaScript has none of the code that
// reaches one: no backend API calls, no Web Serial, no WebSocket, no admin-API client, no firmware dialog.
// Each marker must be in the normal build, so a marker that stops meaning anything fails here too.
// The Playwright check (tools/demo_request_check.py) is the runtime half: it records every request.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EDITOR = fileURLToPath(new URL("..", import.meta.url));

/** Text that only the code reaching a board or the backend contains. */
const BACKEND_MARKERS: Record<string, string> = {
  "backend API path": "/api/",
  "admin-API client": "could not reach backend",
  "Web Serial port picker": "requestPort",
  "WebSocket (backend transport)": "WebSocket",
  "firmware dialog": "put it in download mode",
};

/** Text that only the demo contains: the first example flow's node id. */
const DEMO_MARKER = "b1ink0timer00001";

interface Bundle {
  js: string;
  html: string;
}

const out = mkdtempSync(join(tmpdir(), "ts-demo-build-"));
const bundles: Record<"normal" | "demo", Bundle> = { normal: { js: "", html: "" }, demo: { js: "", html: "" } };

async function buildMode(name: "normal" | "demo"): Promise<Bundle> {
  const outDir = join(out, name);
  await build({
    root: EDITOR,
    configFile: join(EDITOR, "vite.config.ts"),
    mode: name === "demo" ? "demo" : "production",
    logLevel: "silent",
    build: { outDir, emptyOutDir: true, copyPublicDir: false },
  });
  const assets = join(outDir, "assets");
  const js = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assets, f), "utf8"))
    .join("\n");
  return { js, html: readFileSync(join(outDir, "index.html"), "utf8") };
}

beforeAll(async () => {
  bundles.normal = await buildMode("normal");
  bundles.demo = await buildMode("demo");
}, 120_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("demo build", () => {
  for (const [what, marker] of Object.entries(BACKEND_MARKERS)) {
    it(`has no ${what}`, () => {
      expect(bundles.normal.js.includes(marker), `marker "${marker}" is not in the normal build any more; pick another`).toBe(true);
      expect(bundles.demo.js.includes(marker), `the demo bundle contains "${marker}" (${what})`).toBe(false);
    });
  }

  it("bundles the examples, and the normal build doesn't", () => {
    expect(bundles.demo.js).toContain(DEMO_MARKER);
    expect(bundles.normal.js).not.toContain(DEMO_MARKER);
  });

  it("marks its page as the demo before any script runs", () => {
    expect(bundles.demo.html).toContain('<body class="demo">');
    expect(bundles.normal.html).not.toContain('class="demo"');
  });
});
