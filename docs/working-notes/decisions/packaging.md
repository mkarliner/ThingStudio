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
