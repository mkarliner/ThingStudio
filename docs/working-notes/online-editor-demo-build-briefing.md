# Online editor demo: build briefing

2026-11-08. Hands the build of the online editor demo to an implementation session. The plan and its reasons
are in `online-editor-demo-scoping.md`; read that first. Item: `outstanding-items/online-editor-demo.md`.
Marketing side (site, copy, rollout) is being done in the ThingStudioMarketing repo, not here.

## What you're building

A demo build of the editor for `demo.thingstudio.net`: the canvas, examples, compile and the generated Python,
with nothing behind it. No board connection, no deploy, no backend. People get a feel for Thingstudio before
spending 15 minutes on an install.

## Decided (Mike, 2026-11-08)

- Goes as far as generating code, at least.
- Hosted at `demo.thingstudio.net` from Mike's home lab, beside the self-hosted GoatCounter. A GitHub Pages copy
  of the same build is the launch-day standby.
- Open and save flow files: in, by file picker and download (works in every browser).
- Demo opens are counted as page views. Nothing is counted inside the editor.
- Runtime install and deploy from the browser are **not** in this job. They're a proposed next step
  (scoping doc, last section), not decided.

## Tasks, in order

1. **Demo build mode.** `vite build --mode demo` sets a compile-time `DEMO` constant via `define` (the same
   way `editorBuild()` is inlined). Output to `editor/dist-demo/`. Gate at build time so the bundle drops
   `WebSerialTransport`, `BackendTransport`, `admin-api-client` and the firmware dialog.
2. **Start with no backend.** Under `DEMO`, skip `watchBackend()`, `refreshBackendPorts()`, the custom node
   loader, user board definitions and every `/api/*` fetch (`main.ts` has them at about lines 2394, 2441, 2522
   and 3166). Loading the page must log no backend errors.
3. **Toolbar.** Hide Connect, the port picker, Disconnect, the Tools menu and the console's command line.
   Replace "Compile → Deploy" with a Compile button that opens the generated-Python preview. Keep the Board
   menu: definitions are built in (`BUILTIN_DEFINITION_FILES`), so pin checks and per-board errors still show.
4. **Download Python** from the preview. Already a [LAUNCH-NICE] item; build it for both builds.
5. **Examples menu.** Bundle `tutorials/*.flow.json` and the showreel
   (`test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json`) at build time. Open with `tutorials/blink`
   loaded. Mike will settle the final list later, so keep it one list in one place. No loading from URLs.
6. **Open and Save As** with a plain `<input type="file">` and a download link in the demo build (File System
   Access is Chrome/Edge only).
7. **Credential fields** on WiFi and MQTT nodes show "Demo: nothing is saved or sent. Use made-up values."
   Nothing new goes to localStorage.
8. **Demo banner**, always visible, with the version from `editorBuild()`. Copy below.
9. **Docs links** go to `https://docs.thingstudio.net/` (not the backend's `/docs/`).
10. **Narrow screens:** below about 900 px wide, show "The editor needs a desktop browser" and a link to
    `https://thingstudio.net/`.
11. **Tests.**
    - vitest: the demo build contains no reference to the transports or the admin API.
    - Playwright, built on `tools/compile_hook_smoke.py`: load `dist-demo`, open each example, compile, check
      the preview, and record every request. Fail on any request outside the page's origin (allow
      `ts-stats.minus1.com` only if the GoatCounter script is used).
12. **Release workflow.** `release.yml` builds `dist-demo`, zips it, and adds the zip and its SHA-256 to the
    draft release.
13. **Deploy script** for the home lab, `tools/deploy_demo.sh` (or `.py`): download a release's demo zip,
    check the SHA-256, unpack into `<root>/releases/<version>/`, switch a `current` symlink. Rollback is
    pointing the symlink back. No credentials in the script; it runs on Mike's server.
14. **Server config example**, `packaging/demo-server/` (Caddyfile or nginx): static files only, no directory
    listing, `.wasm` as `application/wasm`, long cache for hashed assets and short for `index.html`, and the
    headers from the scoping doc (CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, a
    `Permissions-Policy` turning off serial, usb, camera and microphone). Also a `<meta>` CSP variant for the
    Pages standby. Mike sets up the container, DNS and TLS himself.

Copy (from the marketing repo, 2026-11-08; use as written, Mike may still adjust):

- **Banner** (task 8), with "download Thingstudio" linking to `https://docs.thingstudio.net/getting-started/`:

  > This is a demo of the Thingstudio editor. It doesn't connect to a board. Try an example, change it, and
  > press Compile to see the Python it makes. To run it on a board, download Thingstudio.

  After it, small: "Connecting to a board needs Chrome or Edge on a desktop."
- **Credential fields** (task 7): "Demo: nothing is saved or sent. Use made-up values."
- **Preview pane, after the first compile** (task 3): "This runs on the board as plain MicroPython files.
  Ready to try it on hardware? Get started" (linking as the banner does).
- **Narrow screens** (task 10): "The editor needs a desktop browser." and a link, "Back to thingstudio.net".

## Done when

- `npm run build -- --mode demo` (or a `build:demo` script) produces `dist-demo/`; the normal build is unchanged
  and its tests pass.
- Served locally, the demo loads with no console errors, every example compiles, and the preview shows Python.
- The Playwright request check passes. Its output is the evidence for any "sends nothing" line on the website,
  so keep the report.
- The release workflow attaches the demo zip on a `workflow_dispatch` run.

## Don't

- Don't unhide or extend the direct WebSerial mode; the demo has no transport at all.
- Don't add in-editor analytics or events.
- Don't build runtime install or flashing for the browser.
- Don't change the backend.

## Environment facts (from the 2026-11-01 briefing; recheck on your box)

- In `editor/`: `npm ci --ignore-scripts` (a plain install fails); lockfile untouched. Node 22 user-local in
  `~/.local/bin` on Mike's dev box (open shells may need `hash -r`).
- Build: `npm run build`; tests: `npm test` (vitest); CLI: `npm run build:cli`.
- Playwright: `pip install -r docs/screenshots/requirements.txt && playwright install chromium`; then
  `tools/compile_hook_smoke.py` against a built editor.
- Git: commit per invocation with `git -c user.name='Michael Karliner' -c user.email='mike@karliner.net'`.
  From a sandbox, follow CLAUDE.md's "Git writes from the agent sandbox" rules (stale `index.lock`).
- No board access is needed for this job.
