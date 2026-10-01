# If you know Arduino and C

If you've written `setup()` and `loop()` in C or C++, Thingstudio will feel different in three ways. It uses
Python rather than C, you wire events together instead of writing a loop, and a change goes to the board in
seconds without reflashing.

## Python instead of C

The board runs [MicroPython](../background/micropython.md), which you flash once in place of an Arduino sketch.
Your own code, in function nodes and custom nodes, is Python.

Python is slower than C and uses more memory. That's fine for sensing, switching, displays and networking. It's
the wrong tool for tight timing, such as bit-banging a protocol at microsecond precision or sampling at high
rates.

## Events instead of a loop

There's no `loop()`. Each job is its own chain of nodes, started by an event: a timer, a pin change, a network
message. Jobs don't wait for each other. See [event-driven programming](../background/event-driven.md).

The `interrupt` node works like `attachInterrupt()`. The difference is that your code runs
safely in the main program, not inside the interrupt, so you can do anything there.

## No compile-and-flash cycle

The firmware stays the same. Deploying a flow sends a small compiled file to the board, over USB or WiFi, and the
board swaps it in. Changing a flow and trying it again takes seconds.

## What stays the same

Thingstudio checks your pin
numbers against the board before deploying, and refuses pins that would crash it, such as those wired to the
flash chip. See [boards and processors](../boards.md).

Next: [getting started](../getting-started.md).
