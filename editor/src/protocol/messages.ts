// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/messages.ts
//
// The §13 wire protocol's message types, as real TypeScript types --
// HELLO, DEPLOY, DEPLOY_ACK/DEPLOY_ERROR, VALUE_STREAM, NODE_ERROR,
// STATE_READ/STATE_WRITE. Deliberately not fixed by the design doc:
// auth/pairing fields and OTA mechanics (§13 explicitly defers both) are
// NOT modeled here -- don't add them speculatively.
//
// Two things this file has to invent, since §13 sketches the message
// *list* but not exact field layouts or wire byte values -- flagged
// explicitly rather than silently decided, matching this session's
// convention for filling a genuine spec gap:
//
// 1. Numeric type-byte assignments (MessageType below). §13 lists these
//    in a specific order; this file just assigns that order 1..8 (0
//    reserved/invalid). Whatever the real device-side listener is built
//    against (Tier 0's "fault isolation" work, a separate chat) has to
//    use this exact same table -- there's no other source of truth yet
//    since device-runtime/src/runtime.py doesn't implement the listener.
// 2. Per-message field names/shapes below, each commented with which
//    part of §5/§13's prose they're read from.
//
// Every field name here is intentionally verbose over terse (`nodeId`
// not `id`, `exceptionMessage` not `msg`) since NODE_ERROR's `msg` would
// otherwise collide in meaning with the *different* `msg` envelope
// (envelope.ts) that flows through deployed nodes -- these are two
// unrelated things that happen to share a design-doc word.

/** Runtime version as major.minor.patch (§13: "not a single opaque number"). */
export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Wire byte values for each message type's 1-byte frame header field
 * (framing.ts). See file header note (1): this exact numbering is a
 * decision made in this chat, not sourced from the design doc, and has
 * to be mirrored by whatever implements the device-side listener.
 */
export const MessageType = {
  HELLO: 1,
  DEPLOY: 2,
  DEPLOY_ACK: 3,
  DEPLOY_ERROR: 4,
  VALUE_STREAM: 5,
  NODE_ERROR: 6,
  STATE_READ: 7,
  STATE_WRITE: 8,
  // Added 2026-09-02 (inject click-only live-fire feature): editor -> device,
  // "fire this source node's coroutine once, right now" -- inject.ts's
  // codegenEventSource waits on this per-node-ID event instead of polling on
  // a repeat interval. Numbered after the original 8, not inserted into the
  // existing sequence, so a device already running the pre-2026-09-02
  // listener.py simply logs "unexpected message type" (LISTENER_IGNORED)
  // instead of misinterpreting some other message.
  TRIGGER: 9,
  // Added 2026-09-05 (real RP2040 hardware pass, no reset button on the
  // Pico W): editor -> device, "resend your current HELLO right now."
  // Explicitly NOT a reset/redeploy/reboot request -- listener.py's
  // _send_hello() only ever ran once, at boot, so a board that's been
  // running a while (or reconnected after a browser tab reload) has no
  // way to get the editor back to a known state (current runtimeVersion/
  // runtimeBuild/free memory) without physically resetting it. This
  // sidesteps that entirely: whatever's already running just reports
  // itself again, no side effects beyond that. Numbered after TRIGGER,
  // same "append, don't renumber" convention -- a device already running
  // the pre-2026-09-05 listener.py logs LISTENER_IGNORED for it instead
  // of misinterpreting some other message.
  HELLO_REQUEST: 10,
  // Added 2026-09-10 (outstanding-items/node-status-indicators.md):
  // device -> editor, a lightweight per-node connection-status push. See
  // NodeStatusMessage's own doc comment for the full reasoning (why this
  // is a new type rather than reusing VALUE_STREAM). Same "append, don't
  // renumber" convention as TRIGGER/HELLO_REQUEST above.
  NODE_STATUS: 11,
  // Added 2026-09-23 (the console's command box): editor -> device, run a line of Python in the
  // listener; its output comes back as plain console lines. Must match messages.py.
  EXEC: 12,
  // Added 2026-09-23: editor -> device, stop the flow and the listener and leave the board at the
  // ">>>" prompt. Must match messages.py.
  STOP_TO_PROMPT: 13,
  // Added 2026-09-24 (WiFi transport, MVP item 6 -- wifi-transport-scoping.md): editor -> device,
  // save the board's hostname and/or WiFi-session password; the device answers
  // BOARD_SETTINGS_RESULT, then a fresh HELLO on success. USB serial only. Must match messages.py.
  SET_BOARD_SETTINGS: 14,
  BOARD_SETTINGS_RESULT: 15,
} as const;

