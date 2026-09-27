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
   `thingstudio_backend/_assets/`; no flags needed in a package, and the dev checkout keeps working unchanged.
   **Built 2026-09-26**, with one change from this sketch: the layout is chosen once, not per asset (below).
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

1. ~~Assets inside the Python package (small, lands alone).~~ Done 2026-09-26 (below).
2. ~~A relocatable folder per platform in CI~~ Built 2026-09-26, not yet run on GitHub (below). Next: a first
   workflow run, then try the macOS arm64 archive on Mike's Mac.
3. ~~`curl | sh`~~ Built 2026-09-26 (below). Still to do: a fresh Linux VM check, then Windows and the
   PowerShell one-liner. Until then Windows is the zip route, documented in `getting-started.md`.
4. `thingstudio` command name + alias, first-run checks.
5. Service recipes and `thingstudio service` helper.
6. Homebrew tap, scoop bucket, winget manifest. ~~Apple signing and notarization~~ written 2026-09-27, first CI
   run and the iTerm Local Network test on Mike's Mac pending (below).
7. Install docs, then fresh-VM acceptance and the newcomer test.

## Step 1 as built (2026-09-26)

- `assets.py` picks one layout for all four asset kinds. **Dev checkout wins**: if the repo's
  `backend/pyproject.toml` and `device-runtime/` are where they should be, repo paths are used even when
  `_assets/` exists. Otherwise `_assets/`. Not "`_assets/` first, then repo" as sketched: after a local
  `make assets`, that order would serve the stale `_assets/editor` over a rebuilt `editor/dist` with no warning.
- `tools/build_assets.py` (stdlib only; `make assets` builds first, then runs it) fills `_assets/`. It refuses an
  unbuilt or stale editor/docs build, a manifest naming a missing runtime file, or no git SHA, each with the fix.
  `--allow-stale`/`--allow-no-sha` override. Builds into `_assets.tmp/` and swaps, so a failure leaves no half copy.
- Runtime build SHA: the build writes `_assets/device-runtime/runtime_build_sha.txt`; `runtime_build_sha()` reads
  it before trying git, so boards installed from a package still report `runtimeBuild`.
- `pyproject.toml` ships `_assets/**/*` as package data. `.gitignore` covers `_assets/`, `_assets.tmp/` and
  `backend/build/` (setuptools' in-tree build folder, which can carry files since deleted from `_assets/` into
  the next wheel; `make clean` removes it, and CI builds from a fresh checkout).
- A packaged install missing its assets logs one `NODE_ERROR` at startup naming each missing part, and the
  editor/docs "not built" pages say "Reinstall Thingstudio" instead of giving build commands.
- Verified in a cloud workspace: backend suite 268 passed (12 new in `test_assets.py`); a wheel built from the real
  repo (130 asset files) installed into a clean venv, run from outside the repo, served `/`, `/docs/`,
  `/api/runtime-sources` and `/api/definitions`, seeded definitions into a fresh data dir, and stamped the
  runtime SHA. With `_assets/` removed, the startup error and page read as intended.

## Step 2 as built (2026-09-26)

- `tools/make_bundle.py` (stdlib, Python 3.10+) builds `thingstudio-<version>-<platform>/`: python-build-standalone
  CPython 3.12.14 (release `20260901`, `install_only_stripped`), the backend installed into it, a launcher,
  `README.txt`, `LICENSE`, `BUILD.txt`. Archived as `.tar.gz` on macOS/Linux (keeps symlinks and the executable
  bit), `.zip` on Windows. Must run on the target platform, so pip picks matching compiled wheels.
- Fails, with the fix, on: a Python archive whose SHA-256 doesn't match `packaging/python-build-standalone.sha256`;
  `_assets/` not filled; a dependency with no wheel (`--only-binary=:all:`, no compiling on the CI machine); a
  Linux wheel needing glibc newer than 2.28. Dependency versions pinned in `packaging/constraints.txt`, so two
  builds of one tag ship the same code.
- Launchers (`packaging/launcher/`): `thingstudio` (sh; follows symlinks, so the installer can link it onto
  PATH) and `thingstudio.cmd`. Both run `python -I -m thingstudio_backend`; `-I` keeps the user's
  `PYTHONPATH`/`PYTHONHOME` and user site-packages out. pip's own `thingstudio-backend` script is deleted from the
  bundle: it hard-codes the build machine's path. `.gitattributes` pins their line endings. Known wart:
  Ctrl-C in `thingstudio.cmd` asks "Terminate batch job (Y/N)?"; a signed `.exe` launcher can replace it later.
- `tools/smoke_test_bundle.py` unpacks the archive into a new folder whose path has a space, starts it, and checks
  `/api/alive`, `/`, `/docs/`, `/api/runtime-sources`, `/api/definitions`, definitions seeded, "packaged layout"
  and no `NODE_ERROR` in the log, and the runtime build stamp. On macOS/Linux it repeats all of it through a symlink.
