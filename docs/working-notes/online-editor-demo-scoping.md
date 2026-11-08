# Online editor demo: plan (code, hosting, security)

Status: plan, 2026-11-08. Not started. Item: `outstanding-items/online-editor-demo.md`. Marketing side (site,
copy, rollout): ThingStudioMarketing `briefings/online-editor-demo-briefing.md`.

## Goal and scope

A demo of the editor on the web, for people who want a feel before spending 15 minutes on an install.

**In (Mike, 2026-11-08: "to the point of generating code at least"):** the canvas and palette, node
properties, the board menu, a few bundled examples, compile, the generated-Python preview, and downloading the
generated Python.

**Out:** anything that needs the backend or a board. Connect, ports, deploy, the console's command line,
everything in Tools (firmware, runtime install, board settings, restarts, remove flow), custom node packages,
the credential store, and backend polling.

**Acceptance:** someone with no install opens the link, loads an example, edits it, and reads the generated
Python within a minute. No console errors. No request leaves the page's own origin except GoatCounter's page
view. Same release version as the download.

## Code (product repo)

1. **A demo build mode.** `vite build --mode demo` sets a compile-time `DEMO` constant (via `define`, like
   `editorBuild()`). Gating it at build time lets the bundler drop `WebSerialTransport`, `BackendTransport`, the
   admin-API client and the firmware dialog. The demo bundle then can't reach a serial port or a backend, even
   by mistake. Output to `editor/dist-demo/`.
2. **Startup without a backend.** In demo mode, skip `watchBackend()`, `refreshBackendPorts()`, the custom node
   loader, user board definitions and every `/api/*` call. Today each would log a backend error on load.
3. **The toolbar.** Hide Connect, the port picker, Disconnect and the Tools menu. Replace "Compile → Deploy"
   with a demo button that compiles and opens the generated-Python preview. Keep the Board menu (definitions
   are built in, `BUILTIN_DEFINITION_FILES`) so pin checks and per-board compile errors still show.
4. **Generated Python.** The preview exists (`tools/compile_hook_smoke.py` checks it). Add "Download Python"
   here; it's already a [LAUNCH-NICE] item and serves both builds.
5. **Examples.** An Examples menu with a few flows bundled at build time (`tutorials/` and the showreel). The
   demo opens with one already loaded, so nobody starts on a blank canvas. No loading flows from a URL
   parameter: examples come from the bundle only.
6. **Open and Save** (in, Mike 2026-11-08). Open a local `.flow.json` and Save As by browser download, so a
   flow made in the demo can move to a real install. File System Access is Chrome/Edge only; use a plain file
   input and download link in the demo so it works in every browser.
7. **Credentials.** WiFi and MQTT nodes still show their fields; compile only needs the shape. In demo mode
   the fields say "Demo: nothing is saved or sent. Use made-up values." Nothing goes to localStorage. Today
   localStorage holds only UI preferences (sidebar width, console level, palette folds), which is fine.
8. **A demo banner**, always visible: what this is, that it doesn't connect to a board, and a link to the
   download. Copy comes from the marketing briefing.
9. **Docs links** point at `https://docs.thingstudio.net/` instead of the backend's `/docs/`.
10. **Small screens.** Below a set width, show "The editor needs a desktop browser" and a link to the
    landing page. The outside review was read on a phone; a broken canvas there costs more than a polite
    message.
11. **Tests.** A vitest for the gating (nothing in the demo build references the transports). A Playwright
    check, built on `compile_hook_smoke.py`: load the demo, open each example, compile, check the preview,
    and record every network request. Fail on any request outside the page's origin other than GoatCounter.
    This test is the evidence behind any "sends nothing" claim.

## Hosting and operations

- **Where: `demo.thingstudio.net`, served from Mike's home lab** (Mike, 2026-11-08), beside the self-hosted
  GoatCounter. Static files behind a web server; no Pages repo needed.
