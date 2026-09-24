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
/** installRuntime()'s rejection when the backend reports a failure. `diagnosis` is
 * raw_repl.py's classify_reply() value ("silent", "micropython", "circuitpython", "esp_rom",
 * "other") when the install never reached raw REPL, else null -- board-diagnosis.ts turns it into
 * a next step for the user. */
/** One install_runtime_progress message: file `index` of `total` is starting. */
export interface InstallProgress {
  readonly index: number;
  readonly total: number;
  readonly file: string;
}

/** installRuntime() gives up if the backend sends nothing -- no progress, no result -- for this
 * long. The backend bounds every read and write to seconds (raw_repl.py, ws_relay.py), so this
 * much silence means the backend itself is stuck, not a slow board. Added after the first real
 * ESP32-S2 install (2026-09-23) sat with no output and no end. */
export const INSTALL_IDLE_TIMEOUT_MS = 30_000;

/** After an install_runtime_status message the backend may wait this long for the board to stop at a
 * prompt (ws_relay.py's _INSTALL_CATCH_TIMEOUT_SECONDS, 60s) without sending anything else, so the
 * idle timer allows that much plus a margin. */
export const INSTALL_CATCH_WAIT_MS = 75_000;

/** One board that answered the WiFi transport's UDP probe (backend tcp_relay.discover). */
export interface NetworkBoardInfo {
  readonly hostname: string;
  readonly address: string;
  readonly port: number;
  readonly chip: string;
  readonly flow: string | null;
  /** False when the board has no password set, so it won't accept a network connection yet. */
  readonly wifiTransport: boolean;
  /** Another editor already has a network session open with it. */
  readonly busy: boolean;
}

/** connectNetwork()'s rejection. `code` is tcp_relay.py's TcpRelayError.code: "no_password" (none
 * saved for this board -- ask the user), "auth_failed", "busy", "board_no_password", "timeout",
 * "network". `hostname` is the board's own name when the handshake got far enough to learn it. */
export class NetworkConnectError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hostname: string | null,
  ) {
    super(message);
    this.name = "NetworkConnectError";
  }
}

export class InstallRuntimeError extends Error {
  constructor(
    message: string,
    readonly diagnosis: string | null,
  ) {
    super(message);
    this.name = "InstallRuntimeError";
  }
}

