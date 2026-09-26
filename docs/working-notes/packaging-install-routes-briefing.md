# Briefing: packaging and install routes (MVP item 7)

Status: brief, 2026-09-26; decisions taken the same day (below). Scope is fixed by `mvp-kickoff-brief.md` and
road-to-MVP §1; this says what exists, what the package must contain, the approach, and Mike's decisions.
mDNS advertising and remote connection are deferred to post-MVP / posture-2 auth.

## Goal

A newcomer on a fresh Mac, Windows or Linux machine installs Thingstudio with one obvious step, with nothing to
install first (no Python, Node or git), and reaches a blinking LED in 15 minutes using only the app and its docs.

Fixed (kickoff brief, don't reopen): headless backend + editor in the browser, no Electron. Routes: `curl | sh` and
Homebrew (macOS/Linux), a PowerShell one-liner and winget or scoop (Windows), a zip per OS. Every route bundles the
backend's language runtime.

## Where things stand

- Today's only install is a dev checkout: `make` builds the editor (Node) and docs (mkdocs), makes a `.venv`
  (Python 3.10+), and links `thingstudio-backend` onto PATH.
- The backend already takes its assets by injection, with dev-checkout defaults:
  - `--static-dir` for the built editor (default `editor/dist`)
  - `--docs-dir` for the built docs (default `site/`)
  - `RuntimeInstaller(runtime_src_dir)` for the device runtime (default `device-runtime/src` +
    `device-runtime/runtime_manifest.py`); no CLI flag yet
  - `builtin_reference.py` copies processor/board definitions from `editor/src/definitions` into
    `~/.thingstudio`; no flag yet
- The editor needs nothing at runtime beyond its build: mpy-cross is WASM inside `editor/dist`, so compiling the
  runtime to `.mpy` for Install runtime already works in a packaged install.
- Staleness checks (`editor_site.py`, `docs_site.py`) already stay quiet when no sources are present, as in a
  packaged install.
- Python deps: `aiohttp` (C extensions, so per-platform wheels) and `pyserial` (pure Python).
- Known platform traps, both found on real hardware:
  - **macOS 15 Local Network privacy** blocked the backend's outgoing connections to the board (WiFi transport,
    discovery) when run from iTerm with a framework-build Python; Apple's Terminal is exempt
    (`learnings/backend-security-research.md`). A signed, notarized binary with `NSLocalNetworkUsageDescription`
    gets a normal permission prompt.
  - **Linux serial permissions:** the user must be in `dialout` (Debian/Ubuntu) or `uucp` (Arch) to open a port.

## What the package contains

| Part | From | Notes |
| --- | --- | --- |
| Python runtime | python-build-standalone (Astral) | relocatable CPython per OS/arch |
| backend + deps | `backend/` + wheels | aiohttp wheels per platform |
| editor | `editor/dist` | built once in CI |
| docs | `site/` | built once in CI |
| device runtime | `device-runtime/src`, `runtime_manifest.py` | incl. `vendor/` |
| definitions | `editor/src/definitions` | copied to `~/.thingstudio` on start |
| launcher | new | `thingstudio` command |

User data stays in `~/.thingstudio`, outside the install, so upgrades and uninstalls never touch it.

## Proposed approach

1. **Assets inside the Python package.** A build step copies editor, docs, device runtime and definitions into
   `thingstudio_backend/_assets/`, and each default looks there first, then at the repo paths. No flags needed in
   a package; the dev checkout keeps working unchanged.
2. **One relocatable folder per platform**, built in GitHub Actions: python-build-standalone's `install_only`
   CPython + `pip install` of the backend into it + `_assets`. Targets: macOS arm64 and x86_64, Windows x86_64,
   Linux x86_64 and aarch64 (Raspberry Pi 4/5 as the host is plausible for makers). The zip route is this folder.
   Chosen over PyInstaller because it is plain CPython (no freezing quirks, same behaviour as the dev checkout),
   and over a pip/uv install because it needs nothing on the machine and no network at first run.
3. **`curl | sh` and the PowerShell one-liner** download the right zip, unpack it to a per-user location
   (`~/.local/share/thingstudio`, `%LOCALAPPDATA%\Thingstudio`), put `thingstudio` on PATH, and print the next
   step. Rerunning upgrades. `curl` doesn't quarantine files, so macOS Gatekeeper isn't involved on this route.
