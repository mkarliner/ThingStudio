// SPDX-License-Identifier: Apache-2.0
// editor/src/raw-repl/web-serial-link.ts
//
// A ClosableLink (raw-repl.ts) over a Web Serial port. Reads run in a background pump into a buffer, so a read
// returns whatever has arrived as soon as anything has (raw_repl.py's read_available(), 2026-09-23). Writes have a
// 5 s limit, as the backend opens its port with write_timeout=5: a board that stops reading fails the step instead
// of hanging the page. DTR and RTS are left as the browser sets them on open, as pyserial does for the backend.

import type { ClosableLink } from "./raw-repl.js";

/** The slice of the Web Serial API used here, so this file needs no DOM serial typings. */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

export const RAW_REPL_BAUD = 115200;
const WRITE_TIMEOUT_MS = 5000;
/** How long one closing step may take before it's left behind. */
export const CLOSE_STEP_MS = 1000;

/** Waits for `p` for at most CLOSE_STEP_MS; its result and any error are ignored. */
async function bounded(p: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p.catch(() => undefined), new Promise((r) => (timer = setTimeout(r, CLOSE_STEP_MS)))]);
  clearTimeout(timer);
}

export async function openSerialLink(port: SerialPortLike, baudRate = RAW_REPL_BAUD): Promise<ClosableLink> {
  try {
    await port.open({ baudRate });
  } catch (err) {
    // "Already open": this page's own earlier user of the port (the flasher, 2026-11-18) didn't let go. Ours to
    // tidy, once; anything else is a real failure for the caller to report.
    if (!(err instanceof Error && err.name === "InvalidStateError")) throw err;
    await bounded(port.close());
    await port.open({ baudRate });
  }
  if (!port.readable || !port.writable) {
    await port.close().catch(() => undefined);
    throw new Error("the port opened but has no data streams");
  }
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  let buffer: Uint8Array = new Uint8Array();
  let failure = null as Error | null;
  let wake = null as (() => void) | null;
  let closed = false;

  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) {
          const next = new Uint8Array(buffer.length + value.length);
          next.set(buffer, 0);
          next.set(value, buffer.length);
          buffer = next;
          wake?.();
        }
      }
      if (!closed) failure = new Error("the port closed");
    } catch (err) {
      if (!closed) failure = err instanceof Error ? err : new Error(String(err));
    } finally {
      wake?.();
    }
  })();

  return {
    async read(timeoutMs: number): Promise<Uint8Array> {
      if (!buffer.length && !failure) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, timeoutMs);
          function done(): void {
            clearTimeout(timer);
            wake = null;
            resolve();
          }
          wake = done;
        });
      }
      if (buffer.length) {
        const out = buffer;
        buffer = new Uint8Array();
        return out;
      }
      if (failure) throw failure;
      return new Uint8Array();
    },
    async write(data: Uint8Array): Promise<void> {
      if (failure) throw failure;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          writer.write(data),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`write timeout (${WRITE_TIMEOUT_MS / 1000}s)`)), WRITE_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    // Every step is bounded: a board that has just reset (or been unplugged) can leave any of them waiting forever,
    // and a close that never returns hid a finished install's result (Mike, CYD, 2026-11-18: the runtime was on the
    // board, the page never said so). Closing is cleanup; it never decides an outcome.
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await bounded(reader.cancel());
      await bounded(pump);
      try {
        reader.releaseLock();
      } catch {
        // still locked by a read that never ended; the port close below lets it go
      }
      await bounded(writer.close());
      try {
        writer.releaseLock();
      } catch {
        // as above
      }
      await bounded(port.close());
    },
  };
}
