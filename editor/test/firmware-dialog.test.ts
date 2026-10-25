// SPDX-License-Identifier: Apache-2.0
// editor/test/firmware-dialog.test.ts
//
// The decision and orchestration behind Tools → Install firmware… (decisions/firmware-catalogue.md). main.ts owns
// the DOM; these are the parts worth checking without one: which choices are refused and why, and that a flash
// uploads before it starts and stops on the first failure.

import { describe, expect, it } from "vitest";
import {
  choiceProblem,
  doneLine,
  flashBoard,
  jobLine,
  type FirmwareChoice,
  type FlashDeps,
} from "../src/app/firmware-dialog.js";
import type { FirmwareBuild, FirmwareFamily, FirmwareJobState } from "../src/flow-file/admin-api-client.js";

const FAMILIES: FirmwareFamily[] = [
  { id: "esp32", label: "ESP32", tool: "esptool", chip: "esp32", address: 0x1000 },
  { id: "esp32-s3", label: "ESP32-S3", tool: "esptool", chip: "esp32s3", address: 0 },
  { id: "rp2040", label: "RP2040", tool: "uf2", chip: null, address: 0 },
];

const BUILDS: FirmwareBuild[] = [
  {
    id: "esp32-generic",
    family: "esp32",
    supplier: "micropython",
    label: "ESP32 / WROOM (generic)",
    infoUrl: "https://micropython.org/download/ESP32_GENERIC/",
    runtime: "install",
    tool: "esptool",
    versions: [
      { version: "1.29.0", date: "2026-08-24", url: "https://example.invalid/a.bin", sha256: "a".repeat(64), cached: false },
    ],
  },
  {
    id: "thingstudio-classic-esp32",
    family: "esp32",
    supplier: "thingstudio",
    label: "Thingstudio image",
    infoUrl: "",
    runtime: "install",
    tool: "esptool",
    versions: [
      { version: "14.1.0", date: "2026-10-25", url: "https://example.invalid/b.bin", sha256: "b".repeat(64), cached: true },
    ],
  },
  {
    id: "rpi-pico",
    family: "rp2040",
    supplier: "micropython",
    label: "Raspberry Pi Pico",
    infoUrl: "",
    runtime: "install",
    tool: "uf2",
    versions: [{ version: "1.29.0", date: "", url: "https://example.invalid/p.uf2", sha256: "c".repeat(64), cached: false }],
  },
];

function choice(over: Partial<FirmwareChoice> = {}): FirmwareChoice {
  return {
    transport: "serial",
    target: "/dev/ttyUSB0",
    family: "esp32",
    build: "esp32-generic",
    version: "1.29.0",
    file: null,
    address: null,
    baud: null,
    noStub: false,
    erase: true,
    ...over,
  };
}

function file(name: string): { name: string; body: Blob } {
  return { name, body: new Blob([name]) };
}

function job(over: Partial<FirmwareJobState> = {}): FirmwareJobState {
  return {
    id: "j1",
    state: "running",
    line: "",
    progress: 0,
    error: "",
    step: "flash",
    family: "esp32",
    build: "esp32-generic",
    version: "1.29.0",
    tool: "esptool",
    target: "/dev/ttyUSB0",
    log: [],
    ...over,
  };
}

describe("choiceProblem", () => {
  it("accepts a catalogue build for its own transport", () => {
    expect(choiceProblem(choice(), FAMILIES, BUILDS)).toBeNull();
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", family: "rp2040", build: "rpi-pico" }), FAMILIES, BUILDS)).toBeNull();
  });

  it("accepts a file with its family (the generic path)", () => {
    expect(choiceProblem(choice({ build: "", version: "", file: file("any.bin") }), FAMILIES, BUILDS)).toBeNull();
    expect(choiceProblem(choice({ build: "", version: "", imagePath: "/cache/x.bin" }), FAMILIES, BUILDS)).toBeNull();
  });

  it("asks for a target before anything else, in the words of the chosen transport", () => {
    expect(choiceProblem(choice({ target: "" }), FAMILIES, BUILDS)).toMatch(/Pick a serial port/);
    expect(choiceProblem(choice({ transport: "volume", target: "" }), FAMILIES, BUILDS)).toMatch(/Pick a mounted drive/);
  });

  it("needs a build or a file", () => {
    expect(choiceProblem(choice({ build: "", version: "" }), FAMILIES, BUILDS)).toMatch(/Pick a build/);
  });

  it("needs the chip family for a file over a serial port, because the address comes from it", () => {
    expect(choiceProblem(choice({ family: "", build: "", version: "", file: file("x.bin") }), FAMILIES, BUILDS)).toMatch(/chip family/);
  });

  it("refuses a family whose tool is not this transport", () => {
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", family: "esp32" }), FAMILIES, BUILDS)).toMatch(
      /written over a serial port/,
    );
    expect(choiceProblem(choice({ family: "rp2040", build: "rpi-pico" }), FAMILIES, BUILDS)).toMatch(/written over a mounted drive/);
  });

  it("refuses a file of the wrong kind for the transport", () => {
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", family: "rp2040", build: "", version: "", file: file("x.bin") }), FAMILIES, BUILDS)).toMatch(
      /not a \.uf2/,
    );
    expect(choiceProblem(choice({ build: "", version: "", file: file("x.uf2") }), FAMILIES, BUILDS)).toMatch(/is a \.uf2/);
  });

  it("refuses a build or version the catalogue does not have", () => {
    expect(choiceProblem(choice({ build: "nope" }), FAMILIES, BUILDS)).toMatch(/not in this build's catalogue/);
    expect(choiceProblem(choice({ version: "" }), FAMILIES, BUILDS)).toMatch(/Pick a version/);
    expect(choiceProblem(choice({ family: "nonesuch" }), FAMILIES, BUILDS)).toMatch(/not in this build's catalogue/);
  });
});

