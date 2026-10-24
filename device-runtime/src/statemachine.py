# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/statemachine.py
#
# Runs a wire-protocol state machine from its table: interfaces/protocol/states.json, generated into
# protocol_states.py (tools/protocol_states.py). The table is the ground truth; this file only knows how to read
# it. For an event, the first row whose from-states include the current state and whose guard holds is the
# transition; no such row means the move is illegal, which is announced as a PROTOCOL_ILLEGAL console line
# (SPEC §7.6) before the caller applies the machine's `illegal` rule.
#
# The caller supplies the guards and actions by name, checked against the table when the machine is built, so a
# table naming something this side doesn't implement fails at boot, not on the first message that needs it.
#
# (Not named machine.py: `machine` is MicroPython's hardware module.)

import protocol_states

# A transition row's fields (protocol_states.py's tuple layout).
FROM, EVENT, GUARD, ACTION, TO, REPLIES, REPLY, ON_ERROR = 0, 1, 2, 3, 4, 5, 6, 7


def alert(line):
    """Where illegal moves are announced: the console, which reaches the editor. Tests replace it."""
    print(line)


class Failure(Exception):
    """An action that could not be done (a flash write, say): `code` and `message`, SPEC §7.5."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class Machine:
    def __init__(self, name, guards, actions, instance=None):
        initial, self.rows, self.illegal_rules, instances = protocol_states.MACHINES[name]
        self.name = name if instance is None else "%s(%s)" % (name, instance)
        self.instance = instances[instance] if instance is not None else None
        self.state = initial
        self.guards = guards
        self.actions = actions
        needed_guards = {r[GUARD] for r in self.rows if r[GUARD]}
        needed_actions = {r[ACTION] for r in self.rows if r[ACTION]}
        needed_actions.update(rule["do"] for rule in self.illegal_rules.values() if "do" in rule)
        missing = [g for g in needed_guards if g not in guards] + [a for a in needed_actions if a not in actions]
        if missing:
            raise ValueError("%s: the table needs %s, not implemented here" % (self.name, ", ".join(sorted(missing))))

    def find(self, event, ctx):
        """The transition this event takes now, or None when it is illegal."""
        for row in self.rows:
            if row[EVENT] == event and self.state in row[FROM] and (row[GUARD] is None or self.guards[row[GUARD]](ctx)):
                return row
        return None

    def illegal(self, event, detail):
        """Announces an illegal move and returns the machine's rule for it: {"do", "to", "reply"}."""
        alert("PROTOCOL_ILLEGAL %s %s %s: %s" % (self.name, self.state, event, detail))
        return self.illegal_rules.get(event) or self.illegal_rules.get("*") or {}

    def move(self, to):
        if to != "same":
            self.state = to
