// SPDX-License-Identifier: Apache-2.0
// editor/test/firmware-assets.test.ts
//
// The firmware page tells people to download a specific file. If the page names an image that was
// never tested or never attached, the reader gets a 404 -- and nothing else in the build notices.
// This is the check that notices: any thingstudio-classic-esp32-*.bin the user guide mentions must be
// an image recorded in firmware/classic-esp32/tested.json, which is also the list publish.sh will
// attach from. Publishing a new image means updating that page line, and this test is what says so
// (2026-10-23).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..");
const RECORD = join(REPO, "firmware", "classic-esp32", "tested.json");
const GUIDE = join(REPO, "docs", "user-guide");

interface TestedEntry {
  image: string;
  board: string;
  date: string;
  tested: string;
}

const record = JSON.parse(readFileSync(RECORD, "utf8")) as Record<string, TestedEntry>;
const testedImages = new Set(Object.values(record).map((entry) => entry.image));

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

describe("the firmware page names a tested image", () => {
  it("has at least one recorded image, each with a 64-character sha256 key", () => {
    const hashes = Object.keys(record);
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    for (const entry of Object.values(record)) expect(entry.image).toMatch(/^thingstudio-classic-esp32-[\d.]+-[0-9a-f]{7}\.bin$/);
  });

  it("never mentions an image that is not in tested.json", () => {
    const mentioned: Record<string, string[]> = {};
    for (const path of markdownFiles(GUIDE)) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/thingstudio-classic-esp32[0-9A-Za-z._-]*\.bin/g)) {
        const file = path.slice(REPO.length + 1);
        (mentioned[match[0]] ??= []).push(file);
      }
    }
    // Vacuity guard: a page that names no image at all would otherwise pass this check.
    expect(Object.keys(mentioned).length, "custom-firmware.md should name the image to download").toBeGreaterThan(0);
    const unknown = Object.entries(mentioned).filter(([name]) => !testedImages.has(name));
    expect(
      unknown.map(([name, files]) => `${name} (in ${[...new Set(files)].join(", ")})`),
      "name an image from firmware/classic-esp32/tested.json, or record this one first",
    ).toEqual([]);
  });

  it("tells the reader about all four files the release carries", () => {
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    for (const file of [".sha256", "_deps.json", "main.py"]) expect(page).toContain(file);
  });
});
