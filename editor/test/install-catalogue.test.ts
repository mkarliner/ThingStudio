// SPDX-License-Identifier: Apache-2.0
// editor/test/install-catalogue.test.ts
//
// The install page's catalogue rules (src/install/catalogue.ts), checked against the real catalogue and the real
// built-in definitions. The tests walk every family and build, so a new catalogue entry or processor that the page
// couldn't offer fails here rather than on someone's board (AGENTS.md, "Scope is not shape").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { buildDefinitionSet } from "../src/definitions/definitions.js";
import {
  buildsForFamily,
  familyForChipName,
  imagePath,
  installBuilds,
  installFamilies,
  nextStepLine,
  type Catalogue,
} from "../src/install/catalogue.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(join(REPO, "firmware", "builds.json"), "utf8")) as Catalogue;
const definitions = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
const families = installFamilies(definitions);
const allMirrored = new Set(CATALOGUE.builds.map((b) => b.versions[0]!.sha256));
const builds = installBuilds(CATALOGUE, families, allMirrored);

/** The name esptool-js reports for each chip (its targets' CHIP_NAME), keyed by esptool's chip id. */
const ESPTOOL_JS_CHIP_NAMES: Record<string, string> = {
  esp32: "ESP32",
  esp32s2: "ESP32-S2",
  esp32s3: "ESP32-S3",
  esp32c3: "ESP32-C3",
  esp32c5: "ESP32-C5",
  esp32c6: "ESP32-C6",
  esp32h2: "ESP32-H2",
  esp32p4: "ESP32-P4",
  esp8266: "ESP8266",
};

describe("install page catalogue", () => {
  it("offers every catalogue build: each names a family the definitions can flash", () => {
    for (const build of CATALOGUE.builds) {
      expect(families.some((f) => f.id === build.family), `${build.id}: no flashable processor "${build.family}"`).toBe(true);
    }
    expect(builds.length).toBe(CATALOGUE.builds.length);
  });

  it("recognises every esptool family from the name esptool-js reports", () => {
    for (const family of families.filter((f) => f.tool === "esptool")) {
      const name = ESPTOOL_JS_CHIP_NAMES[family.chip ?? ""];
      expect(name, `${family.id}: add esptool-js's CHIP_NAME for "${family.chip}" to this test`).toBeDefined();
      expect(familyForChipName(name!, families)?.id).toBe(family.id);
    }
    expect(familyForChipName("ESP32-H4", families)).toBeNull();
  });

  it("uses the newest version, served from this site by its sha256", () => {
    for (const build of builds) {
      const source = CATALOGUE.builds.find((b) => b.id === build.id)!;
      expect(build.version).toBe(source.versions[0]!.version);
      expect(build.path).toBe(imagePath(source.versions[0]!.sha256, build.family.tool));
      expect(build.path).toMatch(/^\/firmware\/[0-9a-f]{64}\.(bin|uf2)$/);
      expect(build.fileName.endsWith(build.family.tool === "uf2" ? ".uf2" : ".bin"), build.id).toBe(true);
    }
  });

  it("writes a build at its own address when it has one, else its family's", () => {
    for (const build of builds) {
      const source = CATALOGUE.builds.find((b) => b.id === build.id)!;
      expect(build.address).toBe(source.address ?? build.family.address);
    }
  });

  it("lists ThingStudio's own build first for a family that has one", () => {
    for (const family of families) {
      const list = buildsForFamily(builds, family.id);
      if (list.some((b) => b.supplier === "thingstudio")) expect(list[0]!.supplier, family.id).toBe("thingstudio");
    }
  });

  it("marks a build whose image isn't on the site as unavailable, rather than dropping it", () => {
    const none = installBuilds(CATALOGUE, families, new Set());
    expect(none.length).toBe(builds.length);
    expect(none.every((b) => !b.available)).toBe(true);
  });

  it("says what comes after writing each kind of build", () => {
    for (const build of builds) expect(nextStepLine(build).length, build.id).toBeGreaterThan(10);
  });
});
