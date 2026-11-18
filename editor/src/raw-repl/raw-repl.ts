// SPDX-License-Identifier: Apache-2.0
// editor/src/raw-repl/raw-repl.ts
//
// MicroPython's raw REPL, driven from the browser: the TypeScript port of the backend's raw_repl.py and
// board_recovery.py, for the online build (docs/working-notes/online-editor-webserial-briefing.md, task 4). Same
// protocol, same steps, same step names, same timeouts and the same fixes, each with the incident behind it kept
// in a line here and in full in the Python file:
//
//   Ctrl-C (0x03)  interrupt whatever is running
//   Ctrl-A (0x01)  enter raw REPL; the board replies "raw REPL; CTRL-B to exit\r\n>"
//   code + Ctrl-D  run it; the board replies "OK", stdout, 0x04, stderr, 0x04, then a fresh ">"
//
// Fault handling (AGENTS.md): every read has a deadline, every write a timeout (the link's), and any deviation
// raises a RawReplError naming the step and what came back. One deterministic sequence, no retries.
//
// This module knows nothing about Web Serial: it talks to a ByteLink, so it runs against a fake in tests
// (test/raw-repl.test.ts ports backend/test/test_raw_repl.py's cases). web-serial-link.ts is the real one.

/** A serial line as this module needs it. `read` resolves with whatever arrived within `timeoutMs`, possibly
 * nothing; it never waits for a fixed count (the 2026-09-23 "hang": waiting for 256 bytes when the reply was 4). */
export interface ByteLink {
  write(data: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
}

/** A link that can also be closed, for the steps that reopen the port. */
export interface ClosableLink extends ByteLink {
  close(): Promise<void>;
}

export const CTRL_A = 0x01;
export const CTRL_B = 0x02;
export const CTRL_C = 0x03;
export const CTRL_D = 0x04;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });
const bytes = (text: string): Uint8Array => enc.encode(text);

const RAW_REPL_BANNER = bytes("raw REPL; CTRL-B to exit\r\n>");
const OK = bytes("OK");
const PROMPT = bytes(">");
const EOT = new Uint8Array([CTRL_D]);

/** enterRawRepl()'s step: a failure here says something about what the board runs (classifyReply). */
export const ENTER_STEP = "entering raw REPL";
/** catchPrompt()'s step. */
export const CATCH_STEP = "waiting for the board to stop at a prompt";
/** catchPrompt() never got the port open: nothing was heard because nothing was listening. */
export const OPEN_STEP = "opening the port";

/** 256 raw bytes per base64 chunk: the board holds one chunk's source at a time (ampy/rshell do the same). */
const FILE_CHUNK_SIZE = 256;
/** Pastes go out in 256-byte pieces with a 10 ms pause: raw REPL has no flow control (upstream pyboard.py). */
const WRITE_PIECE_SIZE = 256;
const WRITE_PIECE_PAUSE_MS = 10;
/** How long one read waits before the loop checks its deadline again. */
const POLL_MS = 100;

export interface RawReplTimeouts {
  enterMs: number;
  execMs: number;
}
export const DEFAULT_TIMEOUTS: RawReplTimeouts = { enterMs: 5000, execMs: 5000 };

/** A raw-REPL step failed. `seen` is everything the board sent before it, untruncated, for classifyReply(). */
export class RawReplError extends Error {
  constructor(
    readonly step: string,
    readonly detail: string,
    readonly seen: Uint8Array = new Uint8Array(),
  ) {
    super(`runtime install failed at ${step}: ${detail}`);
    this.name = "RawReplError";
  }
}

export type Reply = "silent" | "micropython" | "circuitpython" | "esp_rom" | "other";

const ESP_ROM_MARKERS = ["waiting for download", "ESP-ROM:", "rst:0x", "ets Jun", "ets Jul"];
const MICROPYTHON_MARKERS = [">>>", "MicroPython", "raw REPL", "Traceback", "KeyboardInterrupt", "SyntaxError"];

