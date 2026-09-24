# Getting started

Thingstudio is a program you run on your computer. It opens its editor in your web browser. You build a flow there and deploy it to a board over USB.

You need a supported board with [MicroPython installed](installing-micropython.md), and a USB cable that carries data, not just power.

## Install

Packaged installers aren't available yet. For now, install from a copy of the repository. You need Python 3.10 or later, Node.js 22.12 or later, and `make`. On a Mac, `make` comes with the Xcode command line tools (`xcode-select --install`).

In the repository folder, run:

```sh
make
```

This builds the editor and these docs, and installs Thingstudio into a `.venv` folder. It also puts the `thingstudio-backend` command on your PATH. Run `make` again after updating the repository. It only rebuilds what changed.

If your `python3` is older than 3.10, name a newer one: `make PYTHON=python3.12`.

## Start

```sh
thingstudio-backend
```

If your terminal says the command isn't found just after the first `make`, run `hash -r` or open a new terminal. If `make` said it couldn't put the command on your PATH, use `make run` instead.

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work; press Ctrl-C there to stop Thingstudio. Add `--no-browser` if you'd rather open the page yourself.

These docs are served locally too, so they work without an internet connection. The **Docs** button opens them.

## Connect a board

1. Plug the board in.
2. Check the port list. When the editor opens it looks for boards, and picks yours if it's the only one plugged in. If you plugged it in afterwards, click **⟳ ports**.
3. Click **Connect**.

With more than one board plugged in, pick yours from the list. Port names depend on your operating system and the board's USB chip, so there's no fixed name to look for. If you're not sure which is yours, unplug it, click **⟳ ports**, plug it back in and click again. The one that appears is your board.

The board replies with its chip type, runtime version and free memory. The console shows this.

Once a board with WiFi is set up, you can also connect to it over WiFi. See [Connecting over WiFi](wifi-connection.md).

A board that's new to Thingstudio doesn't have its runtime yet. The console says so and suggests the next step.

## Install the runtime

The runtime is the part of Thingstudio that runs on the board. Each board needs it once.

There are two ways to install it. Use the editor unless you have a reason not to.

**From the editor**

1. With the board's port selected, click **Install runtime…**. It takes about half a minute and shows each file as it goes.
   If the board is busy and doesn't stop, the console asks you to press its reset button. A board without one, such as a Pico, can be unplugged and plugged back in instead.
2. The board restarts when it's done. Click **Connect** again.

If something goes wrong, the console says what the board sent back and what to do. See [Board won't connect](debugging.md#board-wont-connect).

**From the command line**

Useful for scripting, or setting up several boards at once. Click **Disconnect** in the editor first, so the port is free.

```sh
pip install mpremote
python3 test-flows/deploy_runtime.py --port PORT
```

`PORT` is the board's port, as shown in the editor's port list. When it finishes, click **Connect** in the editor.

## Next

Build your first flow: [Blink an LED](first-flow.md). [Canvas basics](canvas-basics.md) covers the editor in more detail.
