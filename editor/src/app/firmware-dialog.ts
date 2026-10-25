// SPDX-License-Identifier: Apache-2.0
// editor/src/app/firmware-dialog.ts
//
// The logic behind Tools → Install firmware… (decisions/firmware-catalogue.md, 2026-10-25: Thonny's shape — the
// chip family owns the knowledge, a build is a variant inside a family, a board only points at one). No DOM
// here: main.ts owns the elements, this module decides what a choice means and runs one deterministic flash
// (upload → start → poll), so both halves can be tested without a browser.
//
// The transport is the user's choice, never inferred: it comes from the radio buttons, and a family whose tool
// does not match it is refused before anything runs. A build with no board involved is a complete choice; a
// local file is too, once its family is known.

import type { FirmwareFamily, FirmwareBuild, FirmwareFlashRequest, FirmwareJobState } from "../flow-file/admin-api-client.js";

export interface FirmwareFile {
  readonly name: string;
  readonly body: Blob;
}

export interface FirmwareChoice {
  readonly transport: "serial" | "volume";
  /** The picked or typed port or mounted volume; "" when there was nothing. */
  readonly target: string;
  /** The chip family id; required over a serial port, because it is what says which chip and address. */
  readonly family: string;
  /** The catalogue build and version, or "" when a local file is used instead. */
  readonly build: string;
  readonly version: string;
  /** A file the user chose; it replaces the build. `imagePath` is the same file already uploaded (the editor
   * uploads on pick, to read the chip family out of the image). Either one means "write this file". */
  readonly file: FirmwareFile | null;
  readonly imagePath?: string;
  /** Where the image goes, in bytes, or null to use the family's own address. */
  readonly address: number | null;
  readonly baud: number | null;
  readonly noStub: boolean;
  /** Erase the whole flash before writing (the default: a stale partition table is the "flashed but won't boot"). */
  readonly erase: boolean;
}

const TRANSPORT_WORDS: Record<FirmwareChoice["transport"], string> = {
  serial: "serial port",
  volume: "mounted drive",
};

/** Why this choice cannot be flashed, or null when it can. Every refusal names the thing to change. */
export function choiceProblem(
  choice: FirmwareChoice,
  families: readonly FirmwareFamily[],
  builds: readonly FirmwareBuild[],
): string | null {
  if (!choice.target) {
    return choice.transport === "serial"
      ? "Pick a serial port, or type its path. If the board isn't listed, put it in download mode (hold BOOT, tap RESET) and refresh."
      : "Pick a mounted drive, or type its path. If it isn't listed, hold BOOTSEL while plugging the board in and refresh.";
  }
  const family = choice.family ? families.find((item) => item.id === choice.family) : undefined;
  if (choice.family && !family) return `The chip family "${choice.family}" is not in this build's catalogue.`;
  if (family && (family.tool === "uf2" ? "volume" : "serial") !== choice.transport) {
    return `${family.label} is written over a ${family.tool === "uf2" ? "mounted drive" : "serial port"}, not a ${TRANSPORT_WORDS[choice.transport]}.`;
  }
  const hasImage = Boolean(choice.file || choice.imagePath);
  if (!hasImage && !choice.build) return "Pick a build from the list, or choose an image file.";
  if (hasImage && !family && choice.transport === "serial") {
    return "Pick the chip family for this file, so esptool knows which chip and address to use.";
  }
  const imageName = choice.file?.name ?? choice.imagePath?.split("/").pop() ?? "";
  if (hasImage && imageName) {
    if (choice.transport === "volume" && !imageName.toLowerCase().endsWith(".uf2")) {
      return `${imageName} is not a .uf2 — a mounted drive only takes a .uf2 from micropython.org/download.`;
    }
    if (choice.transport === "serial" && imageName.toLowerCase().endsWith(".uf2")) {
      return `${imageName} is a .uf2 — a serial port takes the .bin MicroPython publishes for the chip.`;
    }
  }
  if (choice.build && !choice.version) return `Pick a version of ${choice.build}.`;
  if (choice.build && !builds.some((item) => item.id === choice.build)) {
    return `The build "${choice.build}" is not in this build's catalogue.`;
  }
  return null;
}

export interface FlashDeps {
  uploadImage(name: string, body: Blob): Promise<{ path: string; family: string | null }>;
  startFlash(request: FirmwareFlashRequest): Promise<string>;
  getJob(id: string): Promise<FirmwareJobState>;
  /** A line for the dialog while a step has no job state yet (e.g. the upload). */
  onStatus(line: string): void;
  onProgress(job: FirmwareJobState): void;
  sleep?(ms: number): Promise<void>;
  pollMs?: number;
  maxPolls?: number;
}

/** Upload when needed, start one job, poll it to the end. Returns the finished job; throws with the backend's
 * own failure line, so the dialog says what happened once rather than retrying. */
export async function flashBoard(choice: FirmwareChoice, deps: FlashDeps): Promise<FirmwareJobState> {
  let imagePath: string | undefined = choice.imagePath;
  if (choice.file) {
    deps.onStatus(`uploading ${choice.file.name}`);
    imagePath = (await deps.uploadImage(choice.file.name, choice.file.body)).path;
  }
  deps.onStatus("starting the flash");
  const request: FirmwareFlashRequest = {
    target: { kind: choice.transport, value: choice.target },
  };
  if (imagePath) request.imagePath = imagePath;
  else {
    request.build = choice.build;
    request.version = choice.version;
  }
  if (choice.family) request.family = choice.family;
  if (choice.address !== null) request.address = choice.address;
  if (choice.baud !== null) request.baud = choice.baud;
  if (choice.noStub) request.noStub = true;
  request.erase = choice.erase;
  const id = await deps.startFlash(request);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = deps.pollMs ?? 250;
  const maxPolls = deps.maxPolls ?? 1200; // 5 minutes at 250 ms: a stuck tool is reported, not waited on forever
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const job = await deps.getJob(id);
    deps.onProgress(job);
    if (job.state === "done") return job;
    if (job.state === "failed") throw new Error(job.error || `the flash failed at ${job.step || "an unknown step"}`);
    await sleep(pollMs);
  }
  throw new Error(`the flash did not finish within ${Math.round((maxPolls * pollMs) / 1000)}s — close this and check the board`);
}

/** The line under the dialog's progress label: what is happening and how far. */
export function jobLine(job: FirmwareJobState): string {
  if (job.state === "done") return "Flashed.";
  if (job.state === "failed") return job.error;
  const where = job.step === "download" ? "preparing the image" : `${job.tool} on ${job.target}`;
  return `${job.progress}% — ${job.line || where}`;
}

/** What to tell the user after a successful flash: whether a runtime install is the next step. */
export function doneLine(build: FirmwareBuild | undefined): string {
  if (build?.runtime === "install") {
    return "Flashed. This image has no Thingstudio runtime: choose Tools → Install runtime… next.";
  }
  return "Flashed. Click Connect to start using the board.";
}
