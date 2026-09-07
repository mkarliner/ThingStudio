// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/transport.ts
//
// WebSerial transport client -- the piece repo-structure-and-conventions.md
// already named as belonging here ("WebSerial transport client") once
// something needed it. Two things forced building it now rather than
// later, both from fault-isolation-briefing.md's own scope: the device
// listener (device-runtime/src/listener.py) needs a real counterpart to
// actually talk to during a hardware session, and the wire protocol's own
// still-pending hardware pass (mvp-validation-plan.md, "Real wire protocol
// (§13)") needs the same thing.
//
// Base64/readline framing, not raw binary, per
// fault-isolation-briefing.md's explicit default: "ride binary payloads on
// readline() (base64-encoded)... unless a given port proves otherwise."
// listener.py's own header comment explains why (POC-D's read(n)/
// readexactly(n) hang) and documents the exact on-wire shape this file has
// to match: each complete §13 frame (framing.ts's 2-byte length + 1-byte
// type + CBOR body) is base64-encoded and sent as one text line, prefixed
// "F64:" so it's unambiguous against the device's own human-readable
// print()/debug lines (which this file surfaces too, via onDebugLine,
// rather than silently discarding -- same "plain serial monitor stays
// useful" reasoning listener.py's header gives for keeping them).
//
// This file is intentionally the only place in editor/src/protocol/ that
// touches a real browser API (navigator.serial) -- framing.ts, codec.ts,
// messages.ts, protocol.ts, version.ts all stay transport-agnostic per
// their own existing header comments, and this file is what actually
// exercises them against bytes on a wire instead of an in-memory buffer.

import { ProtocolStreamDecoder, encodeMessage, type ProtocolDecodeResult } from "./protocol.js";
import type { Message } from "./messages.js";

const F64_PREFIX = "F64:";
const NEWLINE = 0x0a;

/** The subset of the WebSerial API this file actually uses -- kept narrow
 * and structural (not importing the full `@types/web-serial` surface) so
 * this file type-checks under `tsc --noEmit` without pulling in a new
 * devDependency just for ambient DOM types this project doesn't otherwise
 * need. A real browser's `SerialPort` satisfies this shape. */
export interface WebSerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

/**
 * Minimal shape main.ts needs to drive a live connection generically, once
 * one exists -- editor-backend-wiring (2026-09-07), the design doc §4
 * requirement that connection mode ("direct" WebSerial vs. "via backend")
 * be an explicit user choice, not auto-detected. Both WebSerialTransport
 * (this file) and BackendTransport (protocol/backend-transport.ts)
 * implement this so everything downstream of a successful Connect --
 * Deploy, Check status, Disconnect, inject click-to-fire -- is written
 * once against this contract rather than duplicated per mode. Deliberately
 * does NOT cover how a connection is *opened*: WebSerialTransport.connect()
 * takes an already-user-picked WebSerialPort (from navigator.serial's own
 * native picker), while BackendTransport needs a backend URL plus a
 * server-side port name chosen from a list the backend itself reports --
 * different enough shapes that main.ts's Connect handler branches on mode
 * explicitly rather than this interface trying to paper over the
 * difference.
 */
export interface DeviceTransport {
  readonly isConnected: boolean;
  disconnect(): Promise<void>;
  send(message: Message): Promise<void>;
}

export interface TransportEvents {
  /** A successfully decoded §13 message from the device. */
  onMessage?(message: Message): void;
  /** A framing- or message-shape error -- adversarial/malformed input from
   * the device side, or (rarely, if ever) a bug on this side's encode
   * path being echoed back. Recoverable by design (errors.ts) -- the
   * transport keeps running after this fires, same as protocol.ts's own
   * contract. */
  onProtocolError?(error: ProtocolDecodeResult extends { ok: false; error: infer E } ? E : never): void;
  /** A line from the device that wasn't a protocol frame -- its plain
   * print()-based debug/status output (LISTENER_READY, NODE_ERROR
   * console echoes, LISTENER_ERR recovery logs, etc.). Surfaced, not
   * dropped, matching listener.py's own reasoning for keeping them
   * human-readable on a plain serial monitor. */
  onDebugLine?(line: string): void;
  /** The read loop ended, either because the port was closed deliberately
   * (`disconnect()`) or because the underlying stream errored. */
  onDisconnect?(reason: unknown): void;
}

const DEFAULT_BAUD_RATE = 115200; // matches every prior POC's harness.py / this task's listener.py -- no baud negotiation in §13, a fixed rate is the existing convention

/**
 * One connected device's serial link. Owns exactly one open SerialPort at
 * a time; framing/CBOR decode state (ProtocolStreamDecoder) lives here,
 * not in the port itself, so a caller can inspect `pendingByteCount` for
 * diagnostics the same way protocol.ts's own tests do.
 */
