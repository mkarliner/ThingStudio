// SPDX-License-Identifier: Apache-2.0
// editor/test/web-serial-link.test.ts
//
// The raw REPL's Web Serial link (src/raw-repl/web-serial-link.ts) against a fake port built from real web streams.
import { describe, expect, it } from "vitest";
import { CLOSE_STEP_MS, openSerialLink, type SerialPortLike } from "../src/raw-repl/web-serial-link.js";

const enc = new TextEncoder();

function fakePort(opts: { hangOnClose?: boolean; hangOnWriterClose?: boolean } = {}) {
  let push: (chunk: Uint8Array) => void = () => undefined;
  const written: Uint8Array[] = [];
  const port: SerialPortLike & { written: Uint8Array[]; push(text: string): void } = {
    written,
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(chunk);
      },
      close() {
        return opts.hangOnWriterClose ? new Promise<void>(() => undefined) : undefined;
      },
    }),
    async open() {},
    close() {
      return opts.hangOnClose ? new Promise<void>(() => undefined) : Promise.resolve();
    },
    push(text: string) {
      push(enc.encode(text));
    },
  };
  return port;
}

describe("Web Serial link", () => {
  it("returns what has arrived as soon as anything has", async () => {
    const port = fakePort();
    const link = await openSerialLink(port);
    setTimeout(() => port.push("OK"), 10);
    const started = Date.now();
    expect(new TextDecoder().decode(await link.read(2000))).toBe("OK");
    expect(Date.now() - started).toBeLessThan(1000);
    await link.close();
  });

  it("returns nothing when nothing arrives in time", async () => {
    const link = await openSerialLink(fakePort());
    expect((await link.read(20)).length).toBe(0);
    await link.close();
  });

  it("writes what it's given", async () => {
    const port = fakePort();
    const link = await openSerialLink(port);
    await link.write(enc.encode("\x03"));
    expect(port.written).toEqual([enc.encode("\x03")]);
    await link.close();
  });

  it("closes in bounded time even when the port never finishes closing", async () => {
    const link = await openSerialLink(fakePort({ hangOnClose: true, hangOnWriterClose: true }));
    const started = Date.now();
    await link.close();
    expect(Date.now() - started).toBeLessThan(CLOSE_STEP_MS * 5 + 500);
  }, 10_000);
});