export type MessageTypeId = (typeof MessageType)[keyof typeof MessageType];

/**
 * Device -> editor, on connect. "chip type, MicroPython/runtime version,
 * and free flash/RAM, so the editor can warn before a flow is too big
 * for the target" (§13). `runtimeVersion` is the field §5/§11's
 * major/minor/patch deploy-safety policy reads (version.ts).
 */
export interface HelloMessage {
  readonly type: "HELLO";
  readonly chipType: string;
  readonly runtimeVersion: ProtocolVersion;
  /**
   * Belt-and-braces companion to `runtimeVersion`, added 2026-09-05
   * (CLAUDE.md's "Device-runtime version bump discipline"): a git SHA of
   * `device-runtime/src` at the moment `test-flows/deploy_runtime.py`
   * last pushed it onto this board -- NOT a content hash (deliberately;
   * see that CLAUDE.md section for why a hash was rejected) and NOT part
   * of the deploy-safety decision `version.ts`'s `decideDeploy` makes.
   * Purely informational: `checkRuntimeBuild` (version.ts) compares this
   * to the editor's own build-time SHA and logs a warning on mismatch,
   * never blocks a DEPLOY. `null` means "can't confirm" -- either this
   * board predates the marker file, or `deploy_runtime.py` couldn't
   * determine git info when it last ran -- not "confirmed stale."
   */
  readonly runtimeBuild: string | null;
  /**
   * Flow identity, added 2026-09-05 (decisions.md's "flow identity"
   * entry) as the direct follow-on to boot-time flow auto-resume: once a
   * flow can survive a reset, "is the flow currently running on this
   * board the one I have open" becomes a real question, not a
   * hypothetical. `currentFlowName` is the flow-file's own
   * user-editable, stable name (flow-file.ts's `flowName`) -- meant to
   * be read by a human, not matched programmatically (Mike's own call:
   * a UUID isn't useful here because "matching uuid against flow files
   * would be painful" -- there's no index of flow files by UUID to
   * search). `currentFlowDeployId` is the opposite kind of identifier:
   * a fresh UUID the editor generates on every single Deploy click
   * (main.ts), so it identifies *which deploy* is running, not which
   * flow -- redeploying the identical, unchanged flow twice still gets
   * two different deployIds. Both null together mean no flow has
   * successfully started this boot (never deployed, or every deploy/
   * resume attempt so far failed) -- see listener.py's `_current_flow_name`/
   * `_current_flow_deploy_id`.
   */
  readonly currentFlowName: string | null;
  readonly currentFlowDeployId: string | null;
  readonly freeFlashBytes: number;
  readonly freeRamBytes: number;
  /** Added 2026-09-25 (runtime 5.1.0): ESP-IDF's own data heap, separate from the MicroPython heap
   * `freeRamBytes` counts. On ESP32-family boards the WiFi stack allocates from here, so a low value
   * (or a small largest block -- a join needs contiguous buffers) explains a failed WiFi join. Null
   * on other ports and on older runtimes. */
  readonly freeIdfHeapBytes: number | null;
  readonly largestIdfHeapBlockBytes: number | null;
  /** Added 2026-09-23: the board skipped its saved flow after repeated failed boots (listener.py's
   * safe mode). False when absent -- a runtime older than 2.0.0 never sends it. */
  readonly safeMode: boolean;
  /** Added 2026-09-24 (WiFi transport). All absent from runtimes older than 3.0.0, which decode
   * to null/false. `hostname` is the board's network name; `authRequired` is true once a WiFi
   * password is set (which also switches the WiFi transport on), `authScheme` names how it's
   * checked; `hasWifi` means the firmware has network.WLAN; `networkAddress` is the IP the board is
   * listening on while its WiFi transport is up. */
  readonly hostname: string | null;
  readonly authRequired: boolean;
  readonly authScheme: string | null;
  readonly hasWifi: boolean;
  readonly networkAddress: string | null;
}