- `.github/workflows/release.yml`: on a `v*` tag (must equal `backend/pyproject.toml`'s version) or "Run workflow".
  One job builds the editor, docs and `_assets/`; five jobs bundle and smoke-test on their own runner
  (`macos-15`, `macos-15-intel`, `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`); on a tag, a last job makes
  a **draft** GitHub Release with the archives and `SHA256SUMS`. Publishing the draft is manual.
- Verified here: linux-x86_64 built from the real repo (42 MB) and passed the full smoke test; tampered Python
  archive refused; glibc check rejects a 2.34-only wheel. Linux bundle needs glibc 2.17+ (every compiled wheel is
  multi-tagged). The other four platforms are untested until the workflow runs.
- Runner caveats: `macos-15-intel` is GitHub's last Intel macOS image, so macOS x86_64 builds have a shelf life;
  `ubuntu-24.04-arm` is free for public repos.

## Step 3 as built (2026-09-26): `curl | sh`

- `packaging/install.sh` (POSIX sh, shellcheck-clean). Install URL:
  `https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh`. The release job attaches the
  script to every release, so the URL is stable and the script always matches the archives beside it. Not
  served from `main`, which would change installer behaviour with every commit.
- Finds the latest tag from the `/releases/latest` redirect (no API call, no JSON). Picks the platform from
  `uname`, with the Rosetta check on macOS. Downloads the archive and `SHA256SUMS`; refuses a mismatch.
- Layout: `~/.local/share/thingstudio/versions/<name>/`, a `current` link switched in one rename (`mv -T` GNU,
  `mv -h` BSD; a plain `mv` would move the new link inside the old folder), and `~/.local/bin/thingstudio`
  linking to `current/thingstudio`. Keeps the version it replaced (a running copy isn't pulled out from under
  itself), deletes older ones. Won't replace a `thingstudio` in the bin folder that isn't a link.
- After installing: runs `thingstudio --help` to prove it starts; prints the PATH line for the user's shell if
  needed; on Linux, the exact `usermod` command if the user isn't in `dialout`/`uucp`.
- `--uninstall` removes the program and link, never `~/.thingstudio`.
- Tested here (Linux, dash): fresh install, two upgrades (older version pruned), reinstall, running the installed
  command from PATH, corrupted archive refused with the existing install untouched, unknown version, uninstall.
  The workflow patch runs the same install/reinstall/uninstall on every macOS and Linux runner, which covers BSD
  `mv -h`; not yet run.
- Workflow patch also pins `ubuntu-latest` to `ubuntu-24.04` (GitHub moves `ubuntu-latest` to 26.04 on
  2026-10-19) and shellchecks the scripts.
- User docs: `getting-started.md` Install/Start rewritten: `curl | sh`, Windows zip, "from source" kept.

## Step 6 as built (2026-09-27): macOS signing, notarization, Local Network

- **Finding:** signing alone doesn't fix Local Network. macOS attributes the access to the executable and only
  prompts for one declaring `NSLocalNetworkUsageDescription` in an embedded `__TEXT,__info_plist` section;
  otherwise it denies silently. The section is added at link time, so it can't go on python-build-standalone's
  `python3`. Same fix in tmux, and asked for in several CLI projects' issues (pi, claude-code, cmux).
- `packaging/macos/thingstudio-python.c` is CPython's own main (`Py_BytesMain`), linked by `make_bundle.py`
  against the bundle's `libpython3.12.dylib` (install name `@rpath/...`, rpath `@executable_path/../lib`) with
  `Info.plist` embedded, identifier `org.thingstudio.backend`. The launcher runs it when present. Prefix
  resolution checked on Linux with the same construction: relocatable, `sys.prefix` right, pip works.
- Every Mach-O is signed, libraries first (hardened runtime only with a Developer ID: ad hoc + hardened fails
  library validation, "different Team IDs", found on Mike's Mac 2026-09-27); executables get
  `packaging/macos/entitlements.plist`, deliberately empty until a smoke test proves an exception is needed.
  With `--sign`/`$MACOS_SIGN_IDENTITY` it's the Developer ID release signature (with a secure timestamp);
  without, ad hoc, which still binds the plist for local builds. Each signature verified after signing.
- Workflow: secrets `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER_ID`, `APPLE_TEAM_ID`. Throwaway keychain; the certificate must be a Developer ID Application
  for that team. Signed folder zipped and notarized with `notarytool --wait`; Apple's log printed; anything but
  Accepted fails the job. No stapling possible for bare executables: Gatekeeper checks online. A tag build
  refuses to continue without the secrets; forks/PRs build ad hoc.
- Smoke test adds: serial port listing through the bundled Python (ctypes into IOKit on macOS, the likeliest
  hardened-runtime casualty) on every platform, and on macOS the signature, identifier and plist.
- User docs: `wifi-connection.md` "No route to host (Mac)" now says to choose Allow, or where to turn it on
  later; the Terminal workaround kept for running from source. Rewrite it if Mike's test shows otherwise.
- Untested until CI runs: all macOS code (Apple clang, codesign, notarytool). Then the real test: the signed
  build started from iTerm on Mike's Mac, WiFi-connect to a board, expect a prompt, not a silent denial.

## Out of scope

mDNS advertising and non-loopback binds (deferred, above), a frozen single-file binary, Linux distro packages
(.deb/.rpm), editor-side update installs, a double-click app, and flashing MicroPython itself
(documentation only, per the kickoff brief).
