# Flow lifecycle

How a flow is saved, opened, deployed and disconnected.

## Save and open

A flow is saved in a `.flow.json` file you choose, so it can live in a project's git repo like any other file. The
file holds the nodes and their properties, the wiring, the canvas layout and the config nodes.

- **File → Save** (⌘S, or Ctrl+S on Windows and Linux) writes to the flow's file. A new flow has no file yet, so the
  first Save asks where, like Save As. The file's name shows next to the flow name.
- **File → Save As…** (⇧⌘S, or Ctrl+Shift+S) always asks where, and that file becomes the flow's file.
- **File → Open…** (⌘O, or Ctrl+O) loads a flow file. Save then writes back to it.
- **Open recent**, in the File menu, lists the last 8 files you opened or saved, newest first, with each one's flow
  name. After a reload the browser asks once for permission to use the file again. A file that has moved or been
  deleted is taken off the list. **Clear recent files** forgets the list, not the files.
- **File → New flow** starts an empty flow with no file.

If the file has changed on disk since you opened or last saved it, for example after a `git checkout`, Save asks
before overwriting it. Say no and use Save As to keep both.

The recent list is kept in your browser, so another browser or a private window has its own. Safari and Firefox
can't save back to a file: there, Save and Save As download the flow, Open uploads one, and there's no recent list.

**The flow name** field is saved inside the file itself and is sent with every deploy, so a connected board's
identity is visible in the console instead of a bare deployment id. It also suggests a filename for Save As (spaces
and punctuation become dashes), but you can type over that suggestion freely.

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
