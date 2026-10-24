# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/transfer.py
#
# A file arriving in pieces -- the flow (FLOW_PUT) and each file of a library (DEP_PUT). The state machine
# in interfaces/protocol/SPEC.md §7.2, written as one class so the rules live in one place instead of in
# whichever handler happens to touch a counter (the 2026-10-24 protocol audit found a resent piece, or any
# refused commit, left the board refusing every later deploy, because the counter only went back to 0 on
# success).
#
# A stream is in exactly one of three states:
#   idle       nothing under way
#   receiving  `stored` bytes are in the temporary file, out of `total`
#   failed     writing failed; the temporary file is gone; `code`/`error` say why
#
# The two rules the editor relies on (SPEC §7.2):
#   - any piece may be sent again: writing at an offset already stored rewrites the same bytes;
#   - offset 0 always starts over, whatever state the stream is in.
#
# put() never raises for a bad piece: it returns (code, error), or None when the piece is stored. The caller
# turns that into the FLOW_ACK / DEP_ACK. This module knows nothing about messages or libraries.

try:
    import os
except ImportError:
    os = None

IDLE = "idle"
RECEIVING = "receiving"
FAILED = "failed"

_ENOSPC = 28


class Stream:
    def __init__(self, path):
        self.path = path  # the temporary file
        self.state = IDLE
        self.stored = 0
        self.total = 0
        self.code = None
        self.error = None

    def put(self, offset, total, data):
        """One piece. Returns None when it is stored, else (code, error). See SPEC §7.2's table."""
        n = len(data)
        if offset + n > total:
            return ("BadPiece", "piece at byte %d (%d bytes) runs past the end (%d bytes)" % (offset, n, total))
        if offset == 0:
            return self._write(0, total, data, "wb")
        if self.state == FAILED:
            return (self.code, self.error)
        if self.state == IDLE:
            return ("BadPiece", "piece at byte %d, but no transfer is under way (it must start at 0)" % (offset,))
        if total != self.total:
            return ("BadPiece", "piece says %d bytes in all, the transfer started with %d" % (total, self.total))
        if offset > self.stored:
            return ("BadPiece", "piece at byte %d, expected %d of %d" % (offset, self.stored, self.total))
        return self._write(offset, total, data, "r+b")

    def _write(self, offset, total, data, mode):
        try:
            with open(self.path, mode) as f:
                if offset:
                    f.seek(offset)
                f.write(data)
        except OSError as e:
            code = "NoSpace" if (e.args and e.args[0] == _ENOSPC) else "WriteFailed"
            self.fail(code, "writing %s failed: %r" % (self.path, e))
            return (self.code, self.error)
        if offset == 0:
            self.state = RECEIVING
            self.stored = len(data)
            self.total = total
        else:
            self.stored = max(self.stored, offset + len(data))
        self.code = None
        self.error = None
        return None

    def complete(self, total):
        """True when every byte of `total` has arrived."""
        return self.state == RECEIVING and self.total == total and self.stored == total

    def describe(self, total):
        """Why complete(total) is False, for an Incomplete error."""
        if self.state == FAILED:
            return "could not be stored: %s" % (self.error,)
        if self.state == IDLE:
            return "arrived incomplete (0 of %d bytes)" % (total,)
        return "arrived incomplete (%d of %d bytes)" % (self.stored, total)

    def fail(self, code, error):
        """Records a failure and removes the temporary file. A piece at offset 0 starts over."""
        _remove(self.path)
        self.state = FAILED
        self.stored = 0
        self.code = code
        self.error = error

    def finish(self):
        """After a commit used the temporary file (renamed it into place): back to idle."""
        self.state = IDLE
        self.stored = 0
        self.total = 0
        self.code = None
        self.error = None

    def discard(self):
        """After a commit that did not use it, or to abandon a transfer: remove the file, back to idle."""
        _remove(self.path)
        self.finish()

    def stored_offset(self):
        """What a Garbled FLOW_ACK reports: the bytes stored so far, 0 when nothing is under way."""
        return self.stored if self.state == RECEIVING else 0


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass
