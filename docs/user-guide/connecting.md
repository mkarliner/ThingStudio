# Step 3: Connect your board

Start Thingstudio if it isn't running. See [step 1](getting-started.md#start-thingstudio).

1. Plug the board in.
2. Check the port list in the toolbar. When the editor opens it looks for boards, and picks yours if it's the only
   one plugged in. If you plugged it in afterwards, click **⟳** next to the port list.
3. Click **Connect**.

With more than one board plugged in, pick yours from the list. Port names depend on your operating system and the
board's USB chip, so there's no fixed name to look for. If you're not sure which is yours, unplug it, click **⟳**,
plug it back in and click again. The one that appears is your board.

## What the console says

A new board doesn't have the Thingstudio runtime yet. The console says so. That's expected: the next step installs
it.

If the console says the board didn't reply, or isn't running MicroPython, go back to
[step 2: install MicroPython](installing-micropython.md). Other messages are explained in
[board won't connect](debugging.md#board-wont-connect).

Once the runtime is installed, the board replies with its chip type, runtime version and free memory. The button
then shows **● Connected · Disconnect**. Click it to disconnect.

Once a board with WiFi is set up, you can also connect to it over WiFi. See
[connecting over WiFi](wifi-connection.md).

## Next

Step 4: [install the runtime](installing-runtime.md).
