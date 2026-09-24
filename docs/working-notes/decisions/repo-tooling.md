# Decisions — Repo / tooling

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-12 — Single monorepo** (editor, device-runtime glue, node
  library together), not split repos — the pieces are tightly coupled
  right now. `repo-structure-and-conventions.md`.
- **2026-08-12 — TypeScript for the editor, Python for device-runtime.**
  Static typing catches the `msg` envelope/node-registry/CBOR-shape
  mismatches at build time; MicroPython target leaves no choice on the
  device side. Same note.
- **2026-08-12 — Vite + Vitest** as build/test tooling, replacing the
  POCs' no-build-step habit. Same note.
- **2026-08-12 — `ruff` for `device-runtime`'s Python**, configured around
  expected MicroPython-only-name false positives rather than suppressing
  broadly. Same note.
- **2026-08-12 — Apache-2.0 project license**, over MIT, mainly for the
  explicit patent grant on an embedded/wireless project. §14.
- **"Harness" retired as a name** for the on-device listener — too easily
  misread as agent-harness. Real code uses `runtime`/`listener`. Doesn't
  touch the POCs' own frozen `harness.py`. `repo-structure-and-conventions.md`.
- **2026-09-24 -- Top-level `Makefile` is the build entry point** (`make`, `make run`, `make test`),
  replacing the three hand-run install/build lines in README and Getting started. Rebuilds only what's
  out of date (editor sources, docs sources, lockfile, `pyproject.toml`, and the device-runtime SHA the
  editor bakes in); backend and mkdocs live in a repo-local `.venv`; mkdocs pins moved to
  `docs/requirements.txt`, shared with `docs.yml`. Kept to GNU make 3.81 (macOS's). `make` also symlinks
  `thingstudio-backend` into the first writable `~/.local/bin`/`/opt/homebrew/bin`/`/usr/local/bin` on PATH
  (never replacing a non-link), so it can be started straight after a build.
