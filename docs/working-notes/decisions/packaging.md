# Decisions — packaging and install routes (MVP item 7)

- **2026-09-26 — Release hosting: make `mkarliner/ThingStudio` public**, releases on its GitHub Releases. The
  licence is permissive; no separate releases repo. `packaging-install-routes-briefing.md`.
- **2026-09-26 — Sign and notarize on macOS (Apple Developer ID); Windows unsigned for MVP**, SmartScreen step
  documented. Same note.
- **2026-09-26 — CLI start/stop only for MVP; command `thingstudio`, `thingstudio-backend` kept as alias.**
  No double-click app. Same note.
- **2026-09-26 — Targets:** macOS arm64/x86_64, Windows x86_64, Linux x86_64/aarch64 (Pi as host). Windows on
  ARM out. Same note.
- **2026-09-26 — Update notices post-MVP.** Same note.
- **2026-09-26 — Run-as-a-service recipes in scope:** launchd LaunchAgent and systemd user unit (linger for a
  headless Pi), plus a `thingstudio service` helper. Same note.
- **2026-09-26 — mDNS advertising and remote connection deferred** to post-MVP or posture-2 auth. The backend
  stays loopback-only; SSH tunnel documented for a remote backend. Same note;
  `outstanding-items/posture-2-auth.md`.
- **2026-09-26 — Packaged assets: one layout for all four kinds, and a dev checkout wins over `_assets/`.**
  Changed from the brief's "`_assets/` first, then repo": that order would silently serve a stale `_assets/`
  copy over a rebuilt `editor/dist`. `tools/build_assets.py` refuses stale builds and stamps the runtime SHA.
  `packaging-install-routes-briefing.md`, "Step 1 as built".
- **2026-09-26 — Bundles built per platform on native runners; releases are drafts; deps and Python pinned.**
  Tag `v*` or manual run; a tag must match `backend/pyproject.toml`. `.tar.gz` on macOS/Linux, `.zip` on
  Windows. Python archive hash-pinned, deps pinned in `packaging/constraints.txt`, wheels only, glibc floor 2.28.
  `packaging-install-routes-briefing.md`, "Step 2 as built".
- **2026-09-26 — `install.sh` ships as a release asset, not from `main`.** Stable URL
  `.../releases/latest/download/install.sh`; script and archives always match. Per-user install under
  `~/.local/share/thingstudio`, previous version kept, `~/.thingstudio` never touched.
  `packaging-install-routes-briefing.md`, "Step 3 as built".
- **2026-09-27 — macOS: own `thingstudio-python` with embedded Info.plist, all Mach-O signed + notarized.**
  Signing alone doesn't get the Local Network prompt; the plist must be linked into the executable. Hardened
  runtime, no entitlements until proven needed. Tag builds refuse to ship unsigned macOS bundles.
  `packaging-install-routes-briefing.md`, "Step 6 as built".
- **2026-09-27 — `thingstudio-python` disclaims responsibility on start** (re-exec with the private
  `responsibility_spawnattrs_setdisclaim`, falls back with a note), so macOS judges Local Network access for
  Thingstudio rather than the terminal app. Smoke test fails if it can't. Briefing, "Step 6 as built".
