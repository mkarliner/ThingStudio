# If you know MicroPython

Thingstudio sits on top of the MicroPython you already have. It doesn't replace your firmware. It adds a runtime
and a way to write programs as flows, while the REPL and your own Python stay within reach.

## What goes on the board

**Tools → Install runtime…** copies a small set of Python files onto the board's filesystem, including a `main.py` that
starts the Thingstudio runtime at boot. The runtime listens on USB or WiFi for the editor, and runs the last flow
you deployed.

If your board already has a `main.py` of your own, copy it off first.

## What a flow becomes

When you deploy, the editor turns the flow into MicroPython source. Each source node, such as a `timer` or an
`interrupt`, becomes an `asyncio` task. The other nodes become `async` functions that each task calls in turn. The
editor compiles the result to `.mpy` bytecode with `mpy-cross` and sends it to the board, which swaps it in without
a reset. Compiling on your computer means the board never needs RAM for the compiler.

The board saves the flow and runs it again after a restart.

## Your own code

- **Function nodes** run your Python on each message. They're called from the event loop, so don't block: no
  `time.sleep()`, no long loops. See [event-driven programming](../background/event-driven.md).
- **Custom nodes** turn your own code, such as a sensor driver, into a node with its own properties.
  See [writing custom nodes](../custom-nodes.md).

## The REPL

The box under the editor's console runs Python on the board while the flow runs, for quick checks like
`gc.mem_free()`. For the full `>>>` prompt, click **Stop flow & open prompt**. To use Thonny or `mpremote`, click
**Disconnect** first. See [commands and the Python prompt](../debugging.md#commands-and-the-python-prompt).

## Memory

A flow, its nodes and the runtime all share the board's RAM. If a deploy fails for lack of space, the console says
so. See [debugging](../debugging.md).

Next: [getting started](../getting-started.md).
