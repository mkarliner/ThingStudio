// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/transfer.ts
//
// The editor's half of interfaces/protocol/SPEC.md §7: sending a flow (FLOW_PUT pieces, FLOW_COMMIT) and a library
// (DEP_PUT pieces, DEP_COMMIT), as one fixed sequence with named outcomes. Moved out of app/main.ts (2026-10-24,
// protocol audit) so the conversation can be tested on its own -- test/protocol-transfer.test.ts, and the shared
// exchange vectors in test/protocol-exchanges.test.ts -- instead of only by deploying to a board.
//
// The sequence, per SPEC §7.4:
//   each piece    send it, wait up to pieceTimeoutMs for its ack. No answer, or a Garbled answer: send the same
//                 piece again, at most pieceRetries more times (safe: SPEC §7.2 says any piece may be resent).
//                 Any other refusal ends the transfer. An unrequested HELLO ends it too: the board restarted.
//   the commit    start waiting for the answer, then send the commit. Not before: a DEPLOY_ERROR that arrives
//                 while pieces are still going is not this commit's answer (audit finding 4).
//
// A retransmit is a named state of this one path, not a repair (AGENTS.md, "fail well"): the piece and the plan
// never change, and every way out is a single reported failure.
//
// No other editor subsystem is imported (module-boundaries.test.ts): the caller supplies the link.

import type {
  DepAckMessage,
  DepCommitMessage,
  DepPutMessage,
  DepResultMessage,
  FlowAckMessage,
  FlowCommitMessage,
  FlowPutMessage,
  HelloMessage,
  Message,
} from "./messages.js";

/** How the transfer talks to the board. `waitFor` must be armed before the `send` it waits for an answer to,
 * and reject with an Error whose message starts with "timeout" when nothing matches in time (app/main.ts's
 * waitForMessage does both). */
export interface TransferLink {
  send(message: Message): Promise<void>;
  waitFor(match: (m: Message) => boolean, timeoutMs: number): Promise<Message>;
}

export interface TransferTiming {
  /** One piece: written to flash and answered. */
  readonly pieceTimeoutMs: number;
  /** Resends of one piece after no answer or a Garbled answer. */
  readonly pieceRetries: number;
  /** A commit: checked, moved into place and (for a flow) started. */
  readonly commitTimeoutMs: number;
}

export const DEFAULT_TIMING: TransferTiming = { pieceTimeoutMs: 10_000, pieceRetries: 2, commitTimeoutMs: 30_000 };

/** One flow piece: 5 KB, so a deploy is quick. A board that cannot take 5 KB has a memory problem worth seeing,
 * not one to hide behind smaller pieces (Mike, 2026-10-22). */
export const FLOW_PIECE_BYTES = 5120;

/** Something worth a console line while a transfer runs. */
export interface TransferEvent {
  readonly kind: "resend";
  readonly piece: FlowPutMessage | DepPutMessage;
  readonly reason: "timeout" | "garbled";
  readonly detail: string | null;
  /** 1 for the first resend. */
  readonly attempt: number;
}

/** Why a transfer ended without reaching its commit's answer. */
export interface TransferFailure {
  readonly ok: false;
  /** The board's code (BadPiece, NoSpace, Garbled after the last try...), or "Timeout". */
  readonly code: string;
  readonly message: string;
  /** The piece it stopped at. */
  readonly piece: FlowPutMessage | DepPutMessage;
  /** The board restarted while the pieces were being sent: its boot HELLO. */
  readonly restarted: HelloMessage | null;
}

export interface TransferOptions {
  readonly timing?: TransferTiming;
  /** Whether a HELLO that arrives now means the board restarted (rather than answering a HELLO_REQUEST). */
  readonly isRestartHello?: (hello: HelloMessage) => boolean;
  readonly onEvent?: (event: TransferEvent) => void;
}

/** The FLOW_PUT pieces for a flow's bytecode, in order. An empty flow is one empty piece. */
export function flowPieces(bytes: Uint8Array, pieceBytes = FLOW_PIECE_BYTES): FlowPutMessage[] {
  const out: FlowPutMessage[] = [];
  for (let offset = 0; offset < Math.max(bytes.length, 1); offset += pieceBytes) {
    out.push({ type: "FLOW_PUT", offset, total: bytes.length, data: bytes.subarray(offset, offset + pieceBytes) });
  }
  return out;
}

function answersPiece(piece: FlowPutMessage | DepPutMessage, m: Message): m is FlowAckMessage | DepAckMessage {
  if (piece.type === "FLOW_PUT") return m.type === "FLOW_ACK" && m.offset === piece.offset;
  return m.type === "DEP_ACK" && m.name === piece.name && m.file === piece.file && m.offset === piece.offset;
}

/** SPEC §7.1: the board answers a line it couldn't read with FLOW_ACK Garbled, and it is about the line sent
 * last -- a DEP_PUT as much as a FLOW_PUT. */
function isGarbled(m: Message): m is FlowAckMessage {
  return m.type === "FLOW_ACK" && !m.ok && m.code === "Garbled";
}

function pieceName(piece: FlowPutMessage | DepPutMessage): string {
  return piece.type === "FLOW_PUT" ? `flow byte ${piece.offset}` : `${piece.name} (${piece.file} byte ${piece.offset})`;
}

