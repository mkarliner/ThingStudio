// Tests for the WebSerial transport client (../src/protocol/transport.ts).
// No real browser or device involved -- a fake WebSerialPort backed by
// in-memory ReadableStream/WritableStream (both available as real globals
// under Node, same as a real browser), feeding it raw bytes the way a real
// serial port's read loop would. This is the part of the wire protocol's
// own still-pending hardware pass
// (docs/working-notes/validation/mvp-validation-plan.md) that's actually
// testable off-device: the base64/line framing this file adds on top of
// protocol.ts, not the real serial connection itself.

import { describe, expect, it } from "vitest";
import { WebSerialTransport, type WebSerialPort } from "../src/protocol/transport.js";
import { encodeMessage } from "../src/protocol/protocol.js";
import type { Message } from "../src/protocol/messages.js";

const HELLO: Message = {
  type: "HELLO",
  chipType: "ESP32-C3",
  runtimeVersion: { major: 0, minor: 1, patch: 0 },
  runtimeBuild: null, // board predates the runtime-build marker, or deploy_runtime.py couldn't determine git info
  freeFlashBytes: 1000,
  freeRamBytes: 2000,
};

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A fake serial port: `pushFromDevice` feeds bytes into the readable side
 * (as if the device sent them); `writtenChunks` records everything the
 * transport wrote (as if the device were listening). */
function makeFakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const writtenChunks: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writtenChunks.push(chunk);
    },
  });

  const port: WebSerialPort = {
    async open() {},
    async close() {
      try {
        controller.close();
      } catch {
        // already closed -- fine, disconnect() is allowed to call this more than once in practice
      }
    },
    readable,
    writable,
  };

  return {
    port,
    writtenChunks,
    pushFromDevice(text: string) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    pushFrameLine(message: Message) {
      const frame = encodeMessage(message);
      controller.enqueue(new TextEncoder().encode("F64:" + bytesToBase64(frame) + "\n"));
    },
  };
}

async function flushMicrotasks() {
  // The read loop is a `while` awaiting `reader.read()`; a couple of
  // microtask/macrotask turns are enough for a just-enqueued chunk to be
  // read and dispatched before assertions run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WebSerialTransport", () => {
  it("decodes a base64/line-wrapped frame into the right message", async () => {
    const fake = makeFakePort();
    const messages: Message[] = [];
    const transport = new WebSerialTransport({ onMessage: (m) => messages.push(m) });
    await transport.connect(fake.port);

    fake.pushFrameLine(HELLO);
    await flushMicrotasks();

    expect(messages).toEqual([HELLO]);
    await transport.disconnect();
  });

  it("surfaces a non-frame line via onDebugLine instead of treating it as protocol traffic", async () => {
    const fake = makeFakePort();
    const debugLines: string[] = [];
    const messages: Message[] = [];
    const transport = new WebSerialTransport({ onDebugLine: (l) => debugLines.push(l), onMessage: (m) => messages.push(m) });
    await transport.connect(fake.port);

    fake.pushFromDevice("LISTENER_READY\n");
    fake.pushFromDevice("NODE_ERROR node=1 type=ValueError msg=boom\n");
    await flushMicrotasks();

    expect(debugLines).toEqual(["LISTENER_READY", "NODE_ERROR node=1 type=ValueError msg=boom"]);
    expect(messages).toEqual([]);
    await transport.disconnect();
  });

  it("reassembles one frame line split across multiple stream chunks", async () => {
    const fake = makeFakePort();
    const messages: Message[] = [];
    const transport = new WebSerialTransport({ onMessage: (m) => messages.push(m) });
    await transport.connect(fake.port);

    const frame = encodeMessage(HELLO);
    const line = "F64:" + bytesToBase64(frame) + "\n";
    // Split the line into three arbitrary chunks -- mirrors framing.ts's
    // own "one frame split across multiple reads" adversarial case, one
    // layer further out (line bytes instead of frame bytes).
    const third = Math.floor(line.length / 3);
    fake.pushFromDevice(line.slice(0, third));
    await flushMicrotasks();
    expect(messages).toEqual([]); // nothing yet -- line isn't complete
    fake.pushFromDevice(line.slice(third, third * 2));
    await flushMicrotasks();
    expect(messages).toEqual([]);
    fake.pushFromDevice(line.slice(third * 2));
    await flushMicrotasks();

    expect(messages).toEqual([HELLO]);
    await transport.disconnect();
  });

  it("malformed base64 in a frame line is dropped via onDebugLine, not thrown", async () => {
    const fake = makeFakePort();
    const debugLines: string[] = [];
    const messages: Message[] = [];
    const errors: unknown[] = [];
    const transport = new WebSerialTransport({
      onDebugLine: (l) => debugLines.push(l),
      onMessage: (m) => messages.push(m),
      onProtocolError: (e) => errors.push(e),
    });
    await transport.connect(fake.port);

    fake.pushFromDevice("F64:not-valid-base64!!!\n");
    await flushMicrotasks();

    expect(messages).toEqual([]);
    expect(errors).toEqual([]);
    expect(debugLines).toHaveLength(1);
    expect(debugLines[0]).toContain("malformed base64");

    // Confirm the transport is still alive afterward -- a bad line must
    // not wedge the reader loop or the line buffer.
    fake.pushFrameLine(HELLO);
    await flushMicrotasks();
    expect(messages).toEqual([HELLO]);

    await transport.disconnect();
  });

  it("a well-formed frame with a malformed message body surfaces via onProtocolError", async () => {
    const fake = makeFakePort();
    const errors: unknown[] = [];
    const transport = new WebSerialTransport({ onProtocolError: (e) => errors.push(e) });
    await transport.connect(fake.port);

    // A syntactically fine frame (real length header, real type byte) but
    // garbage CBOR payload -- framing.ts succeeds, codec.ts's shape
    // validation is what rejects it (see framing.adversarial.test.ts's
    // own "garbage payload... still framed correctly" case, one layer up).
    const badFrame = new Uint8Array([0x00, 0x04, 1, 0xff, 0xff, 0xff]); // length=4 (type + 3 payload bytes), matches the 6 bytes actually present
    fake.pushFromDevice("F64:" + bytesToBase64(badFrame) + "\n");
    await flushMicrotasks();

    expect(errors).toHaveLength(1);
    await transport.disconnect();
  });

  it("send() base64/line-wraps an encoded message the same way the device expects to receive it", async () => {
    const fake = makeFakePort();
    const transport = new WebSerialTransport();
    await transport.connect(fake.port);

    await transport.send(HELLO);

    const written = Buffer.concat(fake.writtenChunks.map((c) => Buffer.from(c))).toString("utf8");
    expect(written.startsWith("F64:")).toBe(true);
    expect(written.endsWith("\n")).toBe(true);
    const decodedFrame = Uint8Array.from(Buffer.from(written.slice(4, -1), "base64"));
    expect(decodedFrame).toEqual(encodeMessage(HELLO));

    await transport.disconnect();
  });

  it("pendingByteCount reflects a not-yet-newline-terminated partial line", async () => {
    const fake = makeFakePort();
    const transport = new WebSerialTransport();
    await transport.connect(fake.port);

    fake.pushFrameLine(HELLO);
    await flushMicrotasks();
    expect(transport.pendingByteCount).toBe(0); // fully consumed, no partial §13 frame left buffered

    await transport.disconnect();
  });
});
