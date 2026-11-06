// SPDX-License-Identifier: Apache-2.0
// editor/test/firmware-assets.test.ts
//
// If the user guide names a specific image, that file has to be one that was tested and attached,
// or the reader gets a 404 and nothing else in the build notices. So any thingstudio-<target>-*.bin
// the guide mentions must be recorded in its target's firmware/targets/<target>/tested.json, which is
// what publish.sh attaches from (2026-10-23).
//
// Since 2026-10-25 the page names no image at all: it tells the reader to use whatever they
// downloaded (`IMAGE=$(ls thingstudio-*.bin)`), because the page has to be right for a tag whose
// image has not been run on a board yet. The vacuity guard below checks that instruction instead.
//
// Every target is a folder under firmware/targets/, and these tests iterate them rather than naming
// one ("Scope is not shape", AGENTS.md, 2026-11-04): a new target is checked the day its folder lands.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..");
const TARGETS_DIR = join(REPO, "firmware", "targets");
const GUIDE = join(REPO, "docs", "user-guide");
const IMAGE_RE = /^thingstudio-([a-z0-9-]+?)-(\d+\.\d+\.\d+)-([0-9a-f]{7,40})\.bin$/;

interface TestedEntry {
  image: string;
  board: string;
  date: string;
  tested: string;
}

interface Target {
  id: string;
  label: string;
  family: string;
  address: number;
  tested: Record<string, TestedEntry>;
}

const targets: Target[] = readdirSync(TARGETS_DIR)
  .filter((name) => statSync(join(TARGETS_DIR, name)).isDirectory())
  .sort()
  .map((id) => {
    const facts = JSON.parse(readFileSync(join(TARGETS_DIR, id, "target.json"), "utf8"));
    const tested = JSON.parse(readFileSync(join(TARGETS_DIR, id, "tested.json"), "utf8"));
    return { id, label: facts.label, family: facts.family, address: facts.address, tested };
  });
const record: Record<string, TestedEntry> = Object.assign({}, ...targets.map((t) => t.tested));
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

const CATALOGUE = JSON.parse(readFileSync(join(REPO, "firmware", "builds.json"), "utf8")) as {
  builds: {
    id: string;
    supplier: string;
    family: string;
    label: string;
    address?: number;
    versions: { version: string; url: string; sha256: string }[];
  }[];
};

describe("the flash catalogue", () => {
  it("pins every version with a 64-character sha256 and an https URL", () => {
    expect(CATALOGUE.builds.length).toBeGreaterThan(0);
    for (const build of CATALOGUE.builds) {
      expect(build.versions.length, build.id).toBeGreaterThan(0);
      for (const version of build.versions) {
        expect(version.sha256, `${build.id} ${version.version}`).toMatch(/^[0-9a-f]{64}$/);
        expect(version.url, `${build.id} ${version.version}`).toMatch(/^https:\/\//);
        expect(version.version).toMatch(/^\d+\.\d+/);
      }
    }
  });

  it("contains no build id twice", () => {
    const ids = CATALOGUE.builds.map((build) => build.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only offers a Thingstudio image that its target's board record says was tested", () => {
    // A build we ship under our own name is a build a board ran: each target's tested.json is keyed by sha256, so
    // the catalogue's hash has to be one of that target's keys. This is what stops an untested image being
    // offered as a one-click option (2026-10-25).
    const ours = CATALOGUE.builds.filter((build) => build.supplier === "thingstudio");
    expect(ours.length).toBeGreaterThan(0);
    for (const build of ours) {
      const target = targets.find((t) => `thingstudio-${t.id}` === build.id);
      expect(target, `${build.id}: no firmware/targets/ folder`).toBeDefined();
      expect(build.family, build.id).toBe(target!.family);
      expect(build.address, build.id).toBe(target!.address);
      for (const version of build.versions) {
        expect(version.sha256 in target!.tested, `${build.id} ${version.version}: record it with record-tested.sh`).toBe(true);
      }
    }
  });
});

describe("the firmware page names a tested image", () => {
  it("has at least one recorded image, each keyed by sha256 and named for its own target", () => {
    expect(targets.length).toBeGreaterThan(0);
    expect(Object.keys(record).length).toBeGreaterThan(0);
    for (const target of targets) {
      for (const [hash, entry] of Object.entries(target.tested)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.image.match(IMAGE_RE)?.[1], `${target.id}/tested.json: ${entry.image}`).toBe(target.id);
      }
    }
  });

  it("lists every target on the page", () => {
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    for (const target of targets) expect(page, `custom-firmware.md should list ${target.label}`).toContain(target.label);
  });

  it("never mentions an image that is not in tested.json", () => {
    const mentioned: Record<string, string[]> = {};
    for (const path of markdownFiles(GUIDE)) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/thingstudio-[a-z0-9-]*\d+\.\d+\.\d+-[0-9a-f]+\.bin/g)) {
        const file = path.slice(REPO.length + 1);
        (mentioned[match[0]] ??= []).push(file);
      }
    }
    // Vacuity guard, in its post-2026-10-25 form: the page must say how to name the downloaded file,
    // so a page that quietly stopped telling the reader what to do still fails here.
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    expect(page, "custom-firmware.md should say how to name the image it downloaded").toMatch(
      /IMAGE=\$?\(ls thingstudio-\*\.bin\)/,
    );
    const unknown = Object.entries(mentioned).filter(([name]) => !testedImages.has(name));
    expect(
      unknown.map(([name, files]) => `${name} (in ${[...new Set(files)].join(", ")})`),
      "name an image from a target's tested.json, or record this one first",
    ).toEqual([]);
  });

  it("tells the reader about the three files the release carries", () => {
    const page = readFileSync(join(GUIDE, "custom-firmware.md"), "utf8");
    for (const file of [".sha256", "main.py"]) expect(page).toContain(file);
    // The inventory is frozen into the image now, so it is not a download and not a file to copy.
    expect(page).not.toContain("_deps.json");
  });
});
