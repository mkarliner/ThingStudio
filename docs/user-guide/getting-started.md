# Getting started

From a new board to a blinking LED, in six steps:

1. **[Install Thingstudio](#step-1-install-thingstudio)** on your computer.
2. **[Tour the editor](editor-tour.md)**: what each part of the screen does.
3. **[Install MicroPython](installing-micropython.md)** on your board.
4. **[Connect your board](connecting.md)** to Thingstudio.
5. **[Install the runtime](installing-runtime.md)**, the part of Thingstudio that runs on the board.
6. **[Blink an LED](first-flow.md)**: build your first flow and deploy it.

You need a board that runs MicroPython, and a USB cable that carries data, not only power.
[Supported hardware](supported-hardware.md) lists the boards Thingstudio is tested on.

## Step 1: Install Thingstudio

Thingstudio is a program you run on your computer. It opens its editor in your web browser. It brings its own
Python, so nothing else needs installing to run it.

There are two ways to install it. Both give you the same program.

- **[Download a package](#download-a-package)** and unpack it. Nothing runs until you start it.
- **[Run the installer script](#run-the-installer-script).** It picks the right package, checks its checksum, and
  adds a `thingstudio` command. Run it again to upgrade.

### Download a package

Download the package for your computer from the
[releases page](https://github.com/mkarliner/ThingStudio/releases/latest).
[Installation details](installation-details.md#packages) lists the package for each platform.

**macOS and Linux:** unpack it with `tar -xzf thingstudio-VERSION-PLATFORM.tar.gz`. Thingstudio is the
`thingstudio` file in the unpacked folder.

**Windows:** unzip it anywhere, for example into your Documents folder. Thingstudio is `thingstudio.cmd` in the
unzipped folder. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. The Windows
package isn't signed.

### Run the installer script

The commands below download the installer script and pipe it straight into a shell. To read the script before
running it, download
[install.sh](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh) or
[install.ps1](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1) and open it in a text
editor.

**macOS and Linux:** run this in a terminal. On a Mac, that's the **Terminal** app, in Applications → Utilities.

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
```

If the installer says `~/.local/bin` isn't on your PATH, run the command it prints, then open a new terminal.

On Linux, your account must be in the `dialout` group (`uucp` on Arch) to use USB boards. The installer reports this
if your account isn't in the group, and prints the command to fix it.

**Windows:** open PowerShell from the Start menu and run this. It doesn't need administrator rights.

```powershell
irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1 | iex
```

To install a specific version, upgrade or remove Thingstudio, or build it from source, see
[Installation details](installation-details.md).

## Start Thingstudio

How you start Thingstudio depends on how you installed it:

- **Installer script:** run `thingstudio` in a terminal. If the command isn't found, open a new terminal and try
  again.
- **Package on macOS or Linux:** run `./thingstudio` in the unpacked folder.
- **Package on Windows:** run `thingstudio.cmd` in the unzipped folder.

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work. Press Ctrl-C
there to stop Thingstudio.

Thingstudio also serves this user guide, so it works offline. **Help → User guide** opens it.

## Next

Step 2: [tour the editor](editor-tour.md).
