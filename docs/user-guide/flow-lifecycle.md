# Flow lifecycle

## Save and open

Flows are saved on the backend, not to a file on your disk. **Save flow** writes the current canvas — node types and properties, wiring, canvas layout, and config nodes, each kept in its own section — under the flow name shown at the top of the editor.

Click **⟳ flows** to list what's saved, pick one, then **Open flow** to load it back, canvas layout included. **Delete flow** removes the selected one.

**The flow name** field is what Save uses as the storage name (spaces and punctuation become dashes), is saved inside the file itself, and is sent with every deploy — so a connected board's identity is visible in the console rather than just an opaque deploy id.

A flow saved this way is still an ordinary JSON file underneath — it lives in the backend's `~/.thingstudio/flows/` directory, one file per flow, git-friendly the same way a locally-saved file always was.

## Deploy

**Compile → Deploy** compiles the current canvas to MicroPython bytecode and sends it to the connected board, replacing whatever flow is currently running there.

A successful deploy shows a confirmation in the console and the new flow starts running immediately. A failed one shows a specific error — either a compile error (something in the flow itself, like a missing required property) or a space error (the compiled flow doesn't fit in the board's available flash/RAM).

**Check status** re-requests the board's identity — chip type, runtime version, and whichever flow is currently running — without resetting the board or redeploying anything. Useful for confirming what's actually on the board after reconnecting to a session already in progress.

**Disconnect** closes the serial connection. The board keeps running whatever flow was last deployed; disconnecting the editor doesn't stop it.