- **Volume:** the editor build is 1.7 MB, about 0.57 MB compressed for a first visit (two WASM files of about
  360 KB each are most of it). A busy Show HN day of 20,000 visitors is about 11 GB, a few Mbit/s averaged. Home
  upload copes with that; the risk is uptime on the day, not bandwidth.
- **Standby:** keep the same build deployable to GitHub Pages (its own small repo) and the DNS TTL short, so a
  home outage on launch day is a DNS change, not a rebuild.
- **The server:** a static-only server (Caddy or nginx) in its own container or VM, kept apart from the rest of
  the lab. No directory listing, no other routes, TLS from Let's Encrypt, automatic security updates.
  `.wasm` served as `application/wasm`. Long cache times for hashed assets, short for `index.html`.
- **Real headers**, which Pages couldn't send: the CSP below as a header, plus `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
  `Permissions-Policy` that turns off `serial`, `usb`, camera and microphone for the demo.
- **Access logs hold IP addresses.** Keep them short-lived (a few days) or drop the last octet, so "no personal
  data" stays true. The landing page's footer says what's counted; it should match.
- **Built from a release tag, not from main**, so the demo matches the downloadable version. `release.yml`
  builds `dist-demo` and attaches it to the release as a zip. A short script on the home-lab
  machine downloads the zip, checks its SHA-256 against the release, and unpacks it into a new versioned folder;
  a symlink switch makes it live.
- **Check `.wasm` is served as `application/wasm`** after the first deploy: streaming WASM compile refuses any
  other type.
- **Version** shown in the banner and in Help → About, from the existing `editorBuild()` stamp.
- **Rollback:** point the symlink back at the previous folder.
- **Measurement: did they open the editor?** The demo page is the editor, so a page view on demo.thingstudio.net
  is that hit. The landing page's "Try it in your browser" opens it in a new tab, so the landing page stays
  open behind it. Two ways to count, both external:
  - GoatCounter's script on the demo page, as on the landing page; or
  - no script at all: feed the web server's access log to GoatCounter (`goatcounter import`; check it reads
    this server's log format). That counts visitors with script blockers too, and the demo then makes no
    request beyond its own files.
  Recommended: the log import.
- **Did they go further?** The banner's "Get started" link goes to the docs, which run GoatCounter. Visits
  arriving from demo.thingstudio.net show up there as referrers, with no code in the editor. Nothing is counted
  inside the editor itself: that would be telemetry. Downloads are counted from GitHub release figures.

## Security checks (before it goes public)

The demo is static files with no backend, so the risks are small and mostly about the supply chain and keeping
promises.

- **No server-side code, no secrets.** Grep the built bundle for tokens and keys. Source maps can ship (the
  code is open source).
- **Content Security Policy**, sent as a header by the home-lab server: `default-src 'self'`;
  `script-src 'self' 'wasm-unsafe-eval' https://ts-stats.minus1.com`; `connect-src 'self'
  https://ts-stats.minus1.com`; `worker-src 'self'`; `img-src 'self' data: https://ts-stats.minus1.com`;
  `style-src 'self' 'unsafe-inline'` only if Vue's inline styles need it; `frame-ancestors 'none'`. Drop the
  GoatCounter hosts if the log import is used. Test it with the Playwright run. The Pages standby can't send
  headers, so its copy carries the same policy in a `<meta>` tag (without `frame-ancestors`).
- **No third-party assets.** Fonts and scripts are self-hosted. (The landing page loads Google Fonts today;
  the marketing briefing fixes that too.)
- **The compile hook runs Python in a WASM worker.** It's sandboxed by the browser and only sees the flow on
  the canvas. Examples come from the bundle, never from a URL.
- **Dependencies:** `npm audit` on the release build; versions are already pinned in `package-lock.json`.
- **Licences:** Help → About links to `docs/third-party-licenses.md`. The demo ships the MicroPython WASI
  interpreter and mpy-cross (MIT), Rete and Vue (MIT), cborg.
