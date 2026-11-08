# Learnings — Headless browser testing

Status: detail file, added 2026-10-21. See `learnings.md` for the index and the maintenance rule.

- **Headless Chromium aborts on the editor page when the machine has no fonts at all, 2026-10-21.** Running
  `tools/compile_hook_smoke.py` in a minimal Linux sandbox, Chromium launched and `about:blank` rendered, but the
  editor page killed the renderer at `page.goto` (Playwright: "Target page, context or browser has been closed").
  Chromium's stderr was full of `Could not find any font: , sans` and then a crash. Pointing `FONTCONFIG_FILE` at a
  minimal `fonts.conf` listing one TTF (the repo's `tools/fonts/` works) made the page load and all six smoke cases
  pass. A crash at `goto` is not necessarily the page's JS: check fonts first on a fresh/minimal box.
- **Playwright's `wait_for_function("<expression>")` fails on a page with a strict CSP, 2026-11-08.** Writing
  `tools/demo_request_check.py`, which serves the online demo with its real Content-Security-Policy, the first
  wait failed with `EvalError: ... 'unsafe-eval' is not an allowed source of script`. Playwright runs an
  expression string through `eval()` inside the page, which `script-src 'self' 'wasm-unsafe-eval'` rightly
  refuses. Pass a function instead (`"() => ..."`): Playwright calls it from outside the page's CSP. Not a
  page bug; don't loosen the policy for it.
- **The editor console hides lines below the chosen level, so `innerText` misses them, 2026-11-08.** The
  console keeps every line but sets `hidden` on those above **Normal** (`console-filter.ts`), and `innerText`
  skips hidden elements: `[mpy-cross WASM ready]` is info-level, so a wait for it on `innerText` timed out with
  the line present. Read each row's `textContent` instead (`#console`'s children).
- **Playwright can't download Chromium in the desktop app's device VM, 2026-11-08.** `playwright install
  chromium` failed with "Download failure" from `device_bash` (egress allowlist). Run browser checks on the Mac,
  in CI, or in a cloud session that has Chrome (`--chromium /usr/bin/google-chrome`).