/**
 * Editor -> device. "Full flow bytecode plus static data, replacing
 * whatever's currently deployed" (§13) -- full-flow replace only, no
 * per-node-ID diffing in v1 (§6's multi-flow scoping is v2). Bytecode and
 * static data are carried as native CBOR byte strings, not base64 --
 * unlike envelope.ts's `BytesValue` (needed there because the flow-file
 * *JSON* format has no native bytes type), CBOR does, so no base64
 * indirection is needed at this layer.
 */
export interface DeployMessage {
  readonly type: "DEPLOY";
  readonly bytecode: Uint8Array;
  readonly staticData: Uint8Array;
  /**
   * Flow identity, added 2026-09-05 alongside HELLO's `currentFlowName`/
   * `currentFlowDeployId` (see that field's doc comment for the full
   * reasoning) -- `flowName` is the flow file's own stable, user-edited
   * name (flow-file.ts); `deployId` is a fresh `crypto.randomUUID()`
   * main.ts generates fresh on every Deploy click, identifying this one
   * deploy action, not the flow itself. Both nullable on the wire
   * (`expectOptionalString`/`_expect_optional_string`) purely for an
   * old-editor/new-device-runtime compatibility degrade -- this editor
   * always sends real values for both; a device that doesn't recognize
   * these fields simply ignores them (same additive-field precedent as
   * `runtimeBuild` on HELLO).
   */
  readonly flowName: string | null;
  readonly deployId: string | null;
  /**
   * wifi_provision.py's own boot-time marker (device-runtime/src/wifi_provision.py,
   * wifi-provisioning-captive-portal.md, 2026-09-14) -- computed by
   * wifi-status.ts's computeWifiProvisionMarker() from the flow's own wifi_status node config, not
   * authored directly. null for every flow that doesn't reference an "unmanaged" WiFi config (the
   * ordinary case, unaffected by this feature's existence) -- same additive-field/nullable
   * convention as flowName/deployId above, so an old device-runtime that predates this feature
   * simply ignores the key.
   */
  readonly wifiProvision: { selfProvision: boolean; allowReprovision: boolean } | null;
}

/**
 * Device -> editor: deploy succeeded. §13 doesn't specify fields beyond
 * "success"; echoing back updated free-space is cheap and directly useful
 * to the same "warn before a flow is too big" purpose HELLO serves, so
 * it's included here rather than an empty body -- flagged as this file's
 * own addition, not literally spec'd.
 */
export interface DeployAckMessage {
  readonly type: "DEPLOY_ACK";
  readonly freeFlashBytes: number;
  readonly freeRamBytes: number;
  /** Same optional ESP-IDF heap pair as HelloMessage, measured after the new flow started. */
  readonly freeIdfHeapBytes: number | null;
  readonly largestIdfHeapBlockBytes: number | null;
}

/** Device -> editor: deploy failed. "A structured compile/space error" (§13). */
export interface DeployErrorMessage {
  readonly type: "DEPLOY_ERROR";
  readonly code: string;
  readonly message: string;
}

/**
 * Device -> editor, throttled. "Live port values while the editor has a
 * flow open" (§13/§5). `payload` is whatever that port's typed value is
 * (envelope.ts's PayloadType range) -- carried as a native CBOR value,
 * same "no base64 needed" reasoning as DeployMessage above.
 */
export interface ValueStreamMessage {
  readonly type: "VALUE_STREAM";
  readonly nodeId: string;
  readonly portId: string;
  readonly payload: unknown;
  readonly timestampMs: number;
}

/** Device -> editor: the §5 fault-isolation report. "Node ID plus exception type/message" (§13). */
export interface NodeErrorMessage {
  readonly type: "NODE_ERROR";
  readonly nodeId: string;
  readonly exceptionType: string;
  readonly exceptionMessage: string;
}

