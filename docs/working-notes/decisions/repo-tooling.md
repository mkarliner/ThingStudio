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
