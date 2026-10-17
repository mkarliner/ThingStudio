# Command line

Options for starting Thingstudio, a way to install the runtime and run flows without the editor, and a check for a
flow file. To check a flow file from the command line, see [Check a flow without the editor](check-a-flow.md).

## Starting options

Add these after `thingstudio` (or `thingstudio-backend`, from source). `thingstudio --help` lists them all.

| Option | What it does |
| --- | --- |
| `--no-browser` | Don't open the editor in a browser. Open `http://127.0.0.1:8765/` yourself. |
| `--port N` | Serve the editor on port `N` instead of 8765. |
| `--data-dir DIR` | Use `DIR` instead of `~/.thingstudio`. See [The Thingstudio folder](thingstudio-folder.md#using-a-different-folder). |
| `--log-level LEVEL` | How much Thingstudio prints in its terminal: `DEBUG`, `INFO` (default), `WARNING` or `ERROR`. |

If you restart Thingstudio with the editor still open, that tab reconnects and no new one opens.

## Installing the runtime from the command line

Useful for scripting, or setting up several boards at once. It needs a copy of the source repository. Click
**Disconnect** in the editor first, so the port is free.

```sh
pip install mpremote
python3 test-flows/deploy_runtime.py --port PORT
```

`PORT` is the board's port, as shown in the editor's port list. When it finishes, click **Connect** in the editor.

`device_cli.py runtime install` does the same thing and resets the board afterwards; see below.

## Deploy and run a flow without the editor

`device_cli.py` is a small command line for a board on USB serial. It does what the editor does, without a browser:
find the board, check the runtime, deploy a flow, fire inject nodes, run console commands and watch the output.

```sh
python3 test-flows/device_cli.py list          # USB serial ports
python3 test-flows/device_cli.py hello         # runtime version, chip, running flow
python3 test-flows/device_cli.py flow deploy my-flow.flow.json \
    --mpy-cross ~/mpy-src/mpy-cross/build/mpy-cross
python3 test-flows/device_cli.py trigger inject0001
python3 test-flows/device_cli.py exec "settings.namespaces()"
python3 test-flows/device_cli.py watch
```

- If there is one USB serial port, `--port` is not needed. Use `--port` or `THINGSTUDIO_PORT` otherwise.
- `flow deploy` compiles the `.flow.json` with the same compiler as the editor, then deploys it. It takes the flow
  name from the file's own `flowName`. That name is also the `settings` namespace, so check it is what you expect.
- `--trigger NODE_ID` (repeatable) fires inject or startup nodes after deploy, for testing without clicking.
- `--json` prints one JSON object per line, for scripts.
- Disconnect in the editor first: only one program can hold the serial port.
- `flow deploy` needs a native `mpy-cross`. The build recipe is in `device-runtime/test/README.md`, or set
  `THINGSTUDIO_MPY_CROSS` to one you already have.

`python3 test-flows/device_cli.py <command> --help` lists every option. `test-flows/README.md` has ready-made test
flows and their expected output.
