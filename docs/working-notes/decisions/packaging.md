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
