// SPDX-License-Identifier: Apache-2.0
// editor/test/machine.test.ts
//
// The order a transition runs in (SPEC §7.1, interfaces/protocol/states.json's `about`): the row's action runs
// in the state the event arrived in, and the machine moves after it returns. The board's interpreter
// (statemachine.py) already worked that way; the editor moved first until the pre-merge review (2026-10-24), so
// an action saw the state it was moving to. This pins the rule on the editor side.

import { describe, expect, it } from "vitest";
import { Machine } from "../src/protocol/machine.js";
import { MACHINES } from "../src/protocol/states.generated.js";

interface Row {
  readonly if?: string;
  readonly do?: string;
}

const table = MACHINES["editor.transfer"];
const guards = new Set((table.transitions as readonly Row[]).map((r) => r.if).filter((n): n is string => Boolean(n)));
const actions = new Set(
  [
    ...(table.transitions as readonly Row[]).map((r) => r.do),
    ...Object.values(table.illegal as Record<string, { do?: string }>).map((r) => r.do),
  ].filter((n): n is string => Boolean(n)),
);

/** A machine whose every action records the state it ran in. */
function machine(seen: string[]): Machine<null> {
  let self: Machine<null> | null = null;
  const acts = Object.fromEntries([...actions].map((name) => [name, () => seen.push(self!.state)]));
  self = new Machine<null>(
    "editor.transfer",
    Object.fromEntries([...guards].map((name) => [name, () => true])),
    acts,
    () => {},
  );
  return self;
}

describe("Machine transition order", () => {
  it("runs the action in the from-state, then moves", () => {
    const seen: string[] = [];
    const m = machine(seen);
    const from = m.state;
    expect(m.fire("start", null)).toBe(true);
    expect(seen[0], "the action must see the state the event arrived in").toBe(from);
    expect(m.state).not.toBe(from);
  });

  it("runs an illegal rule's action in the from-state too", () => {
    const seen: string[] = [];
    const m = machine(seen);
    const from = m.state;
    expect(m.fire("not-an-event", null)).toBe(false);
    if (seen.length > 0) expect(seen[0]).toBe(from);
    expect(m.state).toBe(from); // the table's illegal rule for an unknown event is `same`
  });
});
