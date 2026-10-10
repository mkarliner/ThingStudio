# Check a flow without the editor

`thingstudio-compile` compiles and checks a flow file from the command line, with the same errors the editor gives.
Use it in a script, in CI, or to let an AI assistant check a flow it has written.

## Build it

From the `editor/` folder:

```text
npm ci
npm run build:cli
```

This writes `dist-cli/thingstudio-compile.mjs`, one script that needs only Node 22 or later.

## Use it

```text
node dist-cli/thingstudio-compile.mjs my-flow.flow.json
```

A good flow prints one line:

```text
OK  my-flow.flow.json: 25 nodes, 21 wires, 4 configs, 38980 bytes of MicroPython, 0 warnings
```

A bad one lists every problem it found:

```text
FAIL  my-flow.flow.json: 2 errors
  error: wire from node t1 output 4 to node g1 input 1: node t1 has no output 4 (it has 1)
  error: node x1: unknown node type "thingstudio/teleporter"
```

The exit code is 0 for a valid flow, 1 for a flow with errors, and 2 for a bad command or a file it can't read.

## Options

- `--board board:freenove-s3-4in` checks pins against that board. `--list-boards` shows the choices. Without a
  board, pins are checked against the widest range and a warning says so.
- `--out flow.py` writes the generated MicroPython.
- `--json` prints the result as JSON: `ok`, `errors`, `warnings`, `notes`, `stats` and the `source`.
- `--strict` makes warnings fail the check.
- `--no-syntax` skips the MicroPython syntax check. `--arch` sets its `-march` (default `xtensawin`).

## What it checks

- The file is a flow file, and every node type exists.
- Every wire joins real ports, and is one the editor would accept. The editor drops a wire it refuses when it opens the file.
- A property the file leaves out gets the editor's default, as when you open the file in the editor.
- The flow compiles: pins, properties, GUI layouts, nodes with nothing wired to them.
- The generated code is valid MicroPython. This uses the same `mpy-cross` the editor deploys with, and catches a
  typo in a function node's code before you deploy.

## What it doesn't check

- **WiFi and MQTT credentials.** The secrets are in the backend, so the check uses stand-in values and says so in a
  note. A missing credential shows up when you open the flow in the editor.
- **Custom node packages.** A flow that uses one fails with "unknown node type".
- **A real board.** It can't tell you the display is wired right, or that the memory is enough. Deploy does that.