- **Who can publish:** whoever can write to the demo folder on the server can serve JavaScript on
  demo.thingstudio.net. Deploy as a user that owns only that folder; the web server reads it and can't write.
- **Domain:** HTTPS enforced; a CAA record limiting certificates to Let's Encrypt (the home-lab server and the
  Pages standby both use it) is a cheap extra.

## Order of work

1. Mike: which examples (open). The server container, the DNS record and TLS.
2. Code items 1–11, one implementation session; Playwright check green.
3. Hosting: first deploy from a release; check MIME, headers and HTTPS (securityheaders.com or similar); run
   the browser matrix (Chrome, Edge, Firefox, Safari on desktop; a phone for the small-screen message).
4. Marketing changes (see the briefing), then a soft announcement in the velvet-rope channels.

## Open questions for Mike

- Which examples beyond the tutorials and the showreel? (TBD, Mike 2026-11-08.)
- One GoatCounter site for the landing page and the demo, or two? Script or log import?
- Runtime install and deploy from the browser: see "Next step, proposed" below.
- Should the browsers the demo works in be listed once the matrix passes? It doesn't use Web Serial, so it
  may work in Firefox and Safari too.

## Next step, proposed: runtime install and deploy from the browser

Mike, 2026-11-08: can the online demo at least install the runtime? Not decided; this is the case for and against.

Installing the runtime is only useful with deploy, so the step is both. Together they are slices 1 and 2 of
`outstanding-items/online-and-offline-editor.md`. At that point the page is the online version, not a demo.

**What it takes:**

- **Deploy over Web Serial.** Close to "only the transport differs". `serial_relay.py` is a byte pipe, and the
  protocol lives in the editor (`transport.ts`, maintained: the 2026-10-24 protocol work changed it).
  `WebSerialTransport` exists but is frozen and hidden. The library list (`/api/dependencies`) and the runtime
  files (`/api/runtime-sources`) become static files in the build.
- **Runtime install.** Today it is Python in the backend (`raw_repl.py`, 353 lines; `runtime_installer.py`,
  208). The raw REPL protocol is small and the backend's tests describe it. **Port it once, to the editor,
  and run it over the `DeviceTransport` byte pipe in both modes**, with the backend as a relay. One
  implementation, not two; otherwise every install fix has to land twice.
- **ESP32 flashing stays out.** It would mean `esptool-js` and reversing part of
  `decisions/editor-firmware-flashing.md`. A blank ESP32 gets a pointer to the local install.
- **UF2 boards (Pico, Pico W, Pico 2, Pico 2 W) can get MicroPython from the start** (Mike asked, 2026-11-08).
  In BOOTSEL mode the board is a USB drive; the image is one file copied onto it. No serial, no new dependency.
  The pinned `.uf2` builds are already in `firmware/builds.json`. Two ways in the browser: a download link and
  "copy it onto the RPI-RP2 drive" (any browser), or, in Chrome/Edge, the File System Access directory picker
  writing the file to the drive the user picks. After that, the runtime still goes on over serial (the install
  above): there's no Pico image with the runtime built in (`firmware/targets/` is ESP32 only). A Pico image
  with the runtime frozen in would make it one copy, but that's a separate firmware job.
  Not in the code-only demo: with no runtime install or deploy, it would end at a board that can't run a flow.

**Known snags:** boards with native USB (ESP32-S3/C3, Pico) leave and rejoin the bus on a hard reset; Web
Serial then loses the port and the user picks it again. Install ends with a hard reset, so this needs a clear
"pick the port again" step. DTR/RTS line handling differs between pyserial and `setSignals()`; check it on the
CH9102 and CH340 boards.

**Why it may be worth it:** the target group knows MicroPython, so many have a board that already runs it.
For them this is a real board running a flow with nothing downloaded. That is the "trying" target in the
marketing plan, and it removes the step the outside review named (trusting a binary).

**Why to wait:** the newcomer test on the local install hasn't passed yet. A second path splits the first few
testers' reports, and every board quirk then has two places to show up. Build the code-only demo first.
