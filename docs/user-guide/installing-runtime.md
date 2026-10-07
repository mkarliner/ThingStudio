# Step 4: Install the runtime

The runtime is the part of Thingstudio that runs on the board. It receives your flows and runs them. Each board needs
it once. Libraries that some nodes need are installed later, by Deploy, only when a flow uses them.

1. Check the board's port is selected in the port list, as in [step 3](connecting.md).
2. Choose **Tools → Install runtime…**. It takes about half a minute and shows each file as it goes.
   If the board is busy and doesn't stop, the console asks you to press its reset button. A board without one, such
   as a Pico, can be unplugged and plugged back in instead.
3. The board restarts when it's done. Click **Connect** again.

The console now shows the board's chip type, runtime version and free memory.

If something goes wrong, the console says what the board sent back and what to do. See
[board won't connect](debugging.md#board-wont-connect).

To install the runtime from the command line instead, see [more on installing](installing-more.md).

## Next

Step 5: [blink an LED](first-flow.md), your first flow.
