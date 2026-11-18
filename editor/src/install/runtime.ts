// SPDX-License-Identifier: Apache-2.0
// editor/src/install/runtime.ts
//
// Install runtime, from the install page: the browser's version of the backend's install (ws_relay.py's
// _install_runtime_exclusive, runtime_installer.py), in the same order. Catch a prompt (a running listener
// ignores Ctrl-C; a Pico doesn't reset on open) -> is it a ThingStudio image? -> push the boot script alone, or
// the whole runtime precompiled to .mpy -> reset. One path, each failure named by its step.

import { runtimeSources } from "virtual:runtime-sources";
import { explainInstallFailure, type Advice } from "../app/board-diagnosis.js";
import { isRomUsbBootloader } from "./catalogue.js";
import { CATCH_STEP, ENTER_STEP, RawReplError, boardMachine, catchPrompt, classifyReply, installRuntime, isFrozenImage, type ClosableLink } from "../raw-repl/raw-repl.js";
import { frozenInstall, fullInstall } from "../raw-repl/runtime-files.js";
import { openSerialLink, type SerialPortLike } from "../raw-repl/web-serial-link.js";
import { frameLine } from "../protocol/transport.js";

/** A running listener ignores Ctrl-C, and a Pico doesn't reset when the port opens, so a board that already has the
 * runtime would wait for a reset (2026-11-18, Mike's Pico). Ask it to stop with its own STOP_TO_PROMPT, as the
 * editor does before an install: a newline first, so the Ctrl-C byte before it can't spoil the frame. */
const ASK_LISTENER_TO_STOP = (() => {
  const frame = frameLine({ type: "STOP_TO_PROMPT" });
  const out = new Uint8Array(frame.length + 1);
  out[0] = 0x0a;
  out.set(frame, 1);
  return out;
})();

/** How long Install runtime waits for the board to stop at a prompt (ws_relay.py's _INSTALL_CATCH_TIMEOUT_SECONDS). */
const CATCH_TIMEOUT_MS = 60_000;

type MpyCross = { FS: { writeFile(p: string, d: string): void; readFile(p: string): Uint8Array; unlink(p: string): void }; callMain(args: string[]): number };
type CreateMpyCross = (opts: { print: (t: string) => void; printErr: (t: string) => void }) => Promise<MpyCross>;

/** The runtime's .py files as plain bytecode (no -march: the runtime has no native code, so one set suits every
 * chip). 2026-09-25: an ESP32-C3 compiling mqtt_as at import ran its WiFi out of memory. A failure here returns
 * an empty map and the install goes ahead from source, as the installed editor does, with a line saying so. */
async function precompile(onStatus: (text: string) => void): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  try {
    const w = window as unknown as { __thingstudioCreateMpyCross?: CreateMpyCross };
    const deadline = Date.now() + 10_000;
    while (!w.__thingstudioCreateMpyCross) {
      if (Date.now() > deadline) throw new Error("mpy-cross didn't load");
      await new Promise((r) => setTimeout(r, 20));
    }
    const errors: string[] = [];
    const mpy = await w.__thingstudioCreateMpyCross({ print: () => undefined, printErr: (t) => errors.push(t) });
    for (const f of runtimeSources.files) {
      if (!f.name.endsWith(".py")) continue;
      mpy.FS.writeFile("/in.py", f.source);
      try {
        mpy.FS.unlink("/out.mpy");
      } catch {
        // nothing from the previous file
      }
      if (mpy.callMain(["-o", "/out.mpy", "/in.py"]) !== 0) throw new Error(`${f.name}: ${errors.join(" ")}`);
      out.set(f.name.replace(/\.py$/, ".mpy"), mpy.FS.readFile("/out.mpy").slice());
    }
  } catch (err) {
    onStatus(`Couldn't precompile the runtime (${err instanceof Error ? err.message : String(err)}); installing it from source.`);
    out.clear();
  }
  return out;
}

/** Opens the chosen port, or, if it's gone (a native-USB board re-enumerating across a reset), another port the user
 * already allowed with the same USB ids. */
function opener(port: SerialPortLike): () => Promise<ClosableLink> {
  const ids = port.getInfo?.() ?? {};
  return async () => {
    try {
      return await openSerialLink(port);
    } catch (first) {
      const serial = (navigator as unknown as { serial?: { getPorts(): Promise<SerialPortLike[]> } }).serial;
      for (const other of (await serial?.getPorts()) ?? []) {
        if (other === port) continue;
        const info = other.getInfo?.() ?? {};
        if (info.usbVendorId !== ids.usbVendorId || info.usbProductId !== ids.usbProductId) continue;
        try {
          return await openSerialLink(other);
        } catch {
          // try the next one
        }
      }
      throw first;
    }
  };
}

export interface InstallResult {
  ok: boolean;
  /** For a failure: what happened, and what to do (the editor's own wording, app/board-diagnosis.ts). */
  advice?: Advice;
  /** For a success: which install it was. */
  frozen?: boolean;
  /** The board, as MicroPython names it ("Raspberry Pi Pico W with RP2040"), so a wrong port shows. */
  machine?: string;
}

/** The whole Install runtime. `onProgress` gets 0-100 across the files pushed. Never throws. */
export async function installRuntimeOn(
  port: SerialPortLike,
  onStatus: (text: string) => void,
  onProgress: (percent: number) => void,
): Promise<InstallResult> {
  let link: ClosableLink | null = null;
  // The ROM bootloader on the chip's own USB never answers Ctrl-C: say so now, not after a minute (2026-11-18, S2).
  if (isRomUsbBootloader(port.getInfo?.() ?? {})) {
    return {
      ok: false,
      advice: { text: "This port is the board's bootloader, still in download mode. Press the board's RESET button, then click Install runtime and pick its port again: it has a new name." },
    };
  }
  try {
    link = await catchPrompt(opener(port), Date.now() + CATCH_TIMEOUT_MS, onStatus, ASK_LISTENER_TO_STOP);
    onStatus("Board stopped. Checking what it runs…");
    const frozen = await isFrozenImage(link);
    // Said before anything is written: with two boards plugged in, the port picker's entries look alike
    // (2026-11-18, Mike's Pico and Pico W).
    const machine = await boardMachine(link);
    onStatus(`Installing on: ${machine}…`);
    const plan = frozen ? frozenInstall(runtimeSources) : fullInstall(runtimeSources, await precompile(onStatus), __RUNTIME_BUILD_SHA__);
    const total = plan.files.reduce((sum, f) => sum + f.data.length, 0) || 1;
    let done = 0;
    await installRuntime(link, plan.files, {
      enter: false,
      remove: plan.remove,
      onProgress: (index, count, name) => {
        onStatus(`Writing ${name} (${index} of ${count})…`);
        onProgress(Math.round((done / total) * 100));
        done += plan.files[index - 1]!.data.length;
      },
    });
    onProgress(100);
    return { ok: true, frozen, machine };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnosis = err instanceof RawReplError && (err.step === ENTER_STEP || err.step === CATCH_STEP) ? classifyReply(err.seen) : null;
    return { ok: false, advice: explainInstallFailure(message, diagnosis) };
  } finally {
    // The outcome is decided above; closing never holds it back (web-serial-link.ts bounds each step).
    await link?.close().catch(() => undefined);
  }
}
