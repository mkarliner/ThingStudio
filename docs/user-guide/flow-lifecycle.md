# Flow lifecycle

## Save and open

Flows save to a file you choose, via your browser's own save dialog — no backend needed for this part. **Save flow…** writes the current canvas — node types and properties, wiring, canvas layout, and config nodes, each kept in its own section — to a `.flow.json` file wherever you point it, so it can live inside a project's git repo like any other file you're tracking.

**Open flow…** opens the matching native dialog to load one back, canvas layout included. There's no in-editor list of saved flows and no delete button — the file lives wherever you saved it, so browsing and deleting it is your OS's/git's job, the same as any other document.

**The flow name** field is saved inside the file itself and is sent with every deploy — so a connected board's identity is visible in the console rather than just an opaque deploy id. It also suggests a filename for the save dialog (spaces and punctuation become dashes), but you can type over that suggestion freely; nothing enforces a match between the two.

In Chrome or Edge this is the real OS file dialog each time — Save and Open don't remember the last file you picked, so you choose a target on every save (the browser's own dialog handles confirming an overwrite if you pick a file that already exists). Safari and Firefox don't support this file-picker API at all, so there **Save flow…** falls back to a plain browser download and **Open flow…** to a plain file-upload picker.

Custom node packages and saved credentials (see [Canvas basics](canvas-basics.md#config-nodes)) are the two things that still live on the backend, in `~/.thingstudio/custom-nodes/` and `~/.thingstudio/credentials/`. They're shared across flows rather than tied to one project, unlike a flow itself — a saved credential referenced by name from a config node never gets written into the `.flow.json` file.

## Deploy

**Compile → Deploy** compiles the current canvas to MicroPython bytecode and sends it to the connected board, replacing whatever flow is currently running there.

A successful deploy shows a confirmation in the console and the new flow starts running immediately. A failed one shows a specific error — either a compile error (something in the flow itself, like a missing required property) or a space error (the compiled flow doesn't fit in the board's available flash/RAM). The button grays out right after a successful deploy — it means the board is already running exactly what's on the canvas — and re-enables the moment you change anything (a property, a node, a wire). A failed deploy leaves it enabled so you can fix the problem and retry immediately.

**Check status** re-requests the board's identity — chip type, runtime version, and whichever flow is currently running — without resetting the board or redeploying anything. Useful for confirming what's actually on the board after reconnecting to a session already in progress.

**Disconnect** closes the serial connection. The board keeps running whatever flow was last deployed; disconnecting the editor doesn't stop it.