export class WebSerialTransport implements DeviceTransport {
  #port: WebSerialPort | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #decoder = new ProtocolStreamDecoder();
  #lineBuffer = new Uint8Array(0);
  #events: TransportEvents;
  #closing = false;

  constructor(events: TransportEvents = {}) {
    this.#events = events;
  }

  get isConnected(): boolean {
    return this.#port !== null;
  }

  /** Bytes buffered but not yet part of a complete frame -- diagnostic use, mirrors ProtocolStreamDecoder.pendingByteCount. */
  get pendingByteCount(): number {
    return this.#decoder.pendingByteCount;
  }

  async connect(port: WebSerialPort, baudRate: number = DEFAULT_BAUD_RATE): Promise<void> {
    if (this.#port) throw new Error("WebSerialTransport is already connected -- call disconnect() first");
    await port.open({ baudRate });
    this.#port = port;
    this.#closing = false;
    this.#decoder.reset();
    this.#lineBuffer = new Uint8Array(0);

    if (!port.readable) throw new Error("SerialPort has no readable stream after open()");
    this.#reader = port.readable.getReader();

    if (port.writable) {
      this.#writer = port.writable.getWriter();
    }

    // Deliberately not awaited -- this is the background read loop for
    // this connection's lifetime, same shape as protocol.ts's own
    // "push bytes as they arrive" model, just fed from a real stream
    // instead of test fixtures.
    void this.#readLoop();
  }

  async disconnect(): Promise<void> {
    this.#closing = true;
    try {
      await this.#reader?.cancel();
    } catch {
      // Cancelling an already-errored/closed reader can itself throw --
      // this is a best-effort teardown, not a case worth surfacing.
    }
    this.#writer?.releaseLock();
    this.#writer = null;
    this.#reader = null;
    const port = this.#port;
    this.#port = null;
    if (port) {
      try {
        await port.close();
      } catch {
        // Same best-effort reasoning as the reader.cancel() above.
      }
    }
  }

  /** Encode one message, base64/line-wrap it, and write it to the device. */
  async send(message: Message): Promise<void> {
    if (!this.#writer) throw new Error("WebSerialTransport is not connected (no writable stream)");
    const frame = encodeMessage(message);
    const line = F64_PREFIX + bytesToBase64(frame) + "\n";
    await this.#writer.write(new TextEncoder().encode(line));
  }

  async #readLoop(): Promise<void> {
    const reader = this.#reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.#feed(value);
      }
      if (!this.#closing) this.#events.onDisconnect?.(undefined);
    } catch (err) {
      if (!this.#closing) this.#events.onDisconnect?.(err);
    }
  }

  /** Splits incoming bytes on '\n' (the line-based framing this transport
   * rides on -- see this file's header) and dispatches each complete
   * line. Mirrors framing.ts's own FrameDecoder shape (accumulate, extract
   * complete units, leave a partial unit buffered) but at the line level
   * instead of the §13-frame level -- this is one layer further out. */
  #feed(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.#lineBuffer.length + chunk.length);
    combined.set(this.#lineBuffer, 0);
    combined.set(chunk, this.#lineBuffer.length);

    let start = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] === NEWLINE) {
        this.#handleLine(combined.slice(start, i));
        start = i + 1;
      }
    }
    this.#lineBuffer = combined.slice(start);
  }

  #handleLine(lineBytes: Uint8Array): void {
    // Trim a trailing '\r' (CRLF line endings) -- MicroPython's print()/
    // sys.stdout.write() on this project's target ports emit bare '\n',
    // but a USB-serial bridge or terminal in the middle is not something
    // to assume never adds one.
    const trimmed = lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d ? lineBytes.slice(0, -1) : lineBytes;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(trimmed);

    if (!text.startsWith(F64_PREFIX)) {
      this.#events.onDebugLine?.(text);
      return;
    }

    let frameBytes: Uint8Array;
    try {
      frameBytes = base64ToBytes(text.slice(F64_PREFIX.length));
    } catch (err) {
      // Malformed base64 -- adversarial-shaped input from the device
      // side (or a corrupted line), never allowed to throw out of the
      // read loop. Surfaced as a debug line rather than invented as a
      // fake ProtocolDecodeResult, since it never became a frame at all.
      this.#events.onDebugLine?.(`[transport] malformed base64 line, dropped: ${String(err)}`);
      return;
    }

    for (const result of this.#decoder.push(frameBytes)) {
      if (result.ok) {
        this.#events.onMessage?.(result.message);
      } else {
        this.#events.onProtocolError?.(result.error as never);
      }
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
