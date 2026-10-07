// Tests for the backend WebSocket transport client
// (../src/protocol/backend-transport.ts) -- the "via backend" connection
// mode added 2026-09-07 (editor-backend-wiring). No real network or
// backend process involved: a fake WebSocket (this file's own
// FakeWebSocket, matching the narrow addEventListener/send/close surface
// BackendTransport actually uses) is injected via the constructor's
// second, main.ts-never-passes, wsFactory argument -- same
// dependency-injection shape the backend's own ws_relay.py tests use for
// SerialConnection, and the same "fake the browser API, exercise the real
// decode/control-message logic on top of it" approach test/transport.test.ts
// already uses for WebSerialTransport.

import { describe, expect, it, vi } from "vitest";
import { BackendTransport, INSTALL_CATCH_WAIT_MS, InstallRuntimeError, type InstallProgress, type SerialPortInfo } from "../src/protocol/backend-transport.js";
import { encodeMessage } from "../src/protocol/protocol.js";
import type { Message } from "../src/protocol/messages.js";

const HELLO: Message = {
  type: "HELLO",
  chipType: "ESP32-C3",
  runtimeVersion: { major: 0, minor: 1, patch: 0 },
  runtimeBuild: null,
  currentFlowName: null,
  currentFlowDeployId: null,
  freeFlashBytes: 1000,
  freeRamBytes: 2000,
  freeIdfHeapBytes: null,
  largestIdfHeapBlockBytes: null,
  safeMode: false,
  hostname: null,
  authRequired: false,
  authScheme: null,
  hasWifi: false,
  networkAddress: null,
  dependencies: null,
};

type Listener = (ev: { data?: unknown }) => void;

/** Stands in for the browser's real WebSocket: same addEventListener
 * (including `once`)/removeEventListener/send/close/binaryType surface
 * BackendTransport actually touches, plus simulateX() test helpers to
 * drive it from the "server" side. Cast to `WebSocket` at the injection
 * point (BackendTransport's constructor expects the real DOM type) --
 * this file never claims to implement the full WebSocket interface, only
 * the slice that matters. */
class FakeWebSocket {
  binaryType = "";
  sent: unknown[] = [];
  closed = false;
  #listeners = new Map<string, { listener: Listener; once?: boolean }[]>();

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const arr = this.#listeners.get(type) ?? [];
    arr.push({ listener, once: options?.once });
    this.#listeners.set(type, arr);
  }

  removeEventListener(type: string, listener: Listener): void {
    const arr = this.#listeners.get(type);
    if (!arr) return;
    this.#listeners.set(
      type,
      arr.filter((r) => r.listener !== listener),
    );
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.simulateClose();
  }

  #dispatch(type: string, ev: { data?: unknown }): void {
    const regs = [...(this.#listeners.get(type) ?? [])];
    for (const reg of regs) {
      if (reg.once) this.removeEventListener(type, reg.listener);
      reg.listener(ev);
    }
  }

  simulateOpen(): void {
    this.#dispatch("open", {});
  }
  simulateMessage(data: unknown): void {
    this.#dispatch("message", { data });
  }
  simulateClose(): void {
    this.#dispatch("close", {});
  }
  simulateError(): void {
    this.#dispatch("error", {});
  }
}

function makeFakeFactory(): { factory: (url: string) => WebSocket; sockets: FakeWebSocket[] } {
  const sockets: FakeWebSocket[] = [];
  const factory = (_url: string): WebSocket => {
    const fake = new FakeWebSocket();
    sockets.push(fake);
    return fake as unknown as WebSocket;
  };
  return { factory, sockets };
}

