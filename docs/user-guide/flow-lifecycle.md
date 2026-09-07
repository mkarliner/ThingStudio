# Flow lifecycle

## Save and open

**Save flow** writes the current canvas to a `.flow.json` file: node types and properties, wiring, canvas layout, and config nodes, each kept in its own section of the file. Position changes and behavior changes land in different parts of the file, so a `git diff` on a saved flow tells you something real — moving a node doesn't look like rewriting one.

**Open flow** loads one back, canvas layout included.

**The flow name** field at the top of the editor is saved in the file and sent with every deploy, so a connected board's identity is visible in the console rather than just an opaque deploy id.

## Deploy

**Compile → Deploy** compiles the current canvas to MicroPython bytecode and sends it to the connected board, replacing whatever flow is currently running there.

A successful deploy shows a confirmation in the console and the new flow starts running immediately. A failed one shows a specific error — either a compile error (something in the flow itself, like a missing required property) or a space error (the compiled flow doesn't fit in the board's available flash/RAM).

**Check status** re-requests the board's identity — chip type, runtime version, and whichever flow is currently running — without resetting the board or redeploying anything. Useful for confirming what's actually on the board after reconnecting to a session already in progress.

**Disconnect** closes the serial connection. The board keeps running whatever flow was last deployed; disconnecting the editor doesn't stop it.
