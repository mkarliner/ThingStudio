# Installation details

How Thingstudio is packaged, where it puts its files, how to upgrade and remove it, and how to build it from source.
[Getting started](getting-started.md#step-1-install-thingstudio) has the quick version.

## Packages

Each [release](https://github.com/mkarliner/ThingStudio/releases/latest) has a package for each platform:

| Platform | Package |
| --- | --- |
| macOS, Apple Silicon (M1 and later) | `thingstudio-VERSION-macos-arm64.tar.gz` |
| macOS, Intel | `thingstudio-VERSION-macos-x86_64.tar.gz` |
| Linux, x86_64 | `thingstudio-VERSION-linux-x86_64.tar.gz` |
| Linux, ARM 64-bit (Raspberry Pi 4 and 5 on a 64-bit OS) | `thingstudio-VERSION-linux-aarch64.tar.gz` |
| Windows, x86_64 | `thingstudio-VERSION-windows-x86_64.zip` |

`SHA256SUMS` lists each package's checksum. The macOS packages are signed and notarized by Apple.


A package doesn't add a `thingstudio` command; start it from its folder, or by its full path. To upgrade, replace
the folder with a newer one. To remove it, delete the folder. On Linux, add your account to the `dialout` group
(`uucp` on Arch) yourself to use USB boards.

## Installer script

On macOS and Linux, the installer puts Thingstudio in `~/.local/share/thingstudio` and the `thingstudio` command in
`~/.local/bin`. Your settings live in `~/.thingstudio` (see [The Thingstudio folder](thingstudio-folder.md)).

On Windows, it puts Thingstudio in `%LOCALAPPDATA%\Thingstudio` and adds the `thingstudio` command to your PATH.
Your settings live in `%USERPROFILE%\.thingstudio`.

To upgrade, run the installer script again.

To remove Thingstudio on macOS and Linux:

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh -s -- --uninstall
```

On Windows:

```powershell
& ([scriptblock]::Create((irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1))) -Uninstall
```

Upgrading and removing never touch `~/.thingstudio`, or your flows, which are saved wherever you chose.

## From source

For working on Thingstudio itself. You need Python 3.10 or later, Node.js 22.12 or later, and `make`. On a Mac,
`make` comes with the Xcode command line tools (`xcode-select --install`).

In the repository folder, run `make`. This builds the editor and these docs, installs Thingstudio into a `.venv`
folder, and puts the `thingstudio-backend` command on your PATH. Run `make` again after updating the repository. It
only rebuilds what changed. If your `python3` is older than 3.10, name a newer one: `make PYTHON=python3.12`.

Start it with `thingstudio-backend`, or `make run`. On a Mac, start it from Apple's **Terminal** app: macOS blocks
WiFi connections from a copy run from source in other terminals, such as iTerm.