/** What is on the other end, from what it said when interrupted (raw_repl.py's classify_reply, 2026-09-23: a
 * blank ESP32-S2 failed with "last seen: ''" and no next step). CircuitPython before MicroPython: both show >>>. */
export function classifyReply(seen: Uint8Array): Reply {
  const text = dec.decode(seen);
  if (!text.trim()) return "silent";
  if (text.includes("CircuitPython")) return "circuitpython";
  if (ESP_ROM_MARKERS.some((m) => text.includes(m))) return "esp_rom";
  if (MICROPYTHON_MARKERS.some((m) => text.includes(m))) return "micropython";
  return "other";
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Text for an error line: printable, control bytes shown as \xNN, the tail if it's long. */
export function showBytes(data: Uint8Array, max = 200): string {
  const tail = data.length > max ? data.slice(data.length - max) : data;
  let out = "";
  for (const b of tail) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : b === 0x0a ? "\\n" : b === 0x0d ? "\\r" : `\\x${b.toString(16).padStart(2, "0")}`;
  return `'${out}'`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A buffer that lives for one exec or one enter: bytes read past a marker stay for the next readUntil (raw_repl.py's
 * _ByteReader; 2026-09-22, a reader that started empty each call lost bytes that arrived in the same chunk). */
class ByteReader {
  private buf: Uint8Array = new Uint8Array();
  constructor(private readonly link: ByteLink) {}

  async readUntil(marker: Uint8Array, deadline: number, step: string): Promise<Uint8Array> {
    for (;;) {
      const idx = indexOf(this.buf, marker);
      if (idx !== -1) {
        const end = idx + marker.length;
        const result = this.buf.slice(0, end);
        this.buf = this.buf.slice(end);
        return result;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new RawReplError(step, `timed out waiting for ${showBytes(marker)}, last seen: ${showBytes(this.buf)}`, this.buf);
      }
      let chunk: Uint8Array;
      try {
        chunk = await this.link.read(Math.min(POLL_MS, left));
      } catch (err) {
        throw new RawReplError(step, `lost the connection to the board (${errorText(err)})`, this.buf);
      }
      if (chunk.length) this.buf = concat(this.buf, chunk);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every write goes through here: 256-byte pieces with a pause, and a failure named by its step. */
async function send(link: ByteLink, data: Uint8Array, step: string): Promise<void> {
  for (let i = 0; i < data.length; i += WRITE_PIECE_SIZE) {
    if (i) await sleep(WRITE_PIECE_PAUSE_MS);
    try {
      await link.write(data.slice(i, i + WRITE_PIECE_SIZE));
    } catch (err) {
      throw new RawReplError(step, `the board stopped accepting data (${errorText(err)})`);
    }
  }
}

/** Interrupts whatever runs and switches to raw REPL. Two Ctrl-Cs, as pyboard.py sends. */
export async function enterRawRepl(link: ByteLink, timeouts: RawReplTimeouts = DEFAULT_TIMEOUTS): Promise<void> {
  await send(link, new Uint8Array([CTRL_C]), ENTER_STEP);
  await send(link, new Uint8Array([CTRL_C]), ENTER_STEP);
  await send(link, new Uint8Array([CTRL_A]), ENTER_STEP);
  await new ByteReader(link).readUntil(RAW_REPL_BANNER, Date.now() + timeouts.enterMs, ENTER_STEP);
}

/** Runs `code` in an entered raw REPL and returns stdout. Anything on stderr is a failure. */
export async function execRaw(link: ByteLink, code: Uint8Array | string, step: string, timeoutMs = DEFAULT_TIMEOUTS.execMs): Promise<Uint8Array> {
  await send(link, typeof code === "string" ? bytes(code) : code, step);
  await send(link, EOT, step);
  const deadline = Date.now() + timeoutMs;
  const reader = new ByteReader(link);
  const echoed = await reader.readUntil(OK, deadline, `${step} (waiting for OK echo)`);
  if (echoed.length !== OK.length) throw new RawReplError(step, `unexpected bytes before OK echo: ${showBytes(echoed)}`, echoed);
  const stdout = (await reader.readUntil(EOT, deadline, `${step} (reading stdout)`)).slice(0, -1);
  const stderr = (await reader.readUntil(EOT, deadline, `${step} (reading stderr)`)).slice(0, -1);
  if (stderr.length) throw new RawReplError(step, `device raised: ${showBytes(stderr)}`, stderr);
  // The fresh ">" after every exec, consumed here or it lands before the next "OK" (2026-09-23, ESP32-S2: ">OK").
  await reader.readUntil(PROMPT, deadline, `${step} (waiting for the next prompt)`);
  return stdout;
}

function base64(data: Uint8Array): string {
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Python's repr of a str, for the file names this module writes (plain ASCII paths). */
function pyStr(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Writes `data` to `destName` on the board in base64 chunks of 256 bytes, one exec each. */
export async function writeFileChunked(link: ByteLink, destName: string, data: Uint8Array, step: string, chunkSize = FILE_CHUNK_SIZE): Promise<void> {
  await execRaw(link, `f=open(${pyStr(destName)},'wb')`, `${step} (open)`);
  const chunks = Math.max(1, Math.ceil(data.length / chunkSize));
  for (let i = 0; i < data.length; i += chunkSize) {
    const b64 = base64(data.slice(i, i + chunkSize));
    await execRaw(link, `import ubinascii\nf.write(ubinascii.a2b_base64(b'${b64}'))`, `${step} (chunk ${i / chunkSize + 1} of ${chunks})`);
  }
  await execRaw(link, "f.close()", `${step} (close)`);
}

/** machine.reset(), without waiting: the other end goes away. Close the link straight after. */
export async function hardReset(link: ByteLink): Promise<void> {
  await send(link, bytes("import machine\nmachine.reset()"), "resetting the board");
  await send(link, EOT, "resetting the board");
}

/** True on a ThingStudio image, recognised by its frozen inventory module (2026-10-25). Enters raw REPL. */
export async function isFrozenImage(link: ByteLink, timeouts: RawReplTimeouts = DEFAULT_TIMEOUTS): Promise<boolean> {
  await enterRawRepl(link, timeouts);
  const out = await execRaw(link, "try:\n import deps_frozen\n print('frozen')\nexcept ImportError:\n print('stock')\n", "checking for a custom image", timeouts.execMs);
  return dec.decode(out).trim() === "frozen";
}

/** The board's chip, as MicroPython reports it: os.uname().machine, e.g. "Raspberry Pi Pico W with RP2040". */
export async function boardMachine(link: ByteLink, timeouts: RawReplTimeouts = DEFAULT_TIMEOUTS): Promise<string> {
  const out = await execRaw(link, "import os\nprint(os.uname().machine)", "asking the board what it is", timeouts.execMs);
  return dec.decode(out).trim();
}

export type ProgressCallback = (index: number, total: number, name: string) => void;

/** Removes `remove`, pushes `files` in order, then resets. Raises from whichever step failed; there is no partial
 * success. Expects raw REPL already entered (isFrozenImage() leaves it there), or enters it when `enter` is set. */
export async function installRuntime(
  link: ByteLink,
  files: readonly { name: string; data: Uint8Array }[],
  options: { timeouts?: RawReplTimeouts; onProgress?: ProgressCallback; remove?: readonly string[]; enter?: boolean } = {},
): Promise<void> {
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
  if (options.enter ?? true) await enterRawRepl(link, timeouts);
  if (options.remove?.length) {
    // An old .py would shadow a new .mpy: MicroPython imports x.py first (2026-09-25).
    const list = `[${options.remove.map(pyStr).join(", ")}]`;
    await execRaw(link, `import os\nfor _f in ${list}:\n try:\n  os.remove(_f)\n except OSError:\n  pass`, "removing stale runtime files", timeouts.execMs);
  }
  for (const [i, file] of files.entries()) {
    options.onProgress?.(i + 1, files.length, file.name);
    await writeFileChunked(link, file.name, file.data, `pushing ${file.name}`);
  }
  await hardReset(link);
}

// --- Reaching a prompt on a board that's running something ------------------------------------------------------

const PROMPT_MARKERS = [">>>", "raw REPL", "KeyboardInterrupt"];
const REOPEN_PAUSE_MS = 300;

/** Sends Ctrl-C every read until the board answers from a prompt, reopening the link when it goes away (a native-USB
 * board re-enumerating across a reset). A running listener ignores Ctrl-C and a Pico doesn't reset when the port
 * opens, so this waits for a boot window while the user presses reset (board_recovery.py, 2026-09-24). Returns the
 * open link; closes it on failure. */
export async function catchPrompt(
  open: () => Promise<ClosableLink>,
  deadline: number,
  onStatus: (text: string) => void,
): Promise<ClosableLink> {
  let link: ClosableLink | null = null;
  let seen: Uint8Array = new Uint8Array();
  let toldToReset = false;
  let everOpened = false;
  let openError = "";
  try {
    while (Date.now() < deadline) {
      if (!link) {
        try {
          link = await open();
          everOpened = true;
        } catch (err) {
          // Not there yet (a board re-enumerating after a reset) -- or never openable, which the end says.
          openError = errorText(err);
          await sleep(REOPEN_PAUSE_MS);
          continue;
        }
      }
      let chunk: Uint8Array;
      try {
        await link.write(new Uint8Array([CTRL_C]));
        chunk = await link.read(500);
      } catch {
        await link.close().catch(() => undefined);
        link = null;
        continue;
      }
      seen = concat(seen, chunk);
      if (seen.length > 400) seen = seen.slice(seen.length - 400);
      const text = dec.decode(seen);
      if (PROMPT_MARKERS.some((m) => text.includes(m))) {
        const found = link;
        link = null;
        return found;
      }
      if (!toldToReset) {
        onStatus("Waiting for the board. If nothing happens, press its reset button, or unplug it and plug it back in.");
        toldToReset = true;
      }
    }
    if (!everOpened) {
      // 2026-11-18 (Mike, CYD, straight after a write): reported as "no reply" when nothing was ever listening.
      throw new RawReplError(OPEN_STEP, `couldn't open the port (${openError || "no reason given"}). Close anything else using it -- ThingStudio, Thonny, a serial monitor -- then try again`);
    }
    throw new RawReplError(CATCH_STEP, "the board never stopped at a prompt: press its reset button (or unplug and replug it) while this is waiting", seen);
  } finally {
    if (link) await link.close().catch(() => undefined);
  }
}

/** Everything listener.py keeps on flash for the current flow (board_recovery.py's FLOW_FILES). */
export const FLOW_FILES = ["/_flow.mpy", "/_flow_static.bin", "/_flow_meta.json", "/_flow_wifi_provision.json", "/_boot_count"];

/** Deletes the saved flow and resets, from an entered raw REPL: the board boots into the listener alone. */
export async function removeFlow(link: ByteLink, timeouts: RawReplTimeouts = DEFAULT_TIMEOUTS): Promise<void> {
  await enterRawRepl(link, timeouts);
  const list = `(${FLOW_FILES.map(pyStr).join(", ")})`;
  const out = await execRaw(link, `import os\nfor _p in ${list}:\n    try:\n        os.remove(_p)\n    except OSError:\n        pass\nprint('THINGSTUDIO_FLOW_REMOVED')\n`, "removing the saved flow", timeouts.execMs);
  if (!dec.decode(out).includes("THINGSTUDIO_FLOW_REMOVED")) throw new RawReplError("removing the saved flow", `unexpected output: ${showBytes(out)}`, out);
  await hardReset(link);
}