describe("flashBoard", () => {
  function deps(jobs: FirmwareJobState[], over: Partial<FlashDeps> = {}) {
    const calls: string[] = [];
    const statuses: string[] = [];
    const progress: FirmwareJobState[] = [];
    const base: FlashDeps = {
      uploadImage: async (name) => {
        calls.push(`upload:${name}`);
        return { path: `/cache/${name}`, family: "esp32" };
      },
      startFlash: async (request) => {
        calls.push(
          `start:${request.target.kind}:${request.target.value}:${request.build ?? "-"}:${request.version ?? "-"}:${request.imagePath ?? "-"}:${request.address ?? "-"}:${request.erase}`,
        );
        return "j1";
      },
      getJob: async () => {
        calls.push("poll");
        const next = jobs.shift();
        if (!next) throw new Error("polled after the end");
        return next;
      },
      onStatus: (line) => statuses.push(line),
      onProgress: (state) => progress.push(state),
      sleep: async () => {},
      pollMs: 0,
      maxPolls: 5,
    };
    return { deps: { ...base, ...over }, calls, statuses, progress };
  }

  it("starts a catalogue build straight away, passing erase", async () => {
    const { deps: d, calls } = deps([job({ state: "done" })]);
    await flashBoard(choice(), d);
    expect(calls).toEqual(["start:serial:/dev/ttyUSB0:esp32-generic:1.29.0:-:-:true", "poll"]);
  });

  it("uploads a chosen file before it starts the flash", async () => {
    const { deps: d, calls } = deps([job({ state: "done", progress: 100 })]);
    await flashBoard(choice({ build: "", version: "", file: file("mine.bin"), address: 0x1000 }), d);
    expect(calls).toEqual(["upload:mine.bin", "start:serial:/dev/ttyUSB0:-:-:/cache/mine.bin:4096:true", "poll"]);
  });

  it("reuses a file the editor already uploaded to read its family", async () => {
    const { deps: d, calls } = deps([job({ state: "done" })]);
    await flashBoard(choice({ build: "", version: "", imagePath: "/cache/x.bin" }), d);
    expect(calls).toEqual(["start:serial:/dev/ttyUSB0:-:-:/cache/x.bin:-:true", "poll"]);
  });

  it("keeps polling while the job runs, then returns it", async () => {
    const { deps: d, calls, progress } = deps([
      job({ state: "running", progress: 10 }),
      job({ state: "running", progress: 60 }),
      job({ state: "done", progress: 100 }),
    ]);
    await flashBoard(choice(), d);
    expect(calls.filter((c) => c === "poll")).toHaveLength(3);
    expect(progress.map((state) => state.progress)).toEqual([10, 60, 100]);
  });

  it("throws the backend's own failure line, once", async () => {
    const { deps: d, calls } = deps([job({ state: "failed", error: "esptool exited 2 at the start on /dev/ttyUSB0" })]);
    await expect(flashBoard(choice(), d)).rejects.toThrow(/esptool exited 2/);
    expect(calls.filter((c) => c === "poll")).toHaveLength(1);
  });

  it("gives up on a job that never finishes, naming the time", async () => {
    const pending = Array.from({ length: 10 }, () => job({ state: "running" }));
    const { deps: d } = deps(pending, { maxPolls: 3, pollMs: 250 });
    await expect(flashBoard(choice(), d)).rejects.toThrow(/did not finish within 1s/);
  });
});

describe("the dialog's lines", () => {
  it("says what a running job is doing, and how far", () => {
    expect(jobLine(job({ progress: 40, line: "Writing at 0x1000" }))).toBe("40% — Writing at 0x1000");
    expect(jobLine(job({ step: "download", line: "" }))).toBe("0% — preparing the image");
    expect(jobLine(job({ state: "done" }))).toBe("Flashed.");
    expect(jobLine(job({ state: "failed", error: "no such image" }))).toBe("no such image");
  });

  it("points at the runtime install only when the image has no runtime", () => {
    expect(doneLine(BUILDS[0]!)).toMatch(/Install runtime/);
    expect(doneLine({ ...BUILDS[0]!, runtime: "none" })).toMatch(/Click Connect/);
    expect(doneLine(undefined)).toMatch(/Click Connect/);
  });
});
