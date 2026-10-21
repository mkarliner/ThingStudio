# Learnings — Headless browser testing

Status: detail file, added 2026-10-21. See `learnings.md` for the index and the maintenance rule.

- **Headless Chromium aborts on the editor page when the machine has no fonts at all, 2026-10-21.** Running
  `tools/compile_hook_smoke.py` in a minimal Linux sandbox, Chromium launched and `about:blank` rendered, but the
  editor page killed the renderer at `page.goto` (Playwright: "Target page, context or browser has been closed").
  Chromium's stderr was full of `Could not find any font: , sans` and then a crash. Pointing `FONTCONFIG_FILE` at a
  minimal `fonts.conf` listing one TTF (the repo's `tools/fonts/` works) made the page load and all six smoke cases
  pass. A crash at `goto` is not necessarily the page's JS: check fonts first on a fresh/minimal box.
