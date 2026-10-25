// SPDX-License-Identifier: Apache-2.0
// editor/src/app/firmware-dialog.ts
//
// The logic behind Tools → Install firmware… (docs/working-notes/editor-firmware-flashing-scoping.md, revised
// 2026-10-25). No DOM here: main.ts owns the elements, this module decides what a choice means and runs one
// deterministic flash (upload → start → poll), so both halves can be tested without a browser.
//
// The transport is the user's choice, never inferred: it comes from the radio buttons, and a target that does
// not match the chosen board's transport is refused before anything runs. A board definition is a shortcut —
// a target plus a file with no board at all is a complete choice.

import type { FirmwareBoardInfo, FirmwareJobState } from "../flow-file/admin-api-client.js";

export interface FirmwareFile {
  readonly name: string;
  readonly body: Blob;
}

export interface FirmwareChoice {
  readonly transport: "serial" | "volume";
  /** The picked port or mounted volume; "" when the list had nothing. */
  readonly target: string;
  /** The board definition's id, or "" to flash a chosen file with no board involved. */
  readonly boardId: string;
  /** A file the user chose; it overrides the board's image but still uses the board's tool and hash. */
  readonly file: FirmwareFile | null;
}

const TRANSPORT_WORDS: Record<FirmwareChoice["transport"], string> = {
  serial: "serial port",
  volume: "mounted drive",
};

/** Why this choice cannot be flashed, or null when it can. Every refusal names the thing to change. */
export function choiceProblem(choice: FirmwareChoice, boards: readonly FirmwareBoardInfo[]): string | null {
  const board = choice.boardId ? boards.find((item) => item.id === choice.boardId) : undefined;
  if (!choice.target) {
    return choice.transport === "serial"
      ? "Pick a serial port. If the board isn't listed, put it in download mode (hold BOOT, tap RESET) and refresh."
      : "Pick a mounted drive. If it isn't listed, hold BOOTSEL while plugging the board in and refresh.";
  }
  if (!board && !choice.file) {
    return "Pick a board with a known image, or choose an image file from micropython.org/download.";
  }
  if (board && board.transport !== choice.transport) {
    return `${board.label} flashes over a ${TRANSPORT_WORDS[board.transport]}, not a ${TRANSPORT_WORDS[choice.transport]}.`;
  }
  if (choice.file && choice.transport === "volume" && !choice.file.name.toLowerCase().endsWith(".uf2")) {
    return `${choice.file.name} is not a .uf2 — a mounted drive only takes a .uf2 from micropython.org/download.`;
  }
  return null;
}

export interface FlashDeps {
  uploadImage(name: string, body: Blob): Promise<{ path: string }>;
  startFlash(
    target: { kind: "serial" | "volume"; value: string },
    boardId: string | undefined,
    imagePath: string | undefined,
  ): Promise<string>;
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
  let imagePath: string | undefined;
  if (choice.file) {
    deps.onStatus(`uploading ${choice.file.name}`);
    imagePath = (await deps.uploadImage(choice.file.name, choice.file.body)).path;
  }
  deps.onStatus("starting the flash");
  const id = await deps.startFlash(
    { kind: choice.transport, value: choice.target },
    choice.boardId || undefined,
    imagePath,
  );
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
export function doneLine(board: FirmwareBoardInfo | undefined): string {
  if (board?.runtime === "install") {
    return "Flashed. This image has no Thingstudio runtime: choose Tools → Install runtime… next.";
  }
  return "Flashed. Click Connect to start using the board.";
}
