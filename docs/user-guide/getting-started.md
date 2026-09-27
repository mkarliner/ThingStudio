# Getting started

Thingstudio is a program you run on your computer. It opens its editor in your web browser. You build a flow there and deploy it to a board over USB.

You need a supported board with [MicroPython installed](installing-micropython.md), and a USB cable that carries data, not just power.

## Install

Thingstudio comes with everything it needs, including its own Python. Nothing else needs installing.

**macOS and Linux**

Run this in a terminal:

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
```

It installs Thingstudio into `~/.local/share/thingstudio` and adds the `thingstudio` command to `~/.local/bin`. If it says `~/.local/bin` isn't on your PATH, run the line it prints, then open a new terminal.

On Linux, your account must be in the `dialout` group (`uucp` on Arch) to use USB boards. The installer tells you if it isn't, and gives the command to fix it.

To upgrade, run the same command again. To remove Thingstudio:

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh -s -- --uninstall
```

Your flows and settings live in `~/.thingstudio`. Upgrading and removing never touch them.

**Windows**

1. Download `thingstudio-…-windows-x86_64.zip` from the [releases page](https://github.com/mkarliner/ThingStudio/releases/latest).
2. Unzip it anywhere, for example into your Documents folder.
3. In the unzipped folder, run `thingstudio.cmd`. If Windows asks whether to run it, choose **Run**.

**From source**

For working on Thingstudio itself. You need Python 3.10 or later, Node.js 22.12 or later, and `make`. On a Mac, `make` comes with the Xcode command line tools (`xcode-select --install`).

In the repository folder, run `make`. This builds the editor and these docs, installs Thingstudio into a `.venv` folder, and puts the `thingstudio-backend` command on your PATH. Run `make` again after updating the repository. It only rebuilds what changed. If your `python3` is older than 3.10, name a newer one: `make PYTHON=python3.12`.

## Start

```sh
thingstudio
```

On Windows, run `thingstudio.cmd`. From source, the command is `thingstudio-backend`, or `make run`. On a Mac, start it from Apple's **Terminal** app: macOS blocks WiFi connections from a copy run from source in other terminals, such as iTerm.

If your terminal says the command isn't found just after installing, open a new terminal.

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work; press Ctrl-C there to stop Thingstudio. Add `--no-browser` if you'd rather open the page yourself. If you restart Thingstudio with the editor still open, that tab reconnects and no new one opens.

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
