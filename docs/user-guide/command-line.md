# Command line

Options for starting Thingstudio, and a way to install the runtime without the editor. To check a flow file from
the command line, see [Check a flow without the editor](check-a-flow.md).

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
