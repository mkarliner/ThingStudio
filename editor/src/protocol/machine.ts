// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/machine.ts
//
// Runs a wire-protocol state machine from its table: interfaces/protocol/states.json, generated into
// states.generated.ts (tools/protocol_states.py). The table is the ground truth; this file only knows how to read
// it. For an event, the first row whose from-states include the current state and whose guard holds is taken; no
// such row makes the move illegal, which is reported (SPEC §7.6) before the machine's `illegal` rule applies. The
// board's twin is device-runtime/src/statemachine.py.

import { MACHINES } from "./states.generated.js";

export type MachineName = keyof typeof MACHINES;

interface Row {
  readonly from: readonly string[];
  readonly on: string;
  readonly if?: string;
  readonly do?: string;
  readonly to: string;
}

export interface IllegalMove {
  readonly machine: string;
  readonly state: string;
  readonly event: string;
  readonly detail: string;
}

export class Machine<Ctx> {
  #rows: readonly Row[];
  #illegal: Readonly<Record<string, { readonly to?: string; readonly do?: string }>>;
  state: string;

  constructor(
    readonly name: MachineName,
    private readonly guards: Readonly<Record<string, (ctx: Ctx) => boolean>>,
    private readonly actions: Readonly<Record<string, (ctx: Ctx) => void>>,
    private readonly onIllegal: (move: IllegalMove) => void,
  ) {
    const table = MACHINES[name];
    this.#rows = table.transitions as readonly Row[];
    this.#illegal = table.illegal;
    this.state = table.initial;
    const missing = new Set<string>();
    for (const row of this.#rows) {
      if (row.if && !(row.if in guards)) missing.add(row.if);
      if (row.do && !(row.do in actions)) missing.add(row.do);
    }
    for (const rule of Object.values(this.#illegal)) if (rule.do && !(rule.do in actions)) missing.add(rule.do);
    if (missing.size > 0) throw new Error(`${name}: the table needs ${[...missing].sort().join(", ")}, not implemented here`);
  }

  /** Takes `event`: runs the matching row's action and moves, or reports the move as illegal and applies the
   * machine's illegal rule. Returns whether the move was legal.
   *
   * The action runs in the **from-state**; the state changes after it returns (or, for an illegal move, after
   * the illegal rule's action). Both sides follow that rule (SPEC §7.1), so an action sees the state the event
   * arrived in. */
  fire(event: string, ctx: Ctx, detail = ""): boolean {
    const row = this.#rows.find((r) => r.on === event && r.from.includes(this.state) && (!r.if || this.guards[r.if]!(ctx)));
    if (!row) {
      this.onIllegal({ machine: this.name, state: this.state, event, detail });
      const rule = this.#illegal[event] ?? this.#illegal["*"] ?? {};
      if (rule.do) this.actions[rule.do]!(ctx);
      if (rule.to && rule.to !== "same") this.state = rule.to;
      return false;
    }
    if (row.do) this.actions[row.do]!(ctx);
    if (row.to !== "same") this.state = row.to;
    return true;
  }
}
