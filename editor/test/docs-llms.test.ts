// tools/build_llms_txt.py and its mkdocs hook: llms.txt and llms-full.txt for the docs site. Run for real with python3
// into a temp directory; the hook is called the way mkdocs calls it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

describe("llms.txt for the docs site", () => {
  const out = mkdtempSync(join(tmpdir(), "thingstudio-llms-"));
  execFileSync("python3", ["-I", join(root, "tools", "build_llms_txt.py"), "--root", root, "--out", out], { stdio: "pipe" });
  const index = readFileSync(join(out, "llms.txt"), "utf8");
  const full = readFileSync(join(out, "llms-full.txt"), "utf8");

  it("lists the AI-authoring page and the node catalog with their URLs", () => {
    expect(index).toMatch(/^# Thingstudio\n\n> /);
    expect(index).toMatch(/\[Writing flows with an AI assistant\]\(https:\/\/docs\.thingstudio\.net\/ai-authoring\/\): /);
    expect(index).toMatch(/\[Node catalog\]\(https:\/\/docs\.thingstudio\.net\/nodes-catalog\/\)/);
  });

  it("lists every page in the nav, and llms-full.txt carries each one's text", () => {
    const nav = readFileSync(join(root, "mkdocs.yml"), "utf8");
    const pages = [...nav.matchAll(/^ +- .+?: (\S+\.md)\s*$/gm)].map((m) => m[1]!);
    expect(pages.length).toBeGreaterThan(40);
    for (const p of pages) {
      const text = readFileSync(join(root, "docs", "user-guide", p), "utf8");
      expect(full, p).toContain(text.trimEnd().split("\n")[0]!);
    }
    expect(index.match(/^- \[/gm)!.length).toBe(pages.length);
  });

  it("the check mode passes on the real nav", () => {
    const r = execFileSync("python3", ["-I", join(root, "tools", "build_llms_txt.py"), "--root", root, "--check"], { encoding: "utf8" });
    expect(r).toMatch(/nav ok/);
  });

  it("the mkdocs hook writes both files into the site directory", () => {
    const site = mkdtempSync(join(tmpdir(), "thingstudio-site-"));
    const script = `import sys; sys.path.insert(0, ${JSON.stringify(join(root, "tools"))}); import mkdocs_llms_hook as h; h.on_post_build({"config_file_path": ${JSON.stringify(join(root, "mkdocs.yml"))}, "site_dir": ${JSON.stringify(site)}})`;
    execFileSync("python3", ["-I", "-c", script], { stdio: "pipe" });
    expect(readFileSync(join(site, "llms.txt"), "utf8")).toContain("# Thingstudio");
    expect(readFileSync(join(site, "llms-full.txt"), "utf8")).toContain("Source: https://docs.thingstudio.net/ai-authoring/");
  });
});
