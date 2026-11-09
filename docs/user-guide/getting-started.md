# Getting started

Want a look first? [Try the editor in your browser](https://demo.thingstudio.net/) before you install anything.
The demo doesn't connect to a board, but you can build a flow and read the MicroPython it makes.

From a new board to a blinking LED, in six steps:

1. **[Install ThingStudio](#step-1-install-thingstudio)** on your computer.
2. **[Tour the editor](editor-tour.md)**: what each part of the screen does.
3. **[Install MicroPython](installing-micropython.md)** on your board. A standard ESP32 takes the advised
   [custom image](custom-firmware.md).
4. **[Connect your board](connecting.md)** to ThingStudio.
5. **[Install the runtime](installing-runtime.md)**, the part of ThingStudio that runs on the board.
6. **[Blink an LED](first-flow.md)**: build your first flow and deploy it. Or open `tutorials/blink.flow.json`
   (the [tutorials folder](tutorial-flows.md#where-the-folder-is)) with **File → Open…**, point the pin at your
   board's own LED, and deploy.

When something doesn't work, [Debugging](debugging.md) and the [FAQ](faq.md) go by what you see on screen.

You need a board with one of the processors in [Supported hardware](supported-hardware.md), and a USB cable that
carries data, not only power. Installing uses a terminal, or PowerShell on Windows.

## Step 1: Install ThingStudio

ThingStudio is a program you run on your computer. It opens its editor in your web browser. It brings its own
Python, so nothing else needs installing to run it.

There are two ways to install it. Both give you the same program.

- **[Download a package](#download-a-package)** and unpack it. Nothing runs until you start it.
- **[Run the installer script](#run-the-installer-script).** It picks the right package, checks its checksum, and
  adds a `thingstudio` command. Run it again to upgrade.

### Download a package

Download the package for your computer from the
[releases page](https://github.com/mkarliner/ThingStudio/releases/latest).
[Installation details](installation-details.md#packages) lists the package for each platform.

**macOS and Linux:** unpack it with `tar -xzf thingstudio-VERSION-PLATFORM.tar.gz`. ThingStudio is the
`thingstudio` file in the unpacked folder.

**Windows:** unzip it anywhere, for example into your Documents folder. ThingStudio is `thingstudio.cmd` in the
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

To upgrade or remove ThingStudio, or build it from source, see
[Installation details](installation-details.md).

## Start ThingStudio

How you start ThingStudio depends on how you installed it:

- **Installer script:** run `thingstudio` in a terminal. If the command isn't found, see
  [If the command isn't found](#if-the-command-isnt-found).
- **Package on macOS or Linux:** run `./thingstudio` in the unpacked folder.
- **Package on Windows:** run `thingstudio.cmd` in the unzipped folder.

The editor opens in your browser at `http://127.0.0.1:8765/`. Leave the terminal open while you work. Press Ctrl-C
there to stop ThingStudio.

ThingStudio also serves this user guide, so it works offline. **Help → User guide** opens it.

### Where it is installed

- **Installer script, macOS and Linux:** the program is in `~/.local/share/thingstudio`, and the `thingstudio`
  command is `~/.local/bin/thingstudio`.
- **Installer script, Windows:** `%LOCALAPPDATA%\Thingstudio`. The `thingstudio` command is in its `bin` folder.
- **Package:** the folder you unpacked it into.

To see which copy your terminal runs, use `command -v thingstudio` in a macOS or Linux shell, or
`Get-Command thingstudio` in PowerShell.

### If the command isn't found

The shell looks for commands in the folders listed in your PATH, and remembers what it found. After an install it can
be out of date in two ways.

**The command's folder isn't on your PATH.** To check, run `echo "$PATH"` and look for `.local/bin`. When it's missing,
the installer prints the line that adds it to your shell's startup file; it prints nothing when the folder is already
on your PATH. Run that line, or add the line `export PATH="$HOME/.local/bin:$PATH"` to the startup file yourself. Then
make the current terminal read the file, or open a new terminal:

| Shell | Run |
| --- | --- |
| zsh (macOS default) | `source ~/.zshrc` |
| bash on Linux | `source ~/.bashrc` |
| bash on macOS | `source ~/.bash_profile` |
| PowerShell | Open a new window. |

**The folder is on your PATH, but the shell hasn't noticed the new command.** In zsh, run `rehash`. In bash, run
`hash -r`.

On Windows, the installer adds the command to the PowerShell window that ran it and to your saved PATH. A PowerShell
window that was already open doesn't see it. Open a new window, or run this in the old one:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
```

If the command still isn't found, start ThingStudio by its full path, from the list above.

### Remove ThingStudio

[Installation details](installation-details.md#remove) has the commands for the installer script. To remove a package,
delete its folder. Removing never touches your flows or your settings in `.thingstudio`.

## Getting help

When something goes wrong, [Debugging & troubleshooting](debugging.md) and the [FAQ](faq.md) go by what you see on
screen. Questions, and what you've built, go in
[GitHub Discussions](https://github.com/mkarliner/ThingStudio/discussions). Bugs go on the
[issue tracker](https://github.com/mkarliner/ThingStudio/issues), or use **Help → Report a problem**.

## Next

Step 2: [tour the editor](editor-tour.md).
