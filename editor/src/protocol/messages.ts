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
  readonly freeFlashBytes: number;
  readonly freeRamBytes: number;
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

export type Message =
  | HelloMessage
  | DeployMessage
  | DeployAckMessage
  | DeployErrorMessage
  | ValueStreamMessage
  | NodeErrorMessage
  | StateReadMessage
  | StateWriteMessage
  | TriggerMessage;

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
};
