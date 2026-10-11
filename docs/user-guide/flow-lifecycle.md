# Flow lifecycle

How a flow is saved, opened, deployed and disconnected.

## Save and open

Flows save to a file you choose, via your browser's own save dialog. **File → Save…** writes the current canvas —
node types and properties, wiring, canvas layout, and config nodes, each kept in its own section — to a `.flow.json`
file wherever you point it, so it can live inside a project's git repo like any other file you're tracking.

**File → Open…** opens the matching native dialog to load one back, canvas layout included. Thingstudio keeps no
list of saved flows; the file lives wherever you saved it, so browsing and deleting it is your OS's or git's job,
the same as any other document.

**The flow name** field is saved inside the file itself and is sent with every deploy, so a connected board's
identity is visible in the console instead of a bare deployment id. It also suggests a filename for the save dialog
(spaces and punctuation become dashes), but you can type over that suggestion freely; nothing enforces a match
between the two.

In Chrome or Edge this is the real OS file dialog each time — Save and Open don't remember the last file you picked,
so you choose a target on every save (the browser's own dialog handles confirming an overwrite if you pick a file
that already exists). Safari and Firefox don't support this file-picker API, so there **File → Save…** falls back to
a plain browser download and **File → Open…** to a plain file-upload picker.

Custom node packages and saved credentials live in `~/.thingstudio/custom-nodes/` and `~/.thingstudio/credentials/`.
They're shared across flows rather than tied to one project, unlike a flow itself — a saved credential referenced by
name from a config node is never written into the `.flow.json` file. See
[The Thingstudio folder](thingstudio-folder.md).

## Deploy

**Compile → Deploy** compiles the current canvas to MicroPython bytecode and sends it to the connected board,
replacing whatever flow is currently running there.

A successful deploy shows a confirmation in the console and the new flow starts running immediately. A failed deploy
leaves the board's current flow running and shows a specific error:

- a compile error — something in the flow itself, such as a missing required property
- a space error — the compiled flow doesn't fit in the board's available flash/RAM
- a library error — see below

After a successful deploy the button grays out: the board is already running exactly what's on the canvas. It
re-enables the moment you change anything (a property, a node, a wire). A failed deploy leaves it enabled so you can
fix the problem and retry.

### Libraries

Some nodes need a library on the board, such as MQTT or a display driver. Deploy installs the libraries your flow uses
and removes ones it no longer uses, so a board holds only what its flow needs. The console lists them on each deploy.
A library already on the board isn't sent again.

A [function node](nodes/function.md) that imports one of these libraries, such as `import mqtt_as`, gets it the same
way. If the board can't take a library, for example because its flash is full, the console names the library and says
why.

**Tools → Check status** re-requests the board's identity — chip type, runtime version, and whichever flow is currently running — without resetting the board or redeploying anything. Useful for confirming what's actually on the board after reconnecting to a session already in progress.

**Disconnect** closes the serial connection. The board keeps running whatever flow was last deployed; disconnecting the editor doesn't stop it.
