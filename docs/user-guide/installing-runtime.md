# Step 5: Install the runtime

How to install the Thingstudio runtime on your board. The runtime is the part of Thingstudio that runs on the
board: it receives your flows and runs them. Libraries that some nodes need are sent later, by Deploy, when a flow
uses them.

1. Check the board's port is selected in the port list, as in [step 4](connecting.md).
2. Choose **Tools → Install runtime…**. If you're connected, it disconnects first. The console shows progress; set
   its **Show** menu to **Info** to see each file.
3. If the board is busy and doesn't stop, the console asks you to press its reset button. On a board without one,
   such as a Pico, unplug it and plug it back in.
4. The board restarts when the install is done. Click **Connect**. If the port has gone from the list, click **⟳**
   first.

After upgrading Thingstudio, the board's runtime may no longer match the editor. Deploy then stops, and the
console says to install the runtime again.

If the install fails, the console says what the board sent back and what to do. See
[Board won't connect](debugging.md#board-wont-connect).

To install the runtime from the command line instead, see
[Command line](command-line.md#installing-the-runtime-from-the-command-line).

## Next

Step 6: [blink an LED](first-flow.md), your first flow.
