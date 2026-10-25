// SPDX-License-Identifier: Apache-2.0
// editor/test/firmware-dialog.test.ts
//
// The decision and orchestration behind Tools → Install firmware… (docs/working-notes/
// editor-firmware-flashing-scoping.md). main.ts owns the DOM; these are the parts worth checking without one:
// which choices are refused and why, and that a flash uploads before it starts and stops on the first failure.

import { describe, expect, it } from "vitest";
import {
  choiceProblem,
  doneLine,
  flashBoard,
  jobLine,
  type FirmwareChoice,
  type FlashDeps,
} from "../src/app/firmware-dialog.js";
import type { FirmwareBoardInfo, FirmwareJobState } from "../src/flow-file/admin-api-client.js";

const CYD: FirmwareBoardInfo = {
  id: "cyd",
  label: "CYD",
  tool: "esptool",
  transport: "serial",
  runtime: "none",
  cached: false,
};

const PICO: FirmwareBoardInfo = {
  id: "pico",
  label: "Pico",
  tool: "uf2",
  transport: "volume",
  runtime: "install",
  cached: true,
};

const BOARDS = [CYD, PICO];

function choice(over: Partial<FirmwareChoice> = {}): FirmwareChoice {
  return { transport: "serial", target: "/dev/ttyUSB0", boardId: "", file: null, ...over };
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
    board: "cyd",
    tool: "esptool",
    target: "/dev/ttyUSB0",
    ...over,
  };
}

describe("choiceProblem", () => {
  it("accepts a known board on its own transport", () => {
    expect(choiceProblem(choice({ boardId: "cyd" }), BOARDS)).toBeNull();
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", boardId: "pico" }), BOARDS)).toBeNull();
  });

  it("accepts a file with no board at all (the generic path)", () => {
    expect(choiceProblem(choice({ file: file("any.bin") }), BOARDS)).toBeNull();
  });

  it("asks for a target before anything else, in the words of the chosen transport", () => {
    expect(choiceProblem(choice({ target: "" }), BOARDS)).toMatch(/Pick a serial port/);
    expect(choiceProblem(choice({ transport: "volume", target: "" }), BOARDS)).toMatch(/Pick a mounted drive/);
  });

  it("needs an image: a board or a file", () => {
    expect(choiceProblem(choice(), BOARDS)).toMatch(/choose an image file/);
  });

  it("refuses a board that flashes over the other transport", () => {
    expect(choiceProblem(choice({ boardId: "pico" }), BOARDS)).toMatch(/flashes over a mounted drive/);
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/X", boardId: "cyd" }), BOARDS)).toMatch(
      /flashes over a serial port/,
    );
  });

  it("refuses a non-UF2 file on a mounted drive", () => {
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", file: file("x.bin") }), BOARDS)).toMatch(
      /not a \.uf2/,
    );
    expect(choiceProblem(choice({ transport: "volume", target: "/Volumes/RPI-RP2", file: file("X.UF2") }), BOARDS)).toBeNull();
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
        return { path: `/cache/${name}` };
      },
      startFlash: async (target, boardId, imagePath) => {
        calls.push(`start:${target.kind}:${target.value}:${boardId ?? "-"}:${imagePath ?? "-"}`);
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

  it("uploads a chosen file before it starts the flash", async () => {
    const { deps: d, calls, progress } = deps([job({ state: "done", progress: 100 })]);
    const finished = await flashBoard(choice({ file: file("mine.bin") }), d);
    expect(finished.state).toBe("done");
    expect(calls).toEqual(["upload:mine.bin", "start:serial:/dev/ttyUSB0:-:/cache/mine.bin", "poll"]);
    expect(progress.map((state) => state.state)).toEqual(["done"]);
  });

  it("starts straight away when the board's own image is used", async () => {
    const { deps: d, calls } = deps([job({ state: "done" })]);
    await flashBoard(choice({ boardId: "cyd" }), d);
    expect(calls).toEqual(["start:serial:/dev/ttyUSB0:cyd:-", "poll"]);
  });

  it("keeps polling while the job runs, then returns it", async () => {
    const { deps: d, calls, progress } = deps([
      job({ state: "running", progress: 10 }),
      job({ state: "running", progress: 60 }),
      job({ state: "done", progress: 100 }),
    ]);
    await flashBoard(choice({ boardId: "cyd" }), d);
    expect(calls.filter((c) => c === "poll")).toHaveLength(3);
    expect(progress.map((state) => state.progress)).toEqual([10, 60, 100]);
  });

  it("throws the backend's own failure line, once", async () => {
    const { deps: d, calls } = deps([job({ state: "failed", error: "esptool exited 2 at the start on /dev/ttyUSB0" })]);
    await expect(flashBoard(choice({ boardId: "cyd" }), d)).rejects.toThrow(/esptool exited 2/);
    expect(calls.filter((c) => c === "poll")).toHaveLength(1);
  });

  it("gives up on a job that never finishes, naming the time", async () => {
    const pending = Array.from({ length: 10 }, () => job({ state: "running" }));
    const { deps: d } = deps(pending, { maxPolls: 3, pollMs: 250 });
    await expect(flashBoard(choice({ boardId: "cyd" }), d)).rejects.toThrow(/did not finish within 1s/);
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
    expect(doneLine(PICO)).toMatch(/Install runtime/);
    expect(doneLine(CYD)).toMatch(/Click Connect/);
    expect(doneLine(undefined)).toMatch(/Click Connect/);
  });
});
