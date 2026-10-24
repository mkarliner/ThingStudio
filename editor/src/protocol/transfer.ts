// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/transfer.ts
//
// The editor's half of the wire protocol's transfers (SPEC §7): sending a flow (FLOW_PUT pieces, FLOW_COMMIT) or
// a library (DEP_PUT pieces, DEP_COMMIT). The rules are the `editor.transfer` machine in
// interfaces/protocol/states.json, run by machine.ts; this file classifies what arrives into the machine's events
// and implements its guards and actions. One TransferSession per connection: it sees every message from the board,
// so a transfer answer arriving when nothing is waiting for it is reported as an illegal move (SPEC §7.6) instead
// of being silently dropped.
//
// A resend is a named transition of this one path, not a repair (AGENTS.md, "fail well"): the pieces and the plan
// never change, and every way out is a single outcome.
//
// No other editor subsystem is imported (module-boundaries.test.ts): the caller supplies the link and the clock.

import { Machine, type IllegalMove } from "./machine.js";
import type {
  DepAckMessage,
  DepCommitMessage,
  DepPutMessage,
  DepResultMessage,
  DeployAckMessage,
  FlowAckMessage,
  FlowCommitMessage,
  FlowPutMessage,
  HelloMessage,
  Message,
} from "./messages.js";

export interface TransferLink {
  send(message: Message): Promise<void>;
}

export interface TransferTiming {
  /** One piece: written to flash and answered. */
  readonly pieceTimeoutMs: number;
  /** Resends of one line after no answer or a Garbled answer. */
  readonly pieceRetries: number;
  /** A commit: checked, moved into place and (for a flow) started. */
  readonly commitTimeoutMs: number;
}

export const DEFAULT_TIMING: TransferTiming = { pieceTimeoutMs: 10_000, pieceRetries: 2, commitTimeoutMs: 30_000 };

/** One flow piece: 5 KB, so a deploy is quick. A board that cannot take 5 KB has a memory problem worth seeing,
 * not one to hide behind smaller pieces (Mike, 2026-10-22). */
export const FLOW_PIECE_BYTES = 5120;

type Piece = FlowPutMessage | DepPutMessage;
type Commit = FlowCommitMessage | DepCommitMessage;

/** Something worth a console line while the session runs. */
export type TransferEvent =
  | { readonly kind: "resend"; readonly line: Piece | Commit; readonly reason: "timeout" | "garbled"; readonly detail: string | null; readonly attempt: number }
  | { readonly kind: "illegal"; readonly move: IllegalMove };

/** Why a transfer stopped before its commit's answer. */
export interface TransferFailure {
  /** The board's code (BadPiece, NoSpace...), or Timeout, or Garbled after the last try. */
  readonly code: string;
  readonly message: string;
  /** The line it stopped at. */
  readonly line: Piece | Commit;
}

export type TransferOutcome =
  | { readonly kind: "deployed"; readonly ack: DeployAckMessage }
  | { readonly kind: "installed"; readonly result: DepResultMessage }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "restarted"; readonly hello: HelloMessage }
  | { readonly kind: "pieces-failed"; readonly failure: TransferFailure }
  | { readonly kind: "no-answer"; readonly timeoutMs: number };

