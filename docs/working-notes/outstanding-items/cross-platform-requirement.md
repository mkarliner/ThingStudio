# Explicit cross-platform requirement, added by Mike 2026-08-20: editor/backend must support macOS, Windows, Linux

Added by Mike 2026-08-20 (`mikes-questions-and-points.md`, "# Platforms"): the editor/backend must support macOS,
Windows, and Linux. Not a new architectural direction — Python + `aiohttp` + `pyserial` is already cross-platform in
principle, and this was implicitly part of why Electron/Tauri were ruled out (`decisions.md`'s "Backend" section) —
but it was never stated as an explicit requirement anywhere, and nothing about actual per-OS behavior has been
verified (serial port naming/permissions differ by OS, WebSerial/Web Bluetooth browser support differs by OS+browser
per `architecture-review-briefing.md`'s own learnings). Worth confirming this holds once the backend actually gets
built, not assumed from the platform choice alone.