export class BackendTransport implements DeviceTransport {
  #ws: WebSocket | null = null;
  #decoder = new ProtocolStreamDecoder();
  #events: TransportEvents;
  #closing = false;
  #connectedPort: string | null = null;
  #pendingListPorts: { resolve(ports: SerialPortInfo[]): void; reject(err: unknown): void }[] = [];
  #pendingConnect: { resolve(): void; reject(err: Error): void } | null = null;
  #pendingDiscover: { resolve(boards: NetworkBoardInfo[]): void; reject(err: unknown): void }[] = [];
  #connectedIsNetwork = false;
  #connectedHostname: string | null = null;
  #pendingRemoveFlow: { resolve(): void; reject(err: Error): void; onStatus?: (text: string) => void } | null = null;
  #pendingInstallRuntime: {
    resolve(): void;
    reject(err: Error): void;
    onProgress?: (p: InstallProgress) => void;
    onStatus?: (text: string) => void;
    armIdleTimer(ms?: number): void;
  } | null = null;
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

  /** WiFi transport (2026-09-24): asks the backend to open an authenticated network session with
   * the board at `host` (a `name.local` hostname or an IP) and relay it exactly like a serial port.
   * `password` is only needed when the backend has none saved for that board -- a rejection with
   * code "no_password" says so. Rejects with NetworkConnectError. */
  async connectNetwork(host: string, tcpPort = 7462, password?: string): Promise<void> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    if (this.#pendingConnect) throw new Error("BackendTransport already has a connect in flight");
    const p = new Promise<void>((resolve, reject) => {
      this.#pendingConnect = { resolve, reject };
    });
    const msg: Record<string, unknown> = { type: "connect", host, tcpPort };
    if (password !== undefined) msg.password = password;
    this.#ws.send(JSON.stringify(msg));
    return p;
  }

  /** Lists boards on the local network that answer the WiFi transport's probe. Takes about 1.5 s. */
  async discoverBoards(): Promise<NetworkBoardInfo[]> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    const p = new Promise<NetworkBoardInfo[]>((resolve, reject) => {
      this.#pendingDiscover.push({ resolve, reject });
    });
    this.#ws.send(JSON.stringify({ type: "discover" }));
    return p;
  }

  /** The board's own hostname while connected over the network (from its WiFi challenge), else null. */
  get connectedHostname(): string | null {
    return this.connectedOverNetwork ? this.#connectedHostname : null;
  }

  /** True while connected to a board over the network rather than serial. */
  get connectedOverNetwork(): boolean {
    return this.#connectedPort !== null && this.#connectedIsNetwork;
  }

  /** Asks the backend to push a fresh device-runtime onto `port` via raw
   * REPL (backend/src/thingstudio_backend/raw_repl.py + runtime_installer.py,
   * 2026-09-22) -- the browser-triggered equivalent of test-flows/
   * deploy_runtime.py's manual mpremote sequence, for a board with no
   * listener.py running at all (outstanding-items/deploy-runtime-from-
   * editor.md's scoping: raw-REPL bootstrap is the only mechanism that
   * solves an *initial* install, since a bare board has nothing to answer a
   * framed §13 message). Backend-relay only -- there is no WebSerial-direct
   * equivalent (decisions.md's "web serial is deprecated" note), so this
   * only makes sense to call while connModeSelect is "backend".
   *
   * The backend closes any existing relay connection on this port before
   * installing (ws_relay.py's _install_runtime), so this does NOT require
   * connectPort() to have succeeded first -- same "only valid after open()"
   * shape as listPorts(), not connectPort(). Resolves once the backend
   * confirms every file was pushed and the board was hard-reset; rejects
   * with the backend's own NODE_ERROR-prefixed message on failure (serial
   * open failure, any raw-REPL protocol error). The board reboots into the
   * newly-installed listener as part of a successful install -- the caller
   * is expected to reconnect afterward, same as after any other reset;
   * this method doesn't attempt that itself (this file's header: USB
   * re-enumeration timing after a hard reset isn't something to chase per
   * board, per CLAUDE.md's "make the failure legible instead" corollary --
   * a manual reconnect is the legible, doesn't-need-to-be-clever answer). */
  async installRuntime(
    port: string,
    baudRate = 115200,
    onProgress?: (p: InstallProgress) => void,
    idleTimeoutMs = INSTALL_IDLE_TIMEOUT_MS,
    onStatus?: (text: string) => void,
  ): Promise<void> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    if (this.#pendingInstallRuntime) throw new Error("BackendTransport already has an installRuntime() in flight");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const p = new Promise<void>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        this.#pendingInstallRuntime = null;
        fn();
      };
      const armIdleTimer = (ms = idleTimeoutMs) => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            settle(() =>
              reject(
                new InstallRuntimeError(
                  `NODE_ERROR: runtime install stalled -- no word from the backend for ${Math.round(ms / 1000)}s`,
                  "stalled",
                ),
              ),
            ),
          ms,
        );
      };
      this.#pendingInstallRuntime = {
        resolve: () => settle(resolve),
        reject: (err) => settle(() => reject(err)),
        onProgress,
        onStatus,
        armIdleTimer,
      };
      armIdleTimer();
    });
    this.#ws.send(JSON.stringify({ type: "install_runtime", port, baudrate: baudRate }));
    return p;
  }

  /** Writes `text` to the board as-is, no framing (ws_relay.py's raw_write) -- for MicroPython's own
   * ">>>" prompt after STOP_TO_PROMPT, and Ctrl-D ("\x04") to restart the listener from there.
   * Needs connectPort() first. Fire-and-forget: output arrives as ordinary debug lines. */
  rawWrite(text: string): void {
    if (!this.#ws || !this.#connectedPort) throw new Error("not connected to a board");
    this.#ws.send(JSON.stringify({ type: "raw_write", text }));
  }

  /** Removes the saved flow from the board on `port` (board_recovery.py): the backend keeps sending
   * Ctrl-C until the board stops at a prompt (asking the user, via `onStatus`, to press reset if it
   * doesn't), deletes the flow files and resets the board. Like installRuntime(), needs only open().
   * The backend gives up after 60s on its own; `timeoutMs` is a backstop in case it goes quiet. */
  async removeFlow(port: string, onStatus?: (text: string) => void, timeoutMs = 75_000): Promise<void> {
    if (!this.#ws) throw new Error("BackendTransport is not open -- call open() first");
    if (this.#pendingRemoveFlow) throw new Error("BackendTransport already has a removeFlow() in flight");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const p = new Promise<void>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        this.#pendingRemoveFlow = null;
        fn();
      };
      this.#pendingRemoveFlow = {
        resolve: () => settle(resolve),
        reject: (err) => settle(() => reject(err)),
        onStatus,
      };
      timer = setTimeout(
        () => settle(() => reject(new Error(`NODE_ERROR: remove flow got no answer from the backend in ${timeoutMs / 1000}s`))),
        timeoutMs,
      );
    });
    this.#ws.send(JSON.stringify({ type: "remove_flow", port }));
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
    this.#connectedIsNetwork = false;
    for (const waiter of this.#pendingDiscover.splice(0)) waiter.reject(new Error("disconnected before the backend responded"));
    // Reject a still-outstanding connectPort()/listPorts() rather than
    // leaving it hanging forever -- the socket that would have answered it
    // is gone now.
    if (this.#pendingConnect) {
      this.#pendingConnect.reject(new Error("disconnected before the backend responded"));
      this.#pendingConnect = null;
    }
    if (this.#pendingRemoveFlow) {
      this.#pendingRemoveFlow.reject(new Error("disconnected before the backend responded"));
    }
    if (this.#pendingInstallRuntime) {
      this.#pendingInstallRuntime.reject(new Error("disconnected before the backend responded"));
      this.#pendingInstallRuntime = null;
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
            waiter.reject(
              typeof m.errorCode === "string"
                ? new NetworkConnectError(m.error, m.errorCode, typeof m.hostname === "string" ? m.hostname : null)
                : new Error(m.error),
            );
          }
        }
        if (m.connected === true && typeof m.port === "string") {
          this.#connectedPort = m.port;
          this.#connectedIsNetwork = m.network === true;
          this.#connectedHostname = typeof m.hostname === "string" ? m.hostname : null;
          if (this.#pendingConnect) {
            const waiter = this.#pendingConnect;
            this.#pendingConnect = null;
            waiter.resolve();
          }
        } else if (m.connected === false) {
          // Unasked-for (a user disconnect() clears #connectedPort first): the board or the link
          // went away mid-session -- a network board reset or dropped off WiFi, a serial read error.
          const wasConnected = this.#connectedPort !== null;
          this.#connectedPort = null;
          this.#connectedIsNetwork = false;
          if (wasConnected && !this.#closing) this.#events.onDisconnect?.(undefined);
        }
        break;
      }
      case "boards": {
        const waiter = this.#pendingDiscover.shift();
        waiter?.resolve(Array.isArray(m.boards) ? (m.boards as NetworkBoardInfo[]) : []);
        break;
      }
      case "install_runtime_result": {
        // ws_relay.py's _send_install_result(): {ok: bool, error?: string}
        // -- one reply per installRuntime() call, no partial-progress
        // messages in between (raw_repl.py's install_runtime() has no
        // partial-success state worth reporting either, per its own
        // header: "a partially-written runtime is not a state worth
        // distinguishing from a total failure").
        const waiter = this.#pendingInstallRuntime;
        if (m.ok === true) {
          waiter?.resolve();
        } else {
          const message = typeof m.error === "string" ? m.error : "runtime install failed (no error detail from backend)";
          const diagnosis = typeof m.diagnosis === "string" ? m.diagnosis : null;
          waiter?.reject(new InstallRuntimeError(message, diagnosis));
        }
        break;
      }
      case "remove_flow_status": {
        if (typeof m.text === "string") this.#pendingRemoveFlow?.onStatus?.(m.text);
        break;
      }
      case "remove_flow_result": {
        const waiter = this.#pendingRemoveFlow;
        if (m.ok === true) waiter?.resolve();
        else waiter?.reject(new Error(typeof m.error === "string" ? m.error : "remove flow failed (no detail from backend)"));
        break;
      }
      case "install_runtime_status": {
        // ws_relay.py: "waiting for the board to stop..." while board_recovery.catch_prompt runs.
        const waiter = this.#pendingInstallRuntime;
        if (waiter && typeof m.text === "string") {
          waiter.armIdleTimer(INSTALL_CATCH_WAIT_MS);
          waiter.onStatus?.(m.text);
        }
        break;
      }
      case "install_runtime_progress": {
        // ws_relay.py's _send_install_progress(): one per file as it starts. Also proof of life
        // for installRuntime()'s idle timer.
        const waiter = this.#pendingInstallRuntime;
        if (waiter && typeof m.index === "number" && typeof m.total === "number" && typeof m.file === "string") {
          waiter.armIdleTimer();
          waiter.onProgress?.({ index: m.index, total: m.total, file: m.file });
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