4. **Package managers point at the same zips:** a Homebrew tap formula that installs the prebuilt macOS/Linux
   folder (not Homebrew's Python, which is a framework build and hits the Local Network trap), a scoop bucket, and
   a winget manifest.
5. **Signing.** macOS: sign and notarize the bundled `python3` with `NSLocalNetworkUsageDescription` embedded, so
   the Local Network prompt appears from any terminal. Windows: unsigned for MVP (decision 2). A
   browser-downloaded zip needs this most, because it is quarantined.
6. **First-run checks with clear messages:** Linux not in `dialout`/`uucp` (say the exact command), port 8765 in
   use (already legible), macOS Local Network denied (already explained by `tcp_relay`).
7. **Docs:** one install page with a tab per OS, update and uninstall, and troubleshooting for the traps above.
8. **Acceptance:** fresh VMs for each OS, each route, then the 15-minute first-blink test with a newcomer.

## Decisions (Mike, 2026-09-26)

1. **Release hosting:** the licence is permissive, so `mkarliner/ThingStudio` goes public and GitHub Releases on
   it host the zips. No separate releases repo.
2. **Signing:** pay for Apple Developer ID now; sign and notarize the macOS build. Windows ships unsigned for MVP,
   with the SmartScreen "More info → Run anyway" step documented.
3. **Start/stop:** CLI model only for MVP (`thingstudio`, Ctrl-C to stop). No double-click app.
4. **Targets:** macOS arm64 + x86_64, Windows x86_64, Linux x86_64 + aarch64 (Raspberry Pi as host). Windows on
   ARM out.
5. **Command name:** `thingstudio`, with `thingstudio-backend` kept as an alias.
6. **Update notices:** post-MVP.
7. **New: run-as-a-service recipes** (launchd, systemd at least). Moves "autostart at login" out of Out of scope.
8. **New: the backend advertises itself over mDNS**, so a backend on another machine is easy to find.
   **Deferred** to post-MVP or posture-2 auth, whichever first (below). MVP documents the SSH-tunnel route.

## Service recipes (decision 7)

Documentation plus a helper, not an installer that registers services silently:

- **macOS:** a per-user LaunchAgent (`~/Library/LaunchAgents/org.thingstudio.backend.plist`), `RunAtLoad` and
  `KeepAlive`, logs to `~/.thingstudio/logs/`. Start/stop with `launchctl bootstrap`/`bootout gui/$UID`.
- **Linux:** a systemd user unit (`~/.config/systemd/user/thingstudio.service`, `systemctl --user enable --now`);
  `loginctl enable-linger` for a headless Pi that should start at boot with nobody logged in. A system unit
  (`User=` a dedicated account in `dialout`) documented as the alternative.
- **Windows:** not asked for; a Task Scheduler "at log on" recipe is cheap to document if wanted.
- **Helper:** `thingstudio service install|uninstall|status` writes and loads the file above using the bundled
  interpreter's absolute path, so it survives the user's PATH. Recipes in the docs show the same file by hand.

Things to check on real machines, not assume:

- **macOS Local Network privacy under launchd.** The prompt is tied to the responsible process; a LaunchAgent has
  no terminal to inherit an exemption from. The signed binary with `NSLocalNetworkUsageDescription` should get
  the normal prompt, but whether that prompt appears for a background agent (and how to re-trigger it after a
  denial) has to be tested. Failure must stay legible: `tcp_relay` already names the macOS cause in its error.
- **Serial port hand-off.** A service holds no port until the editor connects, so it doesn't block other tools.
  Confirm the port is released on editor disconnect, not only on backend exit.
- **Upgrades.** Rerunning the installer while the service runs: the unit points at a stable path, and the
  installer restarts the service if one is loaded.

## mDNS advertising (decision 8) — deferred, needs posture-2 auth

What it would be: the backend registers `_thingstudio._tcp` (and `_http._tcp` for generic browsers) with its port,
version and hostname in TXT records. Library: `python-zeroconf` (pure Python, LGPL-2.1; add to
`third-party-licenses.md`). Advertising uses multicast, so on macOS it is covered by the same Local Network
permission as the board connections.

**The blocker:** `__main__.py` refuses to bind anything but loopback until posture-2 auth exists
(`outstanding-items/posture-2-auth.md`, P3). A loopback-only backend is unreachable from another machine, so
advertising it is useless. The Host allowlist (posture 1) would also need the machine's `.local` name added.
`cors.py`'s reflect-any-Origin default is flagged in its own header as needing revisiting at the same point.

Also worth knowing: once the backend listens on the LAN, `http://<machine>.local:8765` already works through the
OS's own responder (Bonjour on macOS, Avahi on most Linux, including Raspberry Pi OS). The service record adds
*discovery* (listing backends you don't know the name of), not *reachability*. Browsers can't browse mDNS
services themselves, so discovery needs a consumer: a `thingstudio find` command, or the editor listing other
backends it can see.

**Mike, 2026-09-26: defer remote connection until post-MVP (or real auth).** MVP keeps the loopback-only bind.
The install docs cover a remote backend by SSH tunnel (`ssh -L 8765:localhost:8765 <host>`), which works today.
mDNS lands with or after posture-2; `outstanding-items/posture-2-auth.md` carries the pointer.

## Order of work

1. Assets inside the Python package (small, lands alone).
2. A relocatable folder per platform in CI; a zip that works on Mike's Mac.
3. Fresh Linux VM, then `curl | sh`, then Windows and the PowerShell one-liner.
4. `thingstudio` command name + alias, first-run checks.
5. Service recipes and `thingstudio service` helper.
6. Homebrew tap, scoop bucket, winget manifest; Apple signing and notarization once the Developer ID is active.
7. Install docs, then fresh-VM acceptance and the newcomer test.

## Out of scope

mDNS advertising and non-loopback binds (deferred, above), a frozen single-file binary, Linux distro packages
(.deb/.rpm), editor-side update installs, a double-click app, and flashing MicroPython itself
(documentation only, per the kickoff brief).
