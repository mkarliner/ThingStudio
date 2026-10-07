# journal.py -- spike stand-in for a `journal` node's storage: a fixed-length ring
# of floats (array('f'), 4 bytes per entry), clocked. NaN marks a gap (unknown or
# stale input at the tick), never a repeated last value.
import array

NAN = float('nan')


class Journal:
    def __init__(self, n):
        self.n = n
        self.buf = array.array('f', [NAN] * n)
        self.head = 0     # next slot to write
        self.count = 0    # entries written, capped at n

    def push(self, v):
        self.buf[self.head] = NAN if v is None else v
        self.head = (self.head + 1) % self.n
        if self.count < self.n:
            self.count += 1

    def get(self, i):
        """i-th entry, oldest first, 0 <= i < count."""
        return self.buf[(self.head - self.count + i) % self.n]
