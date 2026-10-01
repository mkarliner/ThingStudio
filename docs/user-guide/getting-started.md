# Getting started

Five steps take you from a new board to a blinking LED. Each page ends with a link to the next one.

1. **[Install Thingstudio](#step-1-install-thingstudio)** on your computer. See below.
2. **[Install MicroPython](installing-micropython.md)** on your board.
3. **[Connect your board](connecting.md)** to Thingstudio.
4. **[Install the runtime](installing-runtime.md)**, the part of Thingstudio that runs on the board.
5. **[Blink an LED](first-flow.md)**: build your first flow and deploy it.

You need a [supported board](boards.md) and a USB cable that carries data, not just power.

## Step 1: Install Thingstudio

Thingstudio is a program you run on your computer. It opens its editor in your web browser. It comes with
everything it needs, including its own Python. Nothing else needs installing.

There are two ways to install it. Both give you the same program.

- **Download a package** from the [releases page](https://github.com/mkarliner/ThingStudio/releases/latest) and
  unpack it. Nothing runs until you start it. See [more on installing](installing-more.md#packages) for which
  package to pick.
- **Run the installer script.** It picks the right package, checks its checksum, and adds a `thingstudio`
  command. It's quicker, and makes upgrading easier.

If you'd rather read a script before running it, download
[install.sh](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh) or
[install.ps1](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1) and open it in a text
editor first. Or use a package.

### Download a package

**macOS and Linux:** unpack it with `tar -xzf thingstudio-VERSION-PLATFORM.tar.gz`. Thingstudio is the
`thingstudio` file in the unpacked folder. Run it from there as `./thingstudio`.

**Windows:** unzip it anywhere, for example into your Documents folder. Run `thingstudio.cmd` in the unzipped
folder. If it says "Windows protected your PC", click **More info**, then **Run anyway**. Thingstudio isn't signed
for Windows yet.

### Run the installer script

**macOS and Linux:** run this in a terminal. On a Mac, that's the **Terminal** app, in Applications → Utilities.

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
```

If it says `~/.local/bin` isn't on your PATH, run the line it prints, then open a new terminal.

On Linux, your account must be in the `dialout` group (`uucp` on Arch) to use USB boards. The installer tells you if
it isn't, and gives the command to fix it.

**Windows:** open PowerShell (search for it in the Start menu) and run:

```powershell
irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1 | iex
```

You don't need to be an administrator.

To upgrade or remove Thingstudio, or build it from source, see [more on installing](installing-more.md).

## Start Thingstudio

If you used the installer script, run this in a terminal:

```sh
thingstudio
```

If the command isn't found just after installing, open a new terminal and try again. If you downloaded a package,
run `./thingstudio` (or `thingstudio.cmd` on Windows) in its folder.

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work. Press Ctrl-C
there to stop Thingstudio.

These docs are served by Thingstudio too, so they work without an internet connection. **Help → User guide** opens
them.

## Next

Step 2: [install MicroPython](installing-micropython.md) on your board.