/** open() awaits a promise that resolves on the fake socket's "open"
 * event -- fired synchronously by simulateOpen(), but open() itself has
 * already `await`ed into the Promise executor by the time test code can
 * call simulateOpen() on the socket instance, so a couple of microtask
 * turns are needed between constructing the transport and asserting on
 * its state, same reasoning transport.test.ts's flushMicrotasks() gives. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("BackendTransport", () => {
  it("open() resolves once the socket reports open, and connects with binaryType=arraybuffer", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://127.0.0.1:8765/ws");
    await flushMicrotasks();
    expect(sockets[0]!.binaryType).toBe("arraybuffer");
    sockets[0]!.simulateOpen();
    await openP; // must resolve, not hang or reject
  });

  it("open() rejects if the socket errors before opening", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://127.0.0.1:8765/ws");
    await flushMicrotasks();
    sockets[0]!.simulateError();
    await expect(openP).rejects.toThrow(/could not reach backend/);
  });

  it("listPorts() sends list_ports and resolves with the backend's reported ports", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const listP = t.listPorts();
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: "list_ports" })]);
    const ports: SerialPortInfo[] = [
      { device: "/dev/ttyUSB0", description: "USB Serial", manufacturer: null, vid: null, pid: null, serial_number: null },
    ];
    sockets[0]!.simulateMessage(JSON.stringify({ type: "ports", ports }));
    await expect(listP).resolves.toEqual(ports);
  });

  it("connectPort() sends connect and resolves on a connected status", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const connectP = t.connectPort("/dev/ttyUSB0", 115200);
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: "connect", port: "/dev/ttyUSB0", baudrate: 115200 })]);
    expect(t.isConnected).toBe(false);
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", connected: true, port: "/dev/ttyUSB0" }));
    await connectP;
    expect(t.isConnected).toBe(true);
  });

  it("connectPort() rejects on an error status and never reports connected", async () => {
    const { factory, sockets } = makeFakeFactory();
    const debugLines: string[] = [];
    const t = new BackendTransport({ onDebugLine: (l) => debugLines.push(l) }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const connectP = t.connectPort("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", error: "NODE_ERROR: serial open failed on /dev/ttyUSB0: not found" }));
    await expect(connectP).rejects.toThrow(/NODE_ERROR/);
    expect(t.isConnected).toBe(false);
    expect(debugLines.some((l) => l.includes("NODE_ERROR"))).toBe(true);
  });

  it("installRuntime() sends install_runtime and resolves on ok:true", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const installP = t.installRuntime("/dev/ttyUSB0", 115200);
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: "install_runtime", port: "/dev/ttyUSB0", baudrate: 115200 })]);
    sockets[0]!.simulateMessage(JSON.stringify({ type: "install_runtime_result", ok: true }));
    await installP; // must resolve, not reject
  });

  it("installRuntime() rejects with the backend's error on ok:false", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const installP = t.installRuntime("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(
      JSON.stringify({ type: "install_runtime_result", ok: false, error: "NODE_ERROR: runtime install failed at pushing runtime.py: timed out" }),
    );
    await expect(installP).rejects.toThrow(/NODE_ERROR/);
  });

  it("installRuntime() passes the backend's diagnosis through on the rejection", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const installP = t.installRuntime("/dev/cu.usbmodem02");
    sockets[0]!.simulateMessage(
      JSON.stringify({
        type: "install_runtime_result",
        ok: false,
        error: "NODE_ERROR: runtime install failed at entering raw REPL: timed out ..., last seen: b''",
        diagnosis: "silent",
      }),
    );
    const err = await installP.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstallRuntimeError);
    expect((err as InstallRuntimeError).diagnosis).toBe("silent");
  });

  it("installRuntime() reports progress and keeps waiting while progress arrives", async () => {
    vi.useFakeTimers();
    try {
      const { factory, sockets } = makeFakeFactory();
      const t = new BackendTransport({}, factory);
      const openP = t.open("ws://x/ws");
      sockets[0]!.simulateOpen();
      await openP;

      const seen: InstallProgress[] = [];
      const installP = t.installRuntime("/dev/ttyUSB0", 115200, (p) => seen.push(p), 1000);
      vi.advanceTimersByTime(800);
      sockets[0]!.simulateMessage(JSON.stringify({ type: "install_runtime_progress", index: 1, total: 2, file: "a.py" }));
      vi.advanceTimersByTime(800); // 1600ms total, but only 800ms since the last progress
      sockets[0]!.simulateMessage(JSON.stringify({ type: "install_runtime_result", ok: true }));
      await installP;
      expect(seen).toEqual([{ index: 1, total: 2, file: "a.py" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("installRuntime() rejects as stalled when the backend goes quiet", async () => {
    vi.useFakeTimers();
    try {
      const { factory, sockets } = makeFakeFactory();
      const t = new BackendTransport({}, factory);
      const openP = t.open("ws://x/ws");
      sockets[0]!.simulateOpen();
      await openP;

      const installP = t.installRuntime("/dev/ttyUSB0", 115200, undefined, 1000);
      const caught = installP.catch((e: unknown) => e);
      vi.advanceTimersByTime(1001);
      const err = await caught;
      expect(err).toBeInstanceOf(InstallRuntimeError);
      expect((err as InstallRuntimeError).diagnosis).toBe("stalled");
      // A second install is allowed afterwards -- the stalled one no longer counts as in flight.
      void t.installRuntime("/dev/ttyUSB0").catch(() => {});
    } finally {
      vi.useRealTimers();
    }
  });

  it("installRuntime() passes status lines on and waits longer while the backend catches the board", async () => {
    vi.useFakeTimers();
    try {
      const { factory, sockets } = makeFakeFactory();
      const t = new BackendTransport({}, factory);
      const openP = t.open("ws://x/ws");
      sockets[0]!.simulateOpen();
      await openP;

      const status: string[] = [];
      const installP = t.installRuntime("/dev/cu.usbmodem1", 115200, undefined, 1000, (s) => status.push(s));
      sockets[0]!.simulateMessage(JSON.stringify({ type: "install_runtime_status", text: "Waiting for the board." }));
      vi.advanceTimersByTime(INSTALL_CATCH_WAIT_MS - 1); // well past the 1000ms idle timeout
      sockets[0]!.simulateMessage(JSON.stringify({ type: "install_runtime_result", ok: true }));
      await installP;
      expect(status).toEqual(["Waiting for the board."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("installRuntime() defaults baudrate to 115200 when not given", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    void t.installRuntime("/dev/ttyUSB0");
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: "install_runtime", port: "/dev/ttyUSB0", baudrate: 115200 })]);
  });

  it("disconnect() rejects an in-flight installRuntime() rather than leaving it hanging", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    const installP = t.installRuntime("/dev/ttyUSB0");
    await t.disconnect();
    await expect(installP).rejects.toThrow(/disconnected before the backend responded/);
  });

  it("send() throws when not connected, and encodes a message as one binary WS frame once connected", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    await expect(t.send({ type: "HELLO_REQUEST" })).rejects.toThrow(/not connected/);

    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    const connectP = t.connectPort("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", connected: true, port: "/dev/ttyUSB0" }));
    await connectP;

    await t.send({ type: "HELLO_REQUEST" });
    expect(sockets[0]!.sent.at(-1)).toEqual(encodeMessage({ type: "HELLO_REQUEST" }));
  });

  it("decodes a binary WS message the same way WebSerialTransport decodes a serial frame", async () => {
    const { factory, sockets } = makeFakeFactory();
    const received: Message[] = [];
    const t = new BackendTransport({ onMessage: (m) => received.push(m) }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    sockets[0]!.simulateMessage(encodeMessage(HELLO));
    expect(received).toEqual([HELLO]);
  });

  it('relays a "debug" control message to onDebugLine, unmodified', async () => {
    const { factory, sockets } = makeFakeFactory();
    const debugLines: string[] = [];
    const t = new BackendTransport({ onDebugLine: (l) => debugLines.push(l) }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    sockets[0]!.simulateMessage(JSON.stringify({ type: "debug", line: "LISTENER_READY" }));
    expect(debugLines).toContain("LISTENER_READY");
  });

  it("disconnect() sends a disconnect control message only when actually connected, then closes the socket", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    // Not yet connected to a serial port -- disconnect() must not send a
    // "disconnect" the backend never asked to relay anything for.
    await t.disconnect();
    expect(sockets[0]!.sent).toEqual([]);
    expect(sockets[0]!.closed).toBe(true);
  });

  it("onDisconnect fires on an unexpected socket close after connecting, but not after a deliberate disconnect()", async () => {
    const { factory, sockets } = makeFakeFactory();
    let disconnects = 0;
    const t = new BackendTransport({ onDisconnect: () => disconnects++ }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    const connectP = t.connectPort("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", connected: true, port: "/dev/ttyUSB0" }));
    await connectP;

    sockets[0]!.simulateClose(); // e.g. the backend process died
    expect(disconnects).toBe(1);
  });

  it("does not fire onDisconnect for a deliberate disconnect()", async () => {
    const { factory, sockets } = makeFakeFactory();
    let disconnects = 0;
    const t = new BackendTransport({ onDisconnect: () => disconnects++ }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    const connectP = t.connectPort("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", connected: true, port: "/dev/ttyUSB0" }));
    await connectP;

    await t.disconnect();
    expect(disconnects).toBe(0);
  });

  it("a malformed control message is reported via onDebugLine, not thrown", async () => {
    const { factory, sockets } = makeFakeFactory();
    const debugLines: string[] = [];
    const t = new BackendTransport({ onDebugLine: (l) => debugLines.push(l) }, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;

    sockets[0]!.simulateMessage("not json{{{");
    expect(debugLines.some((l) => l.includes("malformed control message"))).toBe(true);
  });
});

describe("BackendTransport raw write and remove flow (2026-09-23)", () => {
  it("rawWrite() needs a connected port, then sends raw_write", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    expect(() => t.rawWrite("1+1\r")).toThrow(/not connected/);
    const connectP = t.connectPort("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(JSON.stringify({ type: "status", connected: true, port: "/dev/ttyUSB0" }));
    await connectP;
    t.rawWrite("\x04");
    expect(sockets[0]!.sent.at(-1)).toEqual(JSON.stringify({ type: "raw_write", text: "\x04" }));
  });

  it("removeFlow() relays status lines and resolves on ok", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    const status: string[] = [];
    const p = t.removeFlow("/dev/ttyUSB0", (s) => status.push(s));
    expect(sockets[0]!.sent.at(-1)).toEqual(JSON.stringify({ type: "remove_flow", port: "/dev/ttyUSB0" }));
    sockets[0]!.simulateMessage(JSON.stringify({ type: "remove_flow_status", text: "press reset" }));
    sockets[0]!.simulateMessage(JSON.stringify({ type: "remove_flow_result", ok: true }));
    await p;
    expect(status).toEqual(["press reset"]);
  });

  it("removeFlow() rejects with the backend's error", async () => {
    const { factory, sockets } = makeFakeFactory();
    const t = new BackendTransport({}, factory);
    const openP = t.open("ws://x/ws");
    sockets[0]!.simulateOpen();
    await openP;
    const p = t.removeFlow("/dev/ttyUSB0");
    sockets[0]!.simulateMessage(
      JSON.stringify({ type: "remove_flow_result", ok: false, error: "NODE_ERROR: runtime install failed at waiting for the board to stop at a prompt: never" }),
    );
    await expect(p).rejects.toThrow(/never/);
  });
});
