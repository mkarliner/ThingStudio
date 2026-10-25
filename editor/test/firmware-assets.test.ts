// SPDX-License-Identifier: Apache-2.0
// editor/test/firmware-assets.test.ts
//
// If the user guide names a specific image, that file has to be one that was tested and attached,
// or the reader gets a 404 and nothing else in the build notices. So any
// thingstudio-classic-esp32-*.bin the guide mentions must be recorded in
// firmware/classic-esp32/tested.json, which is the list publish.sh attaches from (2026-10-23).
//
// Since 2026-10-25 the page names no image at all: it tells the reader to use whatever they
// downloaded (`IMAGE=$(ls thingstudio-classic-esp32-*.bin)`), because the page has to be right for a
// tag whose image has not been run on a board yet. The vacuity guard below checks that instruction
// instead, and the asset list is three files since the library inventory moved into the image.

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
    // Vacuity guard, in its post-2026-10-25 form: the page must say how to name the downloaded file,
    // so a page that quietly stopped telling the reader what to do still fails here.
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    expect(page, "custom-firmware.md should say how to name the image it downloaded").toMatch(
      /IMAGE=\$?\(ls thingstudio-classic-esp32-\*\.bin\)/,
    );
    const unknown = Object.entries(mentioned).filter(([name]) => !testedImages.has(name));
    expect(
      unknown.map(([name, files]) => `${name} (in ${[...new Set(files)].join(", ")})`),
      "name an image from firmware/classic-esp32/tested.json, or record this one first",
    ).toEqual([]);
  });

  it("tells the reader about the three files the release carries", () => {
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    for (const file of [".sha256", "main.py"]) expect(page).toContain(file);
    // The inventory is frozen into the image now, so it is not a download and not a file to copy.
    expect(page).not.toContain("_deps.json");
  });
});