export interface TransferOptions {
  readonly timing?: TransferTiming;
  /** Whether a HELLO arriving now means the board restarted (rather than answering a HELLO_REQUEST). */
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

function answers(piece: Piece, m: FlowAckMessage | DepAckMessage): boolean {
  if (piece.type === "FLOW_PUT") return m.type === "FLOW_ACK" && m.offset === piece.offset;
  return m.type === "DEP_ACK" && m.name === piece.name && m.file === piece.file && m.offset === piece.offset;
}

function describe(line: Piece | Commit): string {
  if (line.type === "FLOW_PUT") return `flow byte ${line.offset}`;
  if (line.type === "DEP_PUT") return `${line.name} (${line.file} byte ${line.offset})`;
  return line.type === "FLOW_COMMIT" ? "the flow's commit" : `${line.name}'s commit`;
}

interface Plan {
  readonly pieces: readonly Piece[];
  readonly commit: Commit;
}

/** The event that triggered the current action, and the message that carried it (if any). */
interface Ctx {
  readonly event: string;
  readonly message: Message | null;
}

export class TransferSession {
  readonly #link: TransferLink;
  readonly #timing: TransferTiming;
  readonly #isRestart: (hello: HelloMessage) => boolean;
  readonly #onEvent: (event: TransferEvent) => void;
  readonly #machine: Machine<Ctx>;
  #plan: Plan | null = null;
  #previous: Plan | null = null; // the last transfer, for late answers to it (staleAck)
  #index = 0; // the piece sent last
  #attempts = 0; // resends of the line sent last
  #line: Piece | Commit | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastWasGarbled = false;
  #done: ((outcome: TransferOutcome) => void) | null = null;
  #broken: ((err: Error) => void) | null = null;
  #lostReason = "";

  constructor(link: TransferLink, options: TransferOptions = {}) {
    this.#link = link;
    this.#timing = options.timing ?? DEFAULT_TIMING;
    this.#isRestart = options.isRestartHello ?? (() => true);
    this.#onEvent = options.onEvent ?? (() => {});
    this.#machine = new Machine<Ctx>(
      "editor.transfer",
      {
        morePieces: () => this.#index < this.#plan!.pieces.length - 1,
        canRetry: () => this.#attempts < this.#timing.pieceRetries,
      },
      {
        sendPiece: () => this.#send(0),
        sendNext: () => this.#send(this.#index + 1),
        sendCommit: () => this.#send(-1),
        resend: (c) => this.#resend(c),
        fail: (c) => this.#fail(c),
        finishRestarted: (c) => this.#end({ kind: "restarted", hello: c.message as HelloMessage }),
        finishOk: (c) =>
          this.#end(c.message!.type === "DEPLOY_ACK" ? { kind: "deployed", ack: c.message as DeployAckMessage } : { kind: "installed", result: c.message as DepResultMessage }),
        finishRefused: (c) => {
          const m = c.message as Message & { type: "DEPLOY_ERROR" | "DEP_RESULT" };
          this.#end(m.type === "DEPLOY_ERROR" ? { kind: "refused", code: m.code, message: m.message } : { kind: "refused", code: m.code ?? "Unknown", message: m.error ?? `${m.name} not installed` });
        },
        finishNoAnswer: () => this.#end({ kind: "no-answer", timeoutMs: this.#timing.commitTimeoutMs }),
        abort: () => this.#abort(),
        note: () => {},
      },
      (move) => this.#onEvent({ kind: "illegal", move }),
    );
  }

  get state(): string {
    return this.#machine.state;
  }

  /** A whole flow deploy: the pieces, then FLOW_COMMIT, then its one answer (SPEC §7.3). Rejects only if the
   * connection is lost. */
  deploy(bytes: Uint8Array, commit: Omit<FlowCommitMessage, "type" | "total">, pieceBytes = FLOW_PIECE_BYTES): Promise<TransferOutcome> {
    return this.#run({ pieces: flowPieces(bytes, pieceBytes), commit: { type: "FLOW_COMMIT", total: bytes.length, ...commit } });
  }

  /** One library: its DEP_PUT pieces, then DEP_COMMIT, then DEP_RESULT. */
  install(pieces: readonly DepPutMessage[], commit: DepCommitMessage): Promise<TransferOutcome> {
    return this.#run({ pieces, commit });
  }

  /** Every message from the board goes through here; those that aren't about transfers are ignored. */
  receive(m: Message): void {
    const event = this.#classify(m);
    if (event === null) return;
    this.#lastWasGarbled = event === "garbled";
    this.#machine.fire(event, { event, message: m }, `${m.type} ${JSON.stringify(m, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v))}`);
  }

  /** The connection to the board closed: a transfer under way ends (its promise rejects with `reason`). */
  connectionLost(reason: string): void {
    this.#lostReason = reason;
    this.#machine.fire("lost", { event: "lost", message: null });
  }