/** NODE_STATUS's fixed state vocabulary (matches messages.py's
 * NODE_STATUS_STATES exactly -- has to be mirrored by hand, same
 * "no shared config file between the two languages" reasoning this
 * file's own header already gives for the MessageType table). A real
 * runtime array, not just a type union, so codec.ts's decoder can
 * validate an incoming `state` string against it at runtime -- a bare
 * `type` alias erases at compile time and gives decodeMessageBody
 * nothing to check an untrusted wire value against. */
export const NODE_STATUS_STATES = ["connected", "disconnected", "connecting", "error"] as const;
export type NodeStatusState = (typeof NODE_STATUS_STATES)[number];

/**
 * Device -> editor: a lightweight per-node connection-status push
 * (outstanding-items/node-status-indicators.md, Mike's design call
 * 2026-09-09/10). NOT §13's VALUE_STREAM -- that shape (nodeId, portId,
 * payload, timestampMs) is reserved for real wire/port values, the
 * still-unbuilt full live-value-streaming feature (§5); a connection
 * status isn't a port's value, and forcing it into VALUE_STREAM's shape
 * via a synthetic portId would misuse an already-defined contract and
 * muddy it for whenever real live-streaming is eventually built.
 * Deliberately NOT tied to whatever a node's own `msg` carries downstream
 * on its wires either -- wifi-status.ts's/mqtt-shared.ts's codegen calls
 * `runtime.report_status()` alongside (not instead of) their existing
 * emit-on-change `msg` logic, so a status push reaches the editor whether
 * or not anything is actually wired downstream to see the `msg`, the same
 * way NODE_ERROR doesn't depend on wiring either. `state` is a small
 * fixed enum, not Node-RED's free-form fill/shape/text -- the canvas owns
 * one shared state -> color mapping rather than pushing that choice onto
 * every node type's own codegen; additive later if a node type ever needs
 * more nuance. `text` is optional supplementary detail (e.g. an IP
 * address) -- absent, not null, when a node type doesn't have any (same
 * "missing key means not provided" convention every other optional field
 * in this protocol already uses).
 */
export interface NodeStatusMessage {
  readonly type: "NODE_STATUS";
  readonly nodeId: string;
  readonly state: NodeStatusState;
  readonly text?: string;
}

/**
 * §13 lists STATE_READ but not a separate response type -- this file's
 * interpretation (flagged, not spec'd): the same message type carries
 * both directions, distinguished by whether `value` is present. Editor ->
 * device sends a request with `value` omitted; device -> editor responds
 * with the same shape, `value` populated. Mirrors how DEPLOY_ACK is
 * DEPLOY's "response" as a distinct type, except STATE_READ has no
 * distinct type to reuse for its reply.
 */
export interface StateReadMessage {
  readonly type: "STATE_READ";
  readonly nodeId: string;
  readonly key: string;
  readonly value?: unknown;
}

/** Editor -> device: write a value into the persisted state store (§5) without a full redeploy. */
export interface StateWriteMessage {
  readonly type: "STATE_WRITE";
  readonly nodeId: string;
  readonly key: string;
  readonly value: unknown;
}

/**
 * Editor -> device: fire one source node's live-trigger event right now,
 * bypassing whatever's currently running in its coroutine's wait --
 * inject's click-only live-fire feature (2026-09-02,
 * docs/working-notes/outstanding-items/inject-click-fire-missing.md).
 * Fire-and-forget, matching STATE_WRITE's precedent (no distinct ack
 * message) -- the click itself is already the only user-visible feedback
 * this needs; a NODE_ERROR still arrives independently if firing the
 * chain then raises. `nodeId` matches whatever the most recent DEPLOY's
 * compiled source assigned that node (compile.ts's `runtime.spawn(coro(),
 * "<node.id>")` / `runtime.register_trigger("<node.id>", evt)`) -- a
 * TRIGGER naming an unknown/stale node ID (e.g. the canvas changed since
 * the last deploy) is not an error, just a silent no-op on the device
 * side (runtime.py's fire_trigger), same "stale ID after edits" tolerance
 * main.ts's own NODE_ERROR node-highlighting already accepts.
 */
export interface TriggerMessage {
  readonly type: "TRIGGER";
  readonly nodeId: string;
}

