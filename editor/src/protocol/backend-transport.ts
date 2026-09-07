// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/backend-transport.ts
//
// WebSocket transport client for the "via backend" connection mode --
// design doc §4's 2026-08-16 addendum ("a thin local backend, Node-RED's
// model") plus its explicit requirement that connection mode be a real
// user choice, never auto-detected: "The editor requires an explicit user
// choice between 'direct' (WebSerial, local-only) and 'via backend'
// connection modes." This is the "via backend" half -- transport.ts's
// WebSerialTransport is the "direct" half, kept as a deliberate frozen
// fallback per that same addendum. Talks to backend/src/thingstudio_
// backend/ws_relay.py's one WS endpoint, multiplexed by frame type exactly
// as docs/working-notes/backend-editor-auth-and-protocol.md §2 describes:
// binary frames are already-framed §13 protocol bytes relayed verbatim,
// text frames are backend-local control-plane JSON with no device
// counterpart (list available ports, connect/disconnect, status, and now
// debug -- see below).
//
// Editor-backend-wiring session, 2026-09-07: building this surfaced a real
// bug in the backend's own serial layer, fixed in the same session (see
// backend/src/thingstudio_backend/line_framing.py's header and
// docs/working-notes/learnings/backend-serial-wire-format.md) -- the
// backend's ws_relay.py originally assumed raw §13-framed bytes ride the
// physical serial wire directly, but the real device listener
// (device-runtime/src/listener.py) only ever speaks base64-encoded,
// "F64:"-prefixed text lines there (POC-D's read(n)/readexactly(n) hang,
// transport.ts's own header comment on why WebSerialTransport does the
// same base64/line encoding for the direct path). That fix is entirely
// backend-internal, invisible from here: this file's contract with
// ws_relay.py is unchanged from what backend-editor-auth-and-protocol.md
// §2 always specified -- one complete already-framed §13 frame per WS
// binary message, both directions -- so no base64/line handling belongs
// in this file at all, only in the backend's serial<->WS boundary.
//
// Binary-frame decoding reuses protocol.ts's ProtocolStreamDecoder, the
// same class WebSerialTransport feeds base64-decoded serial bytes into --
// each WS binary message here already IS one complete frame (the backend
// guarantees that), so pushing it through the same decoder is a
// single-result call in practice, not because the reassembly logic is
// needed, but because it's the one place §13 frame parsing already lives
// and is already tested; no reason to hand-roll a second parser for a
// stream that happens to always arrive in complete units.

import { ProtocolStreamDecoder, encodeMessage } from "./protocol.js";
import type { Message } from "./messages.js";
import type { DeviceTransport, TransportEvents } from "./transport.js";

/** Mirrors backend/src/thingstudio_backend/serial_relay.py's SerialPortInfo
 * dataclass field-for-field (aiohttp/json serializes it via `__dict__`,
 * ws_relay.py's `list_ports` handler) -- this is untrusted-but-structured
 * data from the backend's own OS-level port enumeration, not user input,
 * so it's typed directly rather than validated field-by-field the way a
 * flow file's untrusted JSON is (flow-file.ts's parseFlowFile). */
export interface SerialPortInfo {
  device: string;
  description: string;
  manufacturer: string | null;
  vid: number | null;
  pid: number | null;
  serial_number: string | null;
}

/** One backend WebSocket session. Two-phase, unlike WebSerialTransport's
 * single connect(port): open() establishes the socket and lets the caller
 * ask the backend what serial ports it sees (listPorts()) *before*
 * committing to one, since -- unlike navigator.serial's own picker -- the
 * backend has no native OS file-picker equivalent; the editor has to build
 * that UI itself (main.ts's backendPortSelect, populated from listPorts()).
 * connectPort() is the second phase, opening the actual serial port on the
 * backend side and starting the relay. */
