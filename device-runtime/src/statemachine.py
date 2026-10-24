# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/statemachine.py
#
# The board's half of the wire protocol's state machines (interfaces/protocol/states.json, SPEC §7), run from the
# table generated into protocol_states.py. The table is the ground truth; this file reads it, and implements the
# `board.stream` machine's guards and actions (Stream). The listener supplies board.listener's.
#
# For an event, the first row whose from-states include the current state and whose guard holds is the
# transition. No such row makes the move illegal: announced as a PROTOCOL_ILLEGAL console line (SPEC §7.6), then
# the machine's illegal rule applies. check() runs when a machine is first used, so a table naming a guard or action
# this side doesn't implement fails at boot.
#
# Kept small for the board's RAM: the tables are flat tuples of strings (constants in flash when frozen), the
# machine is a few functions rather than a class, and each side's guards and actions are one function each.
# (Not machine.py: `machine` is MicroPython's hardware module.)

import os

import protocol_states

# A row's fields, in protocol_states.py's flat layout: rows start at index 2, 8 fields each, up to a None marker.
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


def table(name):
    """The machine's flat table and the index where its rows end (its illegal rules follow)."""
    for t in protocol_states.MACHINES:
        if t[0] == name:
            end = 2
            while t[end] is not None:
                end += 8
            return t, end


def check(name, guards, actions):
    """Raises unless this side implements every guard and action the table names."""
    t, end = table(name)
    needs = [t[i + GUARD] for i in range(2, end, 8)] + [t[i + ACTION] for i in range(2, end, 8)]
    needs += [t[i + 1] for i in range(end + 2, len(t), 4)]
    for need in needs:
        if need and need not in guards and need not in actions:
            raise ValueError("%s: the table needs %s, not implemented here" % (name, need))


def find(t, end, state, event, guard, ctx):
    """The index of the row this event takes in `state`, or -1 when the move is illegal. `guard(name, ctx)`."""
    for i in range(2, end, 8):
        if t[i + EVENT] == event:
            frm = t[i]
            if (frm == "*" or frm == state or (" " in frm and state in frm.split())) and \
                    (t[i + GUARD] is None or guard(t[i + GUARD], ctx)):
                return i
    return -1


def illegal(t, end, label, state, event, detail):
    """Announces an illegal move; returns the machine's rule for it: (action, to, reply)."""
    alert("PROTOCOL_ILLEGAL %s %s %s: %s" % (label, state, event, detail))
    for i in range(end + 2, len(t), 4):
        if t[i] == event or t[i] == "*":
            return t[i + 1], t[i + 2], t[i + 3]
    return None, "same", None


# --- board.stream: a file arriving in pieces (SPEC §7.2) ------------------------------------------------------

_ENOSPC = 28
_STREAM, _STREAM_END = table("board.stream")
_STREAM_GUARDS = ("startsOver", "continues", "afterFailure", "complete")
_STREAM_ACTIONS = ("start", "writeAt", "release", "discard")
check("board.stream", _STREAM_GUARDS, _STREAM_ACTIONS)


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _guard(name, c):
    """board.stream's guards. A piece's context is (stream, offset, total, data); a commit's (stream, total).

    Every name is matched explicitly and an unknown one raises: `check()` can only see that the name is in
    _STREAM_GUARDS, so a guard added to the table without an implementation here must fail loudly rather than
    fall through as another guard (`complete`, previously)."""
    s = c[0]
    if name == "startsOver":
        return c[1] == 0 and len(c[3]) <= c[2]
    if name == "continues":
        return 0 < c[1] <= s.stored and c[2] == s.total and c[1] + len(c[3]) <= c[2]
    if name == "afterFailure":
        return c[1] > 0
    if name == "complete":
        return c[1] == s.total and s.stored == c[1]
    raise ValueError("board.stream: guard %r is not implemented" % (name,))


def _act(name, c):
    """board.stream's actions; start and writeAt raise Failure. Unknown names raise, like _guard."""
    s = c[0]
    if name == "discard":
        _remove(s.path)
    elif name == "release":
        pass
    elif name == "start" or name == "writeAt":
        offset, total, data = c[1], c[2], c[3]
        if name == "start" and s.before_start is not None:
            s.before_start(total)  # may raise Failure (a library's free-space check)
        try:
            with open(s.path, "wb" if name == "start" else "r+b") as f:
                if offset:
                    f.seek(offset)
                f.write(data)
        except OSError as e:
            raise Failure("NoSpace" if (e.args and e.args[0] == _ENOSPC) else "WriteFailed", "writing %s failed: %r" % (s.path, e))
        s.stored, s.total = (max(s.stored, offset + len(data)) if offset else len(data)), total
    else:
        raise ValueError("board.stream: action %r is not implemented" % (name,))


class Stream:
    """One file arriving in pieces: the flow, or one file of a library (`instance`, for alerts)."""

    def __init__(self, path, instance, before_start=None):
        self.path = path  # the temporary file
        self.before_start = before_start
        self.label = "board.stream(%s)" % (instance,)
        self.state = _STREAM[1]
        self.stored = self.total = 0
        self.code = self.error = None

    def _run(self, event, ctx, detail):
        """Takes the table's transition (or its illegal rule). Returns None for an ok answer or no answer, else
        (code, error text)."""
        t = _STREAM
        i = find(t, _STREAM_END, self.state, event, _guard, ctx)
        failure = None
        if i < 0:
            action, to, reply = illegal(t, _STREAM_END, self.label, self.state, event, detail)
            if action:
                _act(action, ctx)
        else:
            action, to, reply = t[i + ACTION], t[i + TO], t[i + REPLY]
            if action:
                try:
                    _act(action, ctx)
                except Failure as e:
                    failure = e
                    _remove(self.path)
                    to, reply = t[i + ON_ERROR].split(" ")
        if to != "same":
            self.state = to
        if self.state != "receiving":
            self.stored = self.total = 0
        if failure is not None:
            self.code, self.error = failure.code, failure.message
        elif self.state != "failed":
            self.code = self.error = None
        if reply is None or "!" not in reply:
            return None
        code = reply.split("!")[1]
        if code[0] == "$":  # $error, $failure: the recorded failure
            return (self.code, self.error)
        return (code, detail)

    def put(self, offset, total, data):
        """One piece. None when it is stored, else (code, error)."""
        return self._run("piece", (self, offset, total, data),
                         "piece at byte %d (%d bytes, %d in all); %s" % (offset, len(data), total, self.describe(total)))

    def commit(self, total):
        """None when every byte of `total` arrived (the caller then takes the temporary file), else (code, why).
        Ends the stream either way."""
        why = self.describe(total)
        result = self._run("commit", (self, total), why)
        return None if result is None else (result[0], why)

    def abandon(self):
        """Drops whatever is under way (a whole DEPLOY replaces a transfer): file removed, idle."""
        self._run("abandon", (self,), "")

    def describe(self, total):
        """The stream's state in words, for errors; also what a Garbled FLOW_ACK's offset comes from."""
        if self.state == "failed":
            return "could not be stored: %s" % (self.error,)
        if self.state == "idle":
            return "nothing under way (0 of %d bytes)" % (total,)
        return "%d of %d bytes arrived" % (self.stored, self.total)
