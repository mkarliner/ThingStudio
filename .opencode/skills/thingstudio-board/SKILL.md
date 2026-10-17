---
name: Thingstudio board
description: Use when a Thingstudio board is attached over USB serial and you need to check, deploy, trigger, or inspect a flow on it — list ports, verify/install the runtime, deploy a .flow.json, fire inject nodes, run console commands, and watch output.
---

# Thingstudio board

A board is on USB serial. Use the repo's headless CLI for everything; do not drive the wire
protocol by hand or assume the port path.

```sh
python3 test-flows/device_cli.py <command> [options]
```

The port is usually `/dev/ttyACM0` or `/dev/ttyUSB0`, but never assume it: `list` finds it, and if
there is exactly one USB serial port the commands use it without `--port`.

If opening the port says `permission denied` because your shell's group list predates being added
to `dialout`, prefix the command with `sg dialout -c "..."` rather than asking for a re-login.

## 1. Find the board and check it

```sh
python3 test-flows/device_cli.py list
python3 test-flows/device_cli.py hello
```

`hello` prints the runtime version, chip, deployed flow name, safe mode, and installed libraries.
Run it before anything else; it tells you whether the board is answering at all.

- No HELLO: the listener is not running (board at the MicroPython prompt, or no runtime). Try
  `python3 test-flows/device_cli.py runtime install` (see below).
- `ERR: cannot open ... port is held`: the editor/backend, `mpremote` or Thonny has the port.
  Disconnect in the editor first.

## 2. Install or update the runtime

Only when the version is wrong or the board has no runtime. This takes about a minute, stops the
running flow, and resets the board. It needs `mpremote`.

```sh
python3 test-flows/device_cli.py runtime install --port /dev/ttyACM0
python3 test-flows/device_cli.py runtime install --no-reset   # native-USB board: hard reset drops it off the bus
```

`--wipe` erases the board's filesystem. Do not use it unless the user asked.

## 3. Deploy a flow

```sh
python3 test-flows/device_cli.py flow deploy path/to/flow.flow.json \
  --mpy-cross "$THINGSTUDIO_MPY_CROSS"
```

The flow must be a `FlowFile` (`.flow.json`); the CLI compiles it with the editor's own headless
compiler, so a compile error is reported before anything reaches the board.

- `--mpy-cross` (or `THINGSTUDIO_MPY_CROSS`, or `mpy-cross` on `PATH`). A native build is needed;
  `device-runtime/test/README.md` has the recipe.
- The flow name comes from the flow file's own `flowName`; pass `--flow-name` only to override it.
  This matters: `runtime.settings` is namespaced by it, and a deploy without a name stores values
  under `""`, which the editor never uses.
- `--trigger NODE_ID` (repeatable) fires inject/startup nodes 2s apart after `DEPLOY_ACK`. Use this
  instead of clicking, for flows whose inject is manual.
- Default is: deploy, fire any `--trigger`s, collect output for `--timeout` (6s), exit. Add
  `--watch` to keep streaming until Ctrl-C.
- `--json` emits one JSON object per line (`kind`: `status`, `console`, or `message`), for parsing.

A DEPLOY replaces the board's saved flow. Only one flow runs at a time.

## 4. Drive and inspect a running flow

```sh
python3 test-flows/device_cli.py trigger setread00001
python3 test-flows/device_cli.py exec "settings.namespaces()"
python3 test-flows/device_cli.py watch --timeout 5
python3 test-flows/device_cli.py restart          # soft; --hard drops native-USB boards
python3 test-flows/device_cli.py stop             # stop listener, leave the MicroPython prompt
```

`exec` runs code in the listener's globals, which include `settings` (the persistent store), so
`settings.get/keys/namespaces/clear/clear_all/prune` work without importing anything. Output is
console text, not a protocol message; the CLI waits `--timeout` (2s default) for it.

Supported consoles are the same `EXEC` channel the editor's command box uses — bounded, quick
commands only, not long loops.

## 5. Testing discipline

- Capture what the flow is expected to print before triggering it; one trigger per inject, and wait
  for the debug line rather than firing everything at once.
- `NODE_ERROR` is reported with the node id and appears in both console and `--json` output. Treat it
  as a failure even if the flow keeps running.
- After a deploy, `hello` confirms `currentFlowName` and `safeMode`. If `safeMode` is true, the flow
  failed to boot (often a missing library); inspect with `watch`, then fix it.
- Leave the board in the state the user expects: usually the tested flow deployed and any test
  values cleared (`exec "settings.clear_all()"`).

## Reference

- `test-flows/README.md` — the flows and their expected output, including the settings tests.
- `docs/user-guide/command-line.md` — user-facing command line.
- `docs/user-guide/debugging.md` — console commands and settings recovery.
- `docs/working-notes/device-settings-store-scoping.md` — how the settings store is meant to behave.