/** Sends every piece, each answered before the next. Resolves null when all are stored, else the failure. */
export async function sendPieces(
  link: TransferLink,
  pieces: readonly (FlowPutMessage | DepPutMessage)[],
  options: TransferOptions = {},
): Promise<TransferFailure | null> {
  const timing = options.timing ?? DEFAULT_TIMING;
  const isRestart = options.isRestartHello ?? (() => true);
  for (const piece of pieces) {
    for (let attempt = 0; ; attempt += 1) {
      const answerP = link.waitFor(
        (m) => answersPiece(piece, m) || isGarbled(m) || (m.type === "HELLO" && isRestart(m)),
        timing.pieceTimeoutMs,
      );
      await link.send(piece);
      let answer: Message;
      try {
        answer = await answerP;
      } catch (err) {
        if (!(err instanceof Error && err.message.startsWith("timeout"))) throw err; // disconnected: the caller reports it
        if (attempt < timing.pieceRetries) {
          options.onEvent?.({ kind: "resend", piece, reason: "timeout", detail: null, attempt: attempt + 1 });
          continue;
        }
        return {
          ok: false,
          code: "Timeout",
          message: `no reply to ${pieceName(piece)} after ${timing.pieceRetries + 1} tries`,
          piece,
          restarted: null,
        };
      }
      if (answer.type === "HELLO") {
        return { ok: false, code: "Restarted", message: `the board restarted during ${pieceName(piece)}`, piece, restarted: answer };
      }
      if (isGarbled(answer)) {
        if (attempt < timing.pieceRetries) {
          options.onEvent?.({ kind: "resend", piece, reason: "garbled", detail: answer.error, attempt: attempt + 1 });
          continue;
        }
        return { ok: false, code: "Garbled", message: answer.error ?? `the board couldn't read ${pieceName(piece)}`, piece, restarted: null };
      }
      const ack = answer as FlowAckMessage | DepAckMessage;
      if (!ack.ok) {
        return { ok: false, code: ack.code ?? "BadPiece", message: ack.error ?? `the board refused ${pieceName(piece)}`, piece, restarted: null };
      }
      break; // stored
    }
  }
  return null;
}

/** How a flow deploy ended. */
export type DeployOutcome =
  | { readonly kind: "deployed"; readonly ack: Message & { type: "DEPLOY_ACK" } }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "restarted"; readonly hello: HelloMessage }
  | { readonly kind: "pieces-failed"; readonly failure: TransferFailure }
  | { readonly kind: "no-answer"; readonly timeoutMs: number };

/** A whole flow deploy: the pieces, then FLOW_COMMIT, then its one answer (SPEC §7.3). A restart while the
 * flow starts shows up as a HELLO in place of the answer. A disconnect rejects. */
export async function deployFlow(
  link: TransferLink,
  bytes: Uint8Array,
  commit: Omit<FlowCommitMessage, "type" | "total">,
  options: TransferOptions & { readonly pieceBytes?: number } = {},
): Promise<DeployOutcome> {
  const timing = options.timing ?? DEFAULT_TIMING;
  const isRestart = options.isRestartHello ?? (() => true);
  const failure = await sendPieces(link, flowPieces(bytes, options.pieceBytes), options);
  if (failure !== null) {
    if (failure.restarted) return { kind: "restarted", hello: failure.restarted };
    return { kind: "pieces-failed", failure };
  }
  // Armed now, not before the pieces (audit finding 4).
  const answerP = link.waitFor(
    (m) => m.type === "DEPLOY_ACK" || m.type === "DEPLOY_ERROR" || (m.type === "HELLO" && isRestart(m)),
    timing.commitTimeoutMs,
  );
  await link.send({ type: "FLOW_COMMIT", total: bytes.length, ...commit });
  let answer: Message;
  try {
    answer = await answerP;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("timeout")) return { kind: "no-answer", timeoutMs: timing.commitTimeoutMs };
    throw err;
  }
  if (answer.type === "DEPLOY_ACK") return { kind: "deployed", ack: answer };
  if (answer.type === "DEPLOY_ERROR") return { kind: "refused", code: answer.code, message: answer.message };
  return { kind: "restarted", hello: answer as HelloMessage };
}

/** How a library install ended. */
export type LibraryOutcome =
  | { readonly kind: "installed"; readonly result: DepResultMessage }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "pieces-failed"; readonly failure: TransferFailure }
  | { readonly kind: "no-answer"; readonly timeoutMs: number };

/** One library: its DEP_PUT pieces, then DEP_COMMIT, then DEP_RESULT (SPEC §7.3). */
export async function installLibrary(
  link: TransferLink,
  pieces: readonly DepPutMessage[],
  commit: DepCommitMessage,
  options: TransferOptions = {},
): Promise<LibraryOutcome> {
  const timing = options.timing ?? DEFAULT_TIMING;
  const failure = await sendPieces(link, pieces, options);
  if (failure !== null) return { kind: "pieces-failed", failure };
  const answerP = link.waitFor((m) => m.type === "DEP_RESULT" && m.name === commit.name, timing.commitTimeoutMs);
  await link.send(commit);
  let answer: Message;
  try {
    answer = await answerP;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("timeout")) return { kind: "no-answer", timeoutMs: timing.commitTimeoutMs };
    throw err;
  }
  const result = answer as DepResultMessage;
  if (!result.ok) return { kind: "refused", code: result.code ?? "Unknown", message: result.error ?? `library ${commit.name} not installed` };
  return { kind: "installed", result };
}