export class BackendTransport implements DeviceTransport {
  #ws: WebSocket | null = null;
  #decoder = new ProtocolStreamDecoder();
  #events: TransportEvents;
  #closing = false;
  #connectedPort: string | null = null;
  #pendingListPorts: { resolve(ports: SerialPortInfo[]): void; reject(err: unknown): void }[] = [];
  #pendingConnect: { resolve(): void; reject(err: Error): void } | null = null;
  #wsFactory: (url: string) => WebSocket;

  /** `wsFactory` defaults to the real `WebSocket` constructor -- overridable
   * so test/backend-transport.test.ts can inject an in-memory fake (same
   * dependency-injection shape ws_relay.py's own tests use for
   * SerialConnection) without needing an actual network connection or a
   * running backend. main.ts never passes a second argument. */
  constructor(events: TransportEvents = {}, wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url)) {
    this.#events = events;
    this.#wsFactory = wsFactory;
  }

  get isConnected(): boolean {
    return this.#connectedPort !== null;
  }

  /** Bytes buffered but not yet part of a complete frame -- diagnostic use,
   * same role as WebSerialTransport's own getter. In practice this should
   * only ever transiently read nonzero, since each WS binary message is
   * already one complete frame (this file's header) -- a persistently
   * nonzero value here would itself be a sign something upstream (the
   * backend) isn't honoring that contract. */
  get pendingByteCount(): number {
    return this.#decoder.pendingByteCount;
  }

  /** Opens the WebSocket to the backend at `wsUrl` (e.g.
   * "ws://127.0.0.1:8765/ws") and resolves once it's actually open --
   * rejects on a connection failure (backend not running, Host-allowlist
   * rejection, wrong URL) rather than leaving the caller to infer failure
   * from a later timeout. Does not touch any serial port yet. */
  async open(wsUrl: string): Promise<void> {
    if (this.#ws) throw new Error("BackendTransport is already open -- call disconnect() first");
    this.#closing = false;
    this.#decoder.reset();

    const ws = this.#wsFactory(wsUrl);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onFail);
        ws.removeEventListener("close", onFail);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onFail = () => {
        cleanup();
        reject(new Error(`could not reach backend at ${wsUrl}`));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onFail, { once: true });
      ws.addEventListener("close", onFail, { once: true });
    });

    ws.addEventListener("message", (ev) => this.#handleWsMessage(ev));
    ws.addEventListener("close", () => {
      const wasConnected = this.#connectedPort !== null;
      this.#connectedPort = null;
      this.#ws = null;
      if (!this.#closing && wasConnected) this.#events.onDisconnect?.(undefined);
    });
  }

  /** Asks the backend which serial ports it currently sees. Only valid
   * after open(); doesn't require connectPort() to have been called. */
  async listPorts(): Promise<SerialPortInfo[]> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    const p = new Promise<SerialPortInfo[]>((resolve, reject) => {
      this.#pendingListPorts.push({ resolve, reject });
    });
    this.#ws.send(JSON.stringify({ type: "list_ports" }));
    return p;
  }

  /** Asks the backend to open `port` (a device path/name from listPorts(),
   * e.g. "/dev/tty.usbmodem14201") and start relaying it. Resolves once
   * the backend confirms the port is open; rejects with the backend's own
   * NODE_ERROR-prefixed message on failure (already-in-use, no such
   * device, permission denied). */
  async connectPort(port: string, baudRate = 115200): Promise<void> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    if (this.#pendingConnect) throw new Error("BackendTransport already has a connectPort() in flight");
    const p = new Promise<void>((resolve, reject) => {
      this.#pendingConnect = { resolve, reject };
    });
    this.#ws.send(JSON.stringify({ type: "connect", port, baudrate: baudRate }));
    return p;
  }

  /** Tears down the whole session -- both the backend's serial port (if
   * connectPort() succeeded) and the WebSocket itself. Safe to call on a
   * session that never got past open() (e.g. main.ts's port-listing probe
   * in refreshBackendPorts(), which never calls connectPort() at all). */
  async disconnect(): Promise<void> {
    this.#closing = true;
    if (this.#ws && this.#connectedPort) {
      try {
        this.#ws.send(JSON.stringify({ type: "disconnect" }));
      } catch {
        // Socket already gone -- closing it below is what actually matters.
      }
    }
    try {
      this.#ws?.close();
    } catch {
      // Best-effort teardown, same reasoning WebSerialTransport's
      // disconnect() gives for its own try/catches.
    }
    this.#ws = null;
    this.#connectedPort = null;
    // Reject a still-outstanding connectPort()/listPorts() rather than
    // leaving it hanging forever -- the socket that would have answered it
    // is gone now.
    if (this.#pendingConnect) {
      this.#pendingConnect.reject(new Error("disconnected before the backend responded"));
      this.#pendingConnect = null;
    }
    for (const waiter of this.#pendingListPorts.splice(0)) {
      waiter.reject(new Error("disconnected before the backend responded"));
    }
  }

  /** Encode one message and send it as a single WS binary frame -- the
   * backend forwards it to the serial port verbatim (after its own
   * F64/base64 line-wrapping, invisible from here per this file's header). */
  async send(message: Message): Promise<void> {
    if (!this.#ws || !this.#connectedPort) throw new Error("BackendTransport is not connected to a device");
    this.#ws.send(encodeMessage(message));
  }

  #handleWsMessage(ev: MessageEvent): void {
    if (typeof ev.data === "string") {
      this.#handleControlMessage(ev.data);
      return;
    }
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    for (const result of this.#decoder.push(bytes)) {
      if (result.ok) {
        this.#events.onMessage?.(result.message);
      } else {
        this.#events.onProtocolError?.(result.error as never);
      }
    }
  }

  #handleControlMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Untrusted-shaped input from the backend (or a corrupted frame) --
      // never allowed to throw out of the message handler, same posture
      // WebSerialTransport's #handleLine takes for a malformed base64 line.
      this.#events.onDebugLine?.(`[backend] malformed control message, dropped: ${String(err)}`);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      this.#events.onDebugLine?.(`[backend] control message with no "type", dropped: ${raw}`);
      return;
    }
    const m = parsed as Record<string, unknown>;

    switch (m.type) {
      case "ports": {
        const waiter = this.#pendingListPorts.shift();
        waiter?.resolve(Array.isArray(m.ports) ? (m.ports as SerialPortInfo[]) : []);
        break;
      }
      case "status": {
        // ws_relay.py's _send_status(): {connected?, port?, error?} --
        // connected===true names the port that just opened successfully;
        // error is set on any failure (connect failed, a mid-session
        // relay error); connected===false is a clean disconnect
        // acknowledgment. These aren't mutually exclusive by shape, but
        // ws_relay.py never sends both connected and error together in
        // practice -- handled independently below rather than assumed.
        if (typeof m.error === "string") {
          this.#events.onDebugLine?.(`[backend] ${m.error}`);
          if (this.#pendingConnect) {
            const waiter = this.#pendingConnect;
            this.#pendingConnect = null;
            waiter.reject(new Error(m.error));
          }
        }
        if (m.connected === true && typeof m.port === "string") {
          this.#connectedPort = m.port;
          if (this.#pendingConnect) {
            const waiter = this.#pendingConnect;
            this.#pendingConnect = null;
            waiter.resolve();
          }
        } else if (m.connected === false) {
          this.#connectedPort = null;
        }
        break;
      }
      case "debug": {
        // New control-message type, added this session alongside the
        // backend's F64-line-format fix -- without it, the device's own
        // plain print()/status output (LISTENER_READY, NODE_ERROR console
        // echoes, etc. -- listener.py's own header comment on why these
        // stay human-readable) would be silently swallowed in "via
        // backend" mode instead of reaching the console the way it
        // already does in "direct" mode via WebSerialTransport's
        // onDebugLine.
        if (typeof m.line === "string") this.#events.onDebugLine?.(m.line);
        break;
      }
      default:
        this.#events.onDebugLine?.(`[backend] unknown control message type, dropped: ${String(m.type)}`);
    }
  }
}
