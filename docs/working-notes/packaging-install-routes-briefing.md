# Briefing: packaging and install routes (MVP item 7)

Status: brief, 2026-09-26. Scope is fixed by `mvp-kickoff-brief.md` and road-to-MVP §1; this says what exists,
what the package must contain, a proposed approach, and the decisions Mike needs to make before building.

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
   the Local Network prompt appears from any terminal. Windows: sign the launcher so SmartScreen doesn't warn. A
   browser-downloaded zip needs this most, because it is quarantined.
6. **First-run checks with clear messages:** Linux not in `dialout`/`uucp` (say the exact command), port 8765 in
   use (already legible), macOS Local Network denied (already explained by `tcp_relay`).
7. **Docs:** one install page with a tab per OS, update and uninstall, and troubleshooting for the traps above.
8. **Acceptance:** fresh VMs for each OS, each route, then the 15-minute first-blink test with a newcomer.

Suggested order: 1 and 2 (a zip that works on Mike's Mac), then a fresh Linux VM, then 3, then Windows, then 4-5.
Item 1 is small and can land first on its own.

## Decisions for Mike

1. **Release hosting.** `mkarliner/ThingStudio` is private, so GitHub Releases there can't be downloaded publicly.
   A public repo, or a separate public releases repo?
2. **Signing costs.** Apple Developer ID ($99/year) for notarization; a Windows code-signing option (a certificate,
   or Azure Trusted Signing). Pay now, or ship the MVP unsigned and rely on the `curl | sh` route plus documented
   workarounds?
3. **How people start and stop it.** The CLI model (run `thingstudio`, Ctrl-C to stop), like Node-RED, or also a
   double-clickable app? A double-click app with no terminal needs a way to quit (for example a Quit button in the
   editor) and on macOS an `.app` bundle.
4. **Targets for MVP.** Is Linux aarch64 (Raspberry Pi as the host) in, and Windows on ARM out?
5. **Command name.** `thingstudio` for users, keeping `thingstudio-backend` as an alias?
6. **Update notices.** Should the editor say when a newer release exists? Post-MVP is fine.

## Out of scope

Autostart at login, a frozen single-file binary, Linux distro packages (.deb/.rpm), editor-side update installs,
and flashing MicroPython itself (documentation only, per the kickoff brief).
