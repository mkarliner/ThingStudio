# Getting started

Thingstudio runs entirely in the browser — no separate install for the editor itself.

## Requirements

Any modern browser works with the **Via backend** connection mode (see below). **Direct (WebSerial)** mode needs Chrome or Edge — WebSerial isn't available in Safari, and only in recent Firefox.

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

The toolbar has a mode picker: **Via backend** or **Direct (WebSerial)**. This chooses how the editor reaches your board, and it's a real choice you make each time, not something the editor guesses for you.

**Via backend** (the default) talks to a small local backend process instead of the browser talking to the board directly. Start it once per session:

```sh
cd backend
pip install -e .
thingstudio-backend
```

Then in the editor, click **⟳ ports** to see the serial ports the backend can reach, pick one, and click **Connect**.

**Direct (WebSerial)** needs no backend at all — the browser talks straight to the board. Click **Connect** and pick the board's port from the browser's own picker. Useful for a quick session, or if the backend isn't running.

Either way, the editor then asks the board to identify itself — chip type, runtime version, free flash/RAM. If nothing comes back within a few seconds, you'll see a warning that version compatibility is unverified and Deploy will proceed without the check.

This is normal the first time you connect to a board that hasn't been reset since power-up — the listener is running, it just hasn't been asked to say hello yet. Click **Check status** to ask again without resetting or redeploying. If it's still silent after that, the board's listener may not actually be running; reset the board and try again.