/**
 * Editor -> device: "send a fresh HELLO right now." See MessageType's own
 * HELLO_REQUEST comment for why this exists -- gets the editor to a known
 * state on connect/reconnect without needing a reset. No fields: it's a
 * pure request, the device's only response is the normal HELLO message
 * type, not a distinct ack.
 */
export interface HelloRequestMessage {
  readonly type: "HELLO_REQUEST";
}

/** Editor -> device: run `code` (an expression or a statement) in the listener. The device prints
 * the result or a traceback; there's no reply message. */
export interface ExecMessage {
  readonly type: "EXEC";
  readonly code: string;
}

/** Editor -> device: stop the flow and the listener, leaving the board at MicroPython's own prompt.
 * Soft reset (Ctrl-D) or a real reset starts Thingstudio again. */
export interface StopToPromptMessage {
  readonly type: "STOP_TO_PROMPT";
}

/** Editor -> device, over USB serial only. Any field left out is unchanged. `password` sets a new
 * one (8-64 characters); `clearPassword` removes it, which switches the WiFi transport off. */
export interface SetBoardSettingsMessage {
  readonly type: "SET_BOARD_SETTINGS";
  readonly hostname: string | null;
  readonly password: string | null;
  readonly clearPassword: boolean;
}

/** Device -> editor, the answer to SET_BOARD_SETTINGS. `error` says what was wrong when !ok. */
export interface BoardSettingsResultMessage {
  readonly type: "BOARD_SETTINGS_RESULT";
  readonly ok: boolean;
  readonly error: string | null;
}

export type Message =
  | HelloMessage
  | DeployMessage
  | DeployAckMessage
  | DeployErrorMessage
  | ValueStreamMessage
  | NodeErrorMessage
  | StateReadMessage
  | StateWriteMessage
  | TriggerMessage
  | HelloRequestMessage
  | NodeStatusMessage
  | ExecMessage
  | StopToPromptMessage
  | SetBoardSettingsMessage
  | BoardSettingsResultMessage;

export const MESSAGE_TYPE_BY_NAME: Record<Message["type"], MessageTypeId> = {
  HELLO: MessageType.HELLO,
  DEPLOY: MessageType.DEPLOY,
  DEPLOY_ACK: MessageType.DEPLOY_ACK,
  DEPLOY_ERROR: MessageType.DEPLOY_ERROR,
  VALUE_STREAM: MessageType.VALUE_STREAM,
  NODE_ERROR: MessageType.NODE_ERROR,
  STATE_READ: MessageType.STATE_READ,
  STATE_WRITE: MessageType.STATE_WRITE,
  TRIGGER: MessageType.TRIGGER,
  HELLO_REQUEST: MessageType.HELLO_REQUEST,
  NODE_STATUS: MessageType.NODE_STATUS,
  EXEC: MessageType.EXEC,
  STOP_TO_PROMPT: MessageType.STOP_TO_PROMPT,
  SET_BOARD_SETTINGS: MessageType.SET_BOARD_SETTINGS,
  BOARD_SETTINGS_RESULT: MessageType.BOARD_SETTINGS_RESULT,
};

export const MESSAGE_NAME_BY_TYPE: Record<MessageTypeId, Message["type"]> = {
  [MessageType.HELLO]: "HELLO",
  [MessageType.DEPLOY]: "DEPLOY",
  [MessageType.DEPLOY_ACK]: "DEPLOY_ACK",
  [MessageType.DEPLOY_ERROR]: "DEPLOY_ERROR",
  [MessageType.VALUE_STREAM]: "VALUE_STREAM",
  [MessageType.NODE_ERROR]: "NODE_ERROR",
  [MessageType.STATE_READ]: "STATE_READ",
  [MessageType.STATE_WRITE]: "STATE_WRITE",
  [MessageType.TRIGGER]: "TRIGGER",
  [MessageType.HELLO_REQUEST]: "HELLO_REQUEST",
  [MessageType.NODE_STATUS]: "NODE_STATUS",
  [MessageType.EXEC]: "EXEC",
  [MessageType.STOP_TO_PROMPT]: "STOP_TO_PROMPT",
  [MessageType.SET_BOARD_SETTINGS]: "SET_BOARD_SETTINGS",
  [MessageType.BOARD_SETTINGS_RESULT]: "BOARD_SETTINGS_RESULT",
};
