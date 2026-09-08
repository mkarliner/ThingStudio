# Getting started

Thingstudio runs entirely in the browser — no separate install for the editor itself.

## Requirements

A backend running somewhere reachable — see "Connecting" below. It's needed for saving and opening flows and custom nodes, and for reaching a board. Any modern browser works with the editor itself.

## Running the editor

```sh
cd editor
npm install
npm run dev
```

Opens the editor locally. Build a flow from scratch, or open one of the examples in `test-flows/`.

## Bootstrapping a board

Before any flow can be deployed, a board needs the Thingstudio runtime on it — a one-time step per board, or after a full erase/reflash:

```sh
pip install mpremote
python3 test-flows/deploy_runtime.py --port /dev/tty.usbmodemXXXX
```

Reset the board afterward and watch its first boot to confirm the runtime is running: `LISTENER_BOOTING` → `LISTENER_READY` → a `HELLO` frame.

**Watch with a passive connection.** Use `mpremote connect <port>` with no further subcommand, or any serial monitor that doesn't send Ctrl-C on open. `mpremote repl` and Thonny's Shell both interrupt the board the moment they connect — that looks identical to "the board never boots," even when everything is fine.

## Connecting

Start the backend once per session, on whatever machine can reach your board:

```sh
cd backend
pip install -e .
thingstudio-backend
```

Point the editor at it with the **backend URL** field — it defaults to `ws://127.0.0.1:8765/ws`, matching the backend's own default, for when both are running on the same machine. If the backend is elsewhere (a firewalled machine near your devices, say), tunnel to it — `ssh -L 8765:localhost:8765 <host>` — and leave the field on its default; the backend still only ever binds to loopback on its own machine.

In the editor, click **⟳ ports** to see the serial ports the backend can reach, pick one, and click **Connect**. The editor then asks the board to identify itself — chip type, runtime version, free flash/RAM. If nothing comes back within a few seconds, you'll see a warning that version compatibility is unverified and Deploy will proceed without the check.

This is normal the first time you connect to a board that hasn't been reset since power-up — the listener is running, it just hasn't been asked to say hello yet. Click **Check status** to ask again without resetting or redeploying. If it's still silent after that, the board's listener may not actually be running; reset the board and try again.
