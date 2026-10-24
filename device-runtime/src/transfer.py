# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/transfer.py
#
# A file arriving in pieces: the flow (FLOW_PUT) or one file of a library (DEP_PUT). The rules are the
# `board.stream` machine in interfaces/protocol/states.json (SPEC §7.2), run by statemachine.py; this file only
# implements its guards and actions, and turns the table's reply into the answer's ok/code/error. Any piece may
# be sent again; offset 0 always starts over; a commit ends the stream whatever the outcome; anything else is
# illegal, announced, and answered BadPiece (or Incomplete, for a commit).

try:
    import os
except ImportError:
    os = None

import statemachine
from statemachine import Failure  # noqa: F401 -- also used by callers as transfer.Failure

_ENOSPC = 28


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


# A piece's context: (stream, offset, total, data). A commit's: (stream, total).
_GUARDS = {
    "startsOver": lambda c: c[1] == 0 and len(c[3]) <= c[2],
    "continues": lambda c: 0 < c[1] <= c[0].stored and c[2] == c[0].total and c[1] + len(c[3]) <= c[2],
    "afterFailure": lambda c: c[1] > 0,
    "complete": lambda c: c[1] == c[0].total and c[0].stored == c[1],
}


def _write(path, mode, offset, data):
    try:
        with open(path, mode) as f:
            if offset:
                f.seek(offset)
            f.write(data)
    except OSError as e:
        raise Failure("NoSpace" if (e.args and e.args[0] == _ENOSPC) else "WriteFailed", "writing %s failed: %r" % (path, e))


def _start(c):
    s, offset, total, data = c
    if s.before_start is not None:
        s.before_start(total)  # may raise Failure (a library's free-space check)
    _write(s.path, "wb", 0, data)
    s.stored, s.total = len(data), total


def _write_at(c):
    s, offset, total, data = c
    _write(s.path, "r+b", offset, data)
    s.stored = max(s.stored, offset + len(data))


def _release(c):
    c[0].clear()


def _discard(c):
    _remove(c[0].path)
    c[0].clear()


_ACTIONS = {"start": _start, "writeAt": _write_at, "release": _release, "discard": _discard}


class Stream:
    def __init__(self, path, instance, before_start=None):
        self.path = path  # the temporary file
        self.before_start = before_start
        self.machine = statemachine.Machine("board.stream", _GUARDS, _ACTIONS, instance=instance)
        self.clear()

    def clear(self):
        self.stored = 0
        self.total = 0
        self.code = None
        self.error = None

    @property
    def state(self):
        return self.machine.state

    def _run(self, event, ctx, detail):
        """Takes the table's transition (or its illegal rule) and returns the reply it names: (kind, fields)."""
        m = self.machine
        row = m.find(event, ctx)
        if row is None:
            rule = m.illegal(event, detail)
            if "do" in rule:
                _ACTIONS[rule["do"]](ctx)
            m.move(rule.get("to", "same"))
            reply = rule.get("reply")
            return self._resolve(reply, None, detail)
        failure = None
        if row[statemachine.ACTION]:
            try:
                _ACTIONS[row[statemachine.ACTION]](ctx)
            except Failure as e:
                failure = e
        if failure is not None:
            on_error = row[statemachine.ON_ERROR]
            _remove(self.path)
            self.clear()
            self.code, self.error = failure.code, failure.message
            m.move(on_error["to"])
            return self._resolve(on_error.get("reply"), failure, failure.message)
        m.move(row[statemachine.TO])
        if m.state == "idle":
            self.clear()
        return self._resolve(row[statemachine.REPLY], None, detail)

    def _resolve(self, reply, failure, text):
        """The table's {"ack": {...}} or {"commitError": {...}} with $error/$failure filled in: None when it's an ok
        ack or no reply, else (code, error text)."""
        if not reply:
            return None
        for _kind, fields in reply.items():
            if fields.get("ok"):
                return None
            code = fields.get("code")
            if code == "$error":
                code = failure.code
            elif code == "$failure":
                code, text = self.code, self.error
            return (code, text)
        return None

    def put(self, offset, total, data):
        """One piece. None when it is stored, else (code, error)."""
        detail = "piece at byte %d (%d bytes, %d in all); %s" % (offset, len(data), total, self.describe(total))
        return self._run("piece", (self, offset, total, data), detail)

    def commit(self, total):
        """None when every byte of `total` arrived (the caller then takes the temporary file), else (code, error).
        Ends the stream either way."""
        why = self.describe(total)
        result = self._run("commit", (self, total), why)
        return None if result is None else (result[0], why)

    def describe(self, total):
        """The stream's state in words, for errors."""
        if self.state == "failed":
            return "could not be stored: %s" % (self.error,)
        if self.state == "idle":
            return "nothing under way (0 of %d bytes)" % (total,)
        return "%d of %d bytes arrived" % (self.stored, self.total)

    def abandon(self):
        """Drops whatever is under way (a whole DEPLOY replaces a transfer): file removed, idle."""
        self._run("abandon", (self,), "")

    def stored_offset(self):
        """What a Garbled FLOW_ACK reports: the bytes stored so far, 0 when nothing is under way."""
        return self.stored if self.state == "receiving" else 0
