# Getting started

Thingstudio is a program you run on your computer. It opens its editor in your web browser. You build a flow there and deploy it to a board over USB.

You need a supported board with [MicroPython installed](installing-micropython.md), and a USB cable that carries data, not just power.

## Install

Packaged installers aren't available yet. For now, install from a copy of the repository. You need Python 3.10 or later, and Node.js to build the editor.

```sh
pip install -e backend
cd editor && npm ci && npm run build && cd ..
pip install mkdocs==1.6.1 mkdocs-material==9.7.7 && mkdocs build
```

Run the last two lines again after updating the repository.

## Start

```sh
thingstudio-backend
```

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work; press Ctrl-C there to stop Thingstudio. Add `--no-browser` if you'd rather open the page yourself.

These docs are served locally too, so they work without an internet connection. The **Docs** button opens them.

## Connect a board

1. Plug the board in.
2. Click **⟳ ports** and pick the board's port.
3. Click **Connect**.

Port names depend on your operating system and the board's USB chip, so there's no fixed name to look for. If you're not sure which is the board, unplug it, click **⟳ ports**, plug it back in and click again. The one that appears is your board.

The board replies with its chip type, runtime version and free memory. The console shows this.

A board that's new to Thingstudio doesn't have its runtime yet. The console says so and suggests the next step.

## Install the runtime

The runtime is the part of Thingstudio that runs on the board. It's a one-time step for each board.

1. With the board's port selected, click **Install runtime…**. It takes about half a minute and shows each file as it goes.
2. The board restarts when it's done. Click **Connect** again.

If something goes wrong, the console says what the board sent back and what to do. See [Board won't connect](debugging.md#board-wont-connect).

## Next

Build your first flow: [Canvas basics](canvas-basics.md).