  #run(plan: Plan): Promise<TransferOutcome> {
    if (this.#machine.state !== "idle") return Promise.reject(new Error("a transfer is already under way"));
    return new Promise((resolve, reject) => {
      this.#plan = plan;
      this.#done = resolve;
      this.#broken = reject;
      this.#machine.fire("start", { event: "start", message: null });
    });
  }

  #classify(m: Message): string | null {
    const state = this.#machine.state;
    const plan = this.#plan;
    switch (m.type) {
      case "HELLO":
        return state !== "idle" && this.#isRestart(m) ? "restart" : null;
      case "FLOW_ACK":
      case "DEP_ACK": {
        if (m.type === "FLOW_ACK" && !m.ok && m.code === "Garbled") return "garbled";
        const current = state === "sending" && plan ? plan.pieces[this.#index] : undefined;
        if (current && answers(current, m)) return m.ok ? "pieceOk" : "pieceRefused";
        // Already answered: earlier pieces of this transfer (all of them once committing), or the last transfer's.
        const answered = plan ? (state === "committing" ? plan.pieces : plan.pieces.slice(0, this.#index)) : [];
        return [...answered, ...(this.#previous?.pieces ?? [])].some((p) => answers(p, m)) ? "staleAck" : "strayAck";
      }
      case "DEPLOY_ACK":
      case "DEPLOY_ERROR":
        if (m.type === "DEPLOY_ERROR" && m.code === "MemoryError" && this.#lastWasGarbled) return "earlyMemoryError";
        if (state === "committing" && plan?.commit.type === "FLOW_COMMIT") return m.type === "DEPLOY_ACK" ? "commitOk" : "commitRefused";
        return "strayResult";
      case "DEP_RESULT":
        if (state === "committing" && plan?.commit.type === "DEP_COMMIT" && m.name === plan.commit.name) return m.ok ? "commitOk" : "commitRefused";
        return "strayResult";
      default:
        return null;
    }
  }

  /** Sends piece `index`, or the commit for -1, and starts the wait for its answer. */
  #send(index: number): void {
    const plan = this.#plan!;
    this.#attempts = 0;
    if (index >= 0) this.#index = index;
    this.#transmit(index >= 0 ? plan.pieces[index]! : plan.commit);
  }

  #resend(c: Ctx): void {
    this.#attempts += 1;
    const garbled = c.event === "garbled" ? (c.message as FlowAckMessage) : null;
    this.#onEvent({ kind: "resend", line: this.#line!, reason: garbled ? "garbled" : "timeout", detail: garbled?.error ?? null, attempt: this.#attempts });
    this.#transmit(this.#line!);
  }

  #transmit(line: Piece | Commit): void {
    this.#line = line;
    this.#clearTimer();
    const timeoutMs = line.type === "FLOW_COMMIT" || line.type === "DEP_COMMIT" ? this.#timing.commitTimeoutMs : this.#timing.pieceTimeoutMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#machine.fire("timeout", { event: "timeout", message: null });
    }, timeoutMs);
    this.#link.send(line).catch((err: unknown) => this.connectionLost(err instanceof Error ? err.message : String(err)));
  }

  #fail(c: Ctx): void {
    const line = this.#line!;
    let code: string;
    let message: string;
    if (c.event === "timeout") {
      code = "Timeout";
      message = `no reply to ${describe(line)} after ${this.#timing.pieceRetries + 1} tries`;
    } else {
      const ack = c.message as FlowAckMessage | DepAckMessage;
      code = ack.code ?? "BadPiece";
      message = ack.error ?? `the board refused ${describe(line)}`;
    }
    this.#end({ kind: "pieces-failed", failure: { code, message, line } });
  }

  #end(outcome: TransferOutcome): void {
    this.#clearTimer();
    const done = this.#done;
    this.#previous = this.#plan;
    this.#plan = null;
    this.#done = this.#broken = null;
    done?.(outcome);
  }

  #abort(): void {
    this.#clearTimer();
    const broken = this.#broken;
    this.#previous = this.#plan;
    this.#plan = null;
    this.#done = this.#broken = null;
    broken?.(new Error(this.#lostReason || "the connection closed"));
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
