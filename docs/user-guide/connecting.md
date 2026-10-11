# Step 4: Connect your board

Connect the board over USB so the editor can talk to it. Start Thingstudio if it isn't running: see
[step 1](getting-started.md#start-thingstudio).

To connect:

1. Plug the board in.
2. Check the port list in the toolbar. When the editor opens it looks for boards, and selects yours if it's the only
   USB device plugged in. If you plugged the board in afterwards, click **⟳** next to the port list.
3. Click **Connect**. It changes to **Connected · Disconnect**. Click that to disconnect.

With more than one USB device plugged in, pick your board from the port list. Port names depend on your operating
system and the board's USB chip. To tell which port is your board, unplug it, click **⟳**, plug it back in and
click **⟳** again. The port that appears is your board.

## What the console says

A board with MicroPython but no Thingstudio runtime gives this message:

```text
No reply from the runtime. MicroPython but no Thingstudio runtime: Tools → Install runtime…
```

You install the runtime in the next step.

If the console says nothing came back, or the board replied but isn't running MicroPython, go back to
[step 3: install MicroPython](installing-micropython.md). Other messages are explained in
[Board won't connect](debugging.md#board-wont-connect).

Once the runtime is installed, the console shows which flow the board is running, if any.

Once a board with WiFi is set up, you can also connect to it over WiFi. See
[Connecting over WiFi](wifi-connection.md).

## Next

Step 5: [install the runtime](installing-runtime.md).
