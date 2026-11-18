# Briefing: the online editor with WebSerial (deploy, runtime install and flashing in the browser)

Status: plan, 2026-11-18, revised the same day after Mike's answers and a scoping pass. For implementation
sessions. Written from a read of the code at commit `f5b96b8d`; line numbers are approximate.

Read first (paths relative to `docs/working-notes/` unless rooted): `outstanding-items/online-and-offline-editor.md`
(the item this delivers, slices 1 to 3), `online-editor-demo-scoping.md` (the demo build this replaces),
`interfaces/protocol/README.md` and `SPEC.md`, `decisions/runtime-install-from-editor.md`,
`decisions/editor-firmware-flashing.md`, `decisions/firmware-catalogue.md`, `outstanding-items/credential-storage-design.md`.

## Decided (Mike, 2026-11-18)

1. **The online editor replaces the demo** at demo.thingstudio.net. Phones, Firefox and Safari still get what the
   demo gives them today: open, edit and compile, with no board.
2. **Feature subset (after scoping):** accepted as section A lists it. Features the online editor can't offer are
   shown greyed out, with a line saying they're in the installed editor. That's slightly more confusing than leaving
   them out, but it shows what the desktop install adds.
3. **Credentials (after scoping):** kept in the browser for the session only, not persistently (section B). A
   better scheme may come later. Export is for the second iteration.
4. **Slice 3, flashing MicroPython from the browser, is in.** This reverses part of
   `decisions/editor-firmware-flashing.md` ("no browser flasher, no new npm dependency"). Record it as a dated entry.
5. **Timing:** before the serious launch activities in `marketing-plan.md` section 8. The Hacker News repost
   (about 1,550 visits) already acted as a soft launch.
6. **Scope, then fix the plan, then build.** This document is that plan.

7. **The install page is in, and is built first** (Mike, 2026-11-18), so he can test flashing on boards while the
   rest is built. It lives on the branch `online-editor-webserial`; major features are built on a branch from now on
   (`AGENTS.md`, "Commits").

## Why now

Over 11 to 17 November the demo server's own log shows 330 human visitors to demo.thingstudio.net. About 50 of
them went far enough to load the compile-hook interpreter. In the docs, only about 5 people worked through the
install tutorial (steps 2 to 6 had 4 to 7 views each). GoatCounter undercounts by up to 2.5× (204 demo arrivals
from the landing page against 88 recorded button clicks), but the ratio holds: people try things in the browser,
not by installing. ESPHome and WLED users already expect to plug in a board and click Connect in Chrome.

## Goal

The editor at demo.thingstudio.net works in Chrome or Edge on a desktop, with no backend. It can take a blank board,
flash MicroPython, install the Thingstudio runtime, and deploy flows to it. All of this goes over WebSerial,
except UF2 boards (section C). In any other browser the same page does what the demo does today.

## Where things stand (checked against code, 2026-11-18)

**Already done:**

- **The transport exists and uses the current wire format.** `WebSerialTransport`
  (`editor/src/protocol/transport.ts`) does F64 line framing as in SPEC §5 and implements `DeviceTransport`.
  Connect in direct mode is wired (`main.ts` ~3089, `navigator.serial.requestPort()`). It's hidden:
  `index.html` `<option id="connModeOptionDirect" value="direct" hidden>`.
- **Deploy logic doesn't depend on the transport.** HELLO handling, the version check, chunked transfer
  (`protocol/transfer.ts`, SPEC §7), skipping libraries the board already has, `SET_BOARD_SETTINGS` and
  `HELLO_REQUEST` on Connect all live in the editor. The long comment at `main.ts` ~1386 saying the editor can't
  ask for a HELLO is stale. Fix it in passing.
- **Compiling runs in the browser** (mpy-cross and micropython-wasi as WASM).
- **The demo build:** `npm run build:demo`, compile-time `__DEMO__`, `dist-demo/`, `tools/demo_request_check.py`,
  `packaging/demo-server/`, live at demo.thingstudio.net. `outstanding-items.md` still says "not live yet".
- **Saved values already have a no-backend path.** `editor/src/app/rete/saved-values.ts` is the one module the
  credential and preset fields go through. In the demo it keeps values in page memory, lost on reload. A browser
  store slots in here (section B).

**What still needs the backend:**

| Need | Today | File |
|---|---|---|
| Library list and sources for a deploy | `GET /api/dependencies`. Deploy is blocked with "no library list from the backend" without it. | `main.ts` ~3234, `backend/.../dependencies.py` |
| Runtime sources to install | `GET /api/runtime-sources` | `main.ts` ~2571 |
| Runtime install | `install_runtime` over the backend WebSocket: raw REPL driven from Python | `raw_repl.py`, `runtime_installer.py`, `ws_relay.py` `_install_runtime_exclusive` |
| Remove flow (board recovery) | `remove_flow`, raw REPL | `board_recovery.py`, `ws_relay.py` |
| Command box | `raw_write` | `ws_relay.py` `_raw_write` |
| Firmware flashing | `esptool` subprocess, `uf2` copy to a mounted volume | `firmware-dialog.ts` (no DOM), admin API `/api/firmware/*` |
| Firmware catalogue | the backend fetches the signed `builds.json` from the docs site | `catalogue_source.py` |
| Flow save/open/list | `/api/flows` | demo already has a non-backend path (`picker: !__DEMO__`) |
| Credentials and presets | `/api/credentials`, `/api/presets` | `admin_api.py`; demo: memory only |
| User board definitions, custom nodes | `/api/definitions`, `/api/custom-nodes` (read `~/.thingstudio`) | built-ins only online |
| WiFi link to the board, discovery | raw TCP from the backend | not possible from a browser (section A) |

**Found while scoping, each one blocks something:**

- **The demo server forbids WebSerial.** The Caddyfile sends `Permissions-Policy: serial=(), usb=(), ...`.
  `navigator.serial` fails on that page until it says `serial=(self)` (and `usb=(self)` if WebUSB is used).
- **The CSP allows `connect-src 'self'` only.** Firmware images and the catalogue have to come from the page's own
  origin. That is also what keeps "the page sends nothing" true.
- **GitHub release assets can't be fetched from a browser.** GitHub sends no CORS headers on them. micropython.org
  is not assumed to either. Images have to be mirrored on the editor's origin whatever the CSP says.
- **26 `!__DEMO__` gates in `main.ts`,** plus `ConfigRefField.vue`, `CredentialRefField.vue`, `PaletteSidebar.vue` and
  `saved-values.ts`. Some mean "has a backend", some "can reach a board".

## A. Feature subset: what the online editor can't do

"USB only" means the editor's link to the board is USB. A deployed flow still uses WiFi, MQTT and HTTP. All four
tutorials can be deployed over USB. Web Blink uses the board's own `http in` and a browser on the same network,
not the editor's WiFi link.

| Missing online | Who notices | Can it be added? |
|---|---|---|
| Editor ↔ board over WiFi, discovery | Anyone watching debug output from a board that isn't on USB. `wifi-connection.md` | No. A browser can't open raw TCP. A WebSocket listener on the board is blocked from an https page by mixed content and Chrome's local network access rules. Stays local only. |
| Custom nodes | Readers of `custom-nodes.md`, AI-authoring users | Yes, from a folder the user picks (B4) or one file per session. Not in the first release. |
| User board definitions, presets | Users with boards outside the built-in 12 | Same as custom nodes. |
| Command line, `thingstudio-compile`, MCP server | Developers and AI-authoring users | No. These are local tools by nature. |
| Docs bundled with the installed version | Nobody online | The online editor links to the public docs, which follow `main`, as the online editor will. |
| A pinned runtime version | Online users, once per runtime release | The online editor always targets the newest runtime. After each runtime release a board shows "runtime older than the editor" and needs Install runtime again. The version check already says so. Mention it in the docs. |

**Decided (Mike, 2026-11-18):** this subset for the first release. In the editor, the missing features are greyed
out with one line naming the installed editor and linking to the install page. Name what's missing on the landing
page and in "Use it in your browser" too. Custom nodes and user definitions online wait for a better storage
scheme (B4 or later).

## B. Credentials and other saved values in the browser

Today a flow file holds only a credential's name. The values live in `~/.thingstudio/credentials/<type>/<name>.json`
and are resolved when a flow loads (`credential-storage-design.md`). They are compiled into the board's code as
plain strings, so the WiFi password is in plain text on the board's flash anyway. Presets use the same store
without secrets. Everything goes through `saved-values.ts`, so each option below changes that one module.

| Option | What the user sees | Protects against | Costs |
|---|---|---|---|
| B1. Page memory (the demo today) | Types credentials again on every visit | Everything at rest | Annoying past a first try |
| B2. Browser storage (IndexedDB), plain | Saved on this browser and computer, with a Forget button | Other sites (same-origin rule). Third-party script, given the CSP. | Readable by anyone who can read the browser profile, and by code served from the origin itself |
| B3. B2, encrypted with a passphrase (WebCrypto) | Types a passphrase once per visit | Someone reading the profile on disk | A passphrase to forget, with no recovery. No protection against code on the origin, which sees the passphrase when it's typed. |
| B4. A folder the user picks (File System Access), same layout as `~/.thingstudio` | Picks a folder once; Chrome asks again per visit unless the user allows it permanently | Same as B2 | The online and installed editors can share one folder: credentials, presets, then custom nodes and definitions. Folder handles persist in IndexedDB. To verify: whether macOS's picker reaches a dot-folder, and how much Chrome's per-visit prompt annoys. |

Rejected: back into the flow file (reverses a settled decision); Chrome's password manager API (one id and one
password per entry, Chrome only, not built for this).

**Decided (Mike, 2026-11-18): browser storage for the session only, not persistent.** Use `sessionStorage`:
values survive a reload in the same tab and are gone when the tab closes. Each tab has its own, so a second tab
starts empty. The field note says so in one line, and a Forget button clears them early. Presets go the same way.
B3 is not needed: it adds a passphrase to protect a value that is already on the board in plain text. B4 stays the
candidate for "something better later": it's the path to sharing with the installed editor and to custom nodes
online. Write down what's stored where.

## C. Flashing in the browser (slice 3)

### ESP32 family: esptool-js

- `esptool-js` is Espressif's own WebSerial port of esptool. It's Apache-2.0, like this project, and works in
  Chrome and Edge. It writes flash and doesn't build images, which is all this needs. It's a new npm dependency:
  pin it as `decisions/third-party-pinning.md` says and add it to `docs/third-party-licenses.md`.
- **Keep the catalogue's shape.** The chip family gives the chip and address, a build gives the image, erase
  before writing is the default. Our merged images go at 0, stock classic ESP32 and S2 at 0x1000. `firmware-dialog.ts`
  already has no DOM. Give it a second runner next to the admin API job runner.
- **One port, handed over.** `WebSerialTransport` must release the `SerialPort` before esptool-js opens it. After
  the flash: hard reset, then the runtime install over the same port (task 4).
- **Board quirks to test, not chase.** USB-UART boards (classic ESP32): esptool-js resets the board into download
  mode by itself. S3, C3 and C5 on USB-Serial/JTAG: the same, through the chip's own USB. S2 on native USB
  (LOLIN S2 Mini): the user holds 0 and taps RST, and after the flash the port re-enumerates, so the user picks
  it again. One line saying so, no retry chain.

### UF2 boards (Pico, Pico W, Pico 2, XIAO nRF52840)

The board appears as a drive and takes a file copy. There's no serial step.

1. **Download and drag (first release).** The dialog downloads the pinned `.uf2` from our origin and says "hold
   BOOTSEL, plug in, drag this file onto RPI-RP2". This is what MicroPython's own instructions say. It works in
   every browser.
2. **Write the file to the drive from the page (spike).** File System Access, with the user picking the RPI-RP2
   drive. Chrome refuses to let a page pick some root and system folders. Whether it allows a removable drive's
   root has to be tried on macOS and Windows before it's planned.
3. **WebUSB, as picotool does (later, if 1 is too clumsy).** RP2040 and RP2350 only, Chromium only.

A board that already runs MicroPython can be put into BOOTSEL with `machine.bootloader()` over the raw REPL
(task 4). That removes the button step for a reflash.

### Images on our own origin

- Mirror every image the bundled catalogue offers (15 builds today, stock MicroPython 1.29.0 and our 15.1.0
  images, about 2 MB each) into the online build's output. Check each one against the catalogue's sha256
  (SubtleCrypto) before writing it to the board.
- **Bundle the catalogue in the build. Don't fetch it.** The signature exists so the docs site can't choose what's
  written to a board. When the catalogue arrives in the same files as the code, whoever controls the origin
  already controls the code, so the online build ships the catalogue it was built with. A new image means a new
  deploy of the site, which happens on every release anyway.
- MicroPython is MIT-licensed, so mirroring its images is allowed. Credit it on the licences page.

### Out of slice 3

STM32/pyboard (DFU), and a local file the user chooses (keep **Choose a file…** if it costs nothing; drop it if
it does).

## D. A separate install page (confirmed 2026-11-18, built first)

Mike, 2026-11-18, pointing at Tasmota's web installer: is there a case for a separate install page?

**What Tasmota does.** The page is one Install button built on ESP Web Tools: Web Serial plus a manifest
describing the firmware. The tool reads the chip type from the board and picks the matching build from the
manifest. After flashing, Improv Wi-Fi (optional) sets up WiFi over the serial port. WLED and ESPHome use the same
tool.

**Proposal: yes, as a second page in the same online build, using our own flasher rather than ESP Web Tools.**
For example `demo.thingstudio.net/install`: plug in, Connect, flash, install the runtime, optionally name the
board, then "Open the editor".

Why a separate page:

- **It's one job with one link.** The landing page, "Getting started" and "Installing MicroPython" can each say
  "step 1: put Thingstudio on your board" and link to it. People who arrived from ESPHome or WLED expect a page
  like this.
- **It serves installed users too.** Today flashing needs the backend and esptool. A desktop user can prepare a
  board on the web page and then use the installed editor. That removes a step from the install docs.
- **It closes an old item.** `outstanding-items/tasmota-install-page.md` asks for this, and its prerequisite (a
  flashable image with the runtime) now exists.

Why not ESP Web Tools:

- It only covers ESP chips. The Pico family and the XIAO nRF52840 are supported boards.
- It flashes an image and stops. Our own images (classic ESP32, C3, C5) include the runtime, but the S3 and S2 use
  stock MicroPython and need the runtime install afterwards (task 4). The S3 is the Freenove board in the
  tutorials.
- It loads its code from a CDN unless self-hosted, and would be a second flasher beside esptool-js with a second
  catalogue format (its manifest) to keep in step with `builds.json`.

What it costs on top of tasks 4 and 5: a second Vite entry point and a small page using the same modules
(`firmware-dialog.ts`, the raw-REPL install, the catalogue and images from task 2). The editor's **Tools → Install
firmware…** opens the same code, so there is one flasher, used in two places. A board already running the runtime
gets "already installed, version x; reinstall?" rather than a flash.

**Choosing the build.** esptool-js reads the chip type when it connects. That is the catalogue decision's "ask the
tool what it already knows", not guessing, so the page can preselect the chip family and offer that family's builds.
A UF2 board gets the download-and-drag steps instead.

**WiFi on the install page: not in the first version.** In Thingstudio the flow carries its WiFi network, and
Board settings already sets the hostname and password over USB. Improv would be a second way to do the same thing.

## Tasks, in order

**Order changed (Mike, 2026-11-18): the install page first.** Its first version (`editor/install.html`,
`editor/src/install/`) flashes ESP32 chips with esptool-js and gives UF2 boards their file to drag; it needs the
catalogue and images from task 2 (done for the page: `tools/fetch_firmware_mirror.py` and `vite.config.ts`'s
`firmwareMirror()`). Then tasks 1 to 7 as below.

**Status, 2026-11-18:** the install page is built (`1979aad`), and task 4's raw-REPL port is built and on it:
`editor/src/raw-repl/` (the client, the install plan, a Web Serial link) with `backend/test/test_raw_repl.py`'s cases
ported to `editor/test/raw-repl.test.ts`, and Install runtime on the page (`editor/src/install/runtime.ts`). The
runtime's files come from `device-runtime/runtime_manifest.py` at build time (`vite.config.ts`'s `runtimeSources()`).
Not yet tried on a board.

**Status, task 1 (2026-11-18):** the online build now connects over Web Serial when the browser has it
(`editor/src/app/edition.ts`: `CAN_REACH_BOARD` at run time; backend-only code stays behind `__DEMO__` inline so the
bundler drops it). Online with a board: Connect (direct), Deploy (the library list built in by
`vite.config.ts`'s `flowDependencies()`, which runs the backend's own `dependencies.py`), Check status, Board settings
(no password is remembered: that's for the installed editor's WiFi link), Restart, the command box and the prompt
(`WebSerialTransport.rawWrite`), Install runtime and Remove flow (the raw-REPL client), Install firmware (opens the
install page). Greyed out: custom nodes in the palette. Hidden: the port list, Save to a file handle. The banner and
first console line say whether this browser can reach a board. `tools/demo_request_check.py` checks both cases.
User board definitions have no control to grey out: they're read from `.thingstudio` at start-up, so online they
simply aren't there, Pins… says "built-in", and the docs page says so. The request check now also runs the page
without Web Serial (Firefox/Safari): board controls hidden, demo behaviour. Task 1 is done.

**Status, task 7 (2026-11-18):** `docs/user-guide/in-your-browser.md` (linked from Getting started and the nav),
dated decision entries (runtime install, flashing, catalogue), outstanding items updated, the "browser-only" ambiguity
closed. Left for marketing: the landing page
(`ThingStudioMarketing/briefings/local-and-browser-positioning-briefing.md`). Tasks 3 and 5 (hardware) are open.

**Hardware, 2026-11-18 (Mike):**

- **CYD (classic ESP32):** install page write (ThingStudio image, ~30 s at 460800) then Install runtime (boot file
  only), then the online editor: Connect, Deploy Blink on GPIO 4. Whole sequence about 2 minutes. Found and fixed: a
  port esptool-js left open after the write was reported as "no reply"; a port close that never returned hid the
  result.
- **Pico W:** UF2 download and drag, then Install runtime: clean.
- **Pico (RP2040):** the same, clean, after two fixes: with both Picos plugged in, the second install went to the
  Pico W's port, whose running runtime ignored Ctrl-C and was called "other firmware". The page now asks a running
  runtime to stop (STOP_TO_PROMPT after each Ctrl-C), recognises its output, and names the board it's installing on.
- **Freenove ESP32-S3 4.0" (native USB):** works, after a couple of power cycles; the installed editor has the same
  quirk, so it's the board, not this path. Now in `debugging.md`. Mike is getting a plain S3 board to check the
  native-USB path without the quirk.
- **ESP32-C3:** write, Install runtime and Deploy from the online editor: OK. Web Blink (WiFi + http in) deployed
  and worked, so the WiFi memory problem of 2026-09-25 doesn't come back on the browser path.
- **Tidal badge (EMF 2022, ESP32-S3 on its own USB, running its own firmware):** flashes through the backend, but
  Connect on the install page found no bootloader. Likely cause, unconfirmed: the reset into download mode brings up
  a new USB device, a port the page hasn't been given. The page now spots this case by the port's USB ids (Espressif
  vendor id, not the USB-Serial/JTAG product id) and says to enter download mode by hand and pick the new port.
  Confirmed (chrome://device-log, Mike, 2026-11-18): normal mode is the firmware's own USB (0x4001); download mode
  appears as the USB-Serial/JTAG (0x1001, another serial number) for about a second and then the chip restarts into
  its firmware, so no port can be picked in time. **Decided (Mike): leave such boards to the installed editor** for
  the write; `in-your-browser.md` says so. Not built, if more such boards turn up: grant the JTAG device once (picker
  open before switching), then follow it on Web Serial's connect event and open it within the window.
- **Pico W in the online editor:** deploy and redeploy: OK (Mike, 2026-11-18).
- **ESP32-C5:** write (ThingStudio's C5 image at 0x2000), Install runtime and Deploy: OK after a couple of power
  cycles, like the Freenove S3. Now in `debugging.md`.
- **Plain S3:** none to hand (Mike). The Freenove S3 and the C3 cover the chip's own USB; dropped for now.
- **Still to try:** Remove flow from the online editor, an S2 Mini (BOOT+RESET, the port changing), an nRF52 drag.

**Status, task 6 (2026-11-18):** done. Online, credentials and presets live in the tab's sessionStorage under one key
(`thingstudio.savedValues`, `saved-values.ts`), page memory where that throws; they survive a reload and go when the
tab closes. File → Forget WiFi and broker details clears them. An example's made-up values are written only where
the tab has none under that name, so reopening an example keeps what was typed in.

Before touching anything that sends or parses frames: read `interfaces/protocol/SPEC.md` and run the conformance
vectors (`cd editor && npm test`, `test/protocol-conformance.test.ts`). npm commands run on Mike's Mac, or in the
session's own extracted copy, never against the live-mounted `editor/node_modules` (`CLAUDE.md`). No protocol
change without Mike's explicit permission.

### 1. One build, two questions it asks

The online build replaces the demo build, so it can't assume a board. Split the `__DEMO__` gates into two
questions:

- **Is there a backend?** Decided at compile time. False online, true in the installed editor.
- **Can the page reach a board?** Decided at run time. In the installed editor, through the backend. Online,
  `"serial" in navigator`.

Online in Chrome or Edge on a desktop: Connect, Deploy, Install runtime, Install firmware, Board settings, Remove
flow, the command box. In any other browser the same page behaves as the demo does today, with one line saying
which browsers can reach a board. Greyed out online, each with one line naming the installed editor: WiFi connect,
discovery, custom nodes, user definitions.

Change the Caddyfile's `Permissions-Policy` to `serial=(self)` (and `usb=(self)` only if WebUSB is used), and update
`demo_request_check.py` so it still proves the page requests nothing beyond its own origin and GoatCounter.

**Done when:** the online build shows the right controls in Chrome and the demo's behaviour in Firefox and Safari,
the installed editor is unchanged, and the request check passes.

### 2. Libraries, runtime sources, catalogue and images as static files

Generate at build time what `/api/dependencies` and `/api/runtime-sources` return today, from the same sources the
backend reads (`dependencies.py`, `device-runtime/runtime_manifest.py`). One generator for both builds, so the two
editors can't drift. Add the catalogue and the mirrored images (section C). Add a test that `EDITOR_TARGET_VERSION`
(15.1.0) matches the runtime sources shipped, and one that every catalogue image is in the output with its sha256.

**Done when:** a deploy resolves libraries with no backend, Install runtime finds its files in the build, and the
firmware dialog lists builds whose files are in the build.

### 3. Deploy over WebSerial on real hardware

Run deploy on a classic ESP32 (USB-UART), an ESP32-S3 on native USB, and a Pico W. Compare with what the backend's
`serial_relay.py` does: DTR/RTS left alone on open, a 5 s write timeout, reading what's there rather than waiting
for whole chunks. Check the classic-ESP32 serial link fix and the 2026-11-07 S3 USB work again on this path; both
were tested through the backend.

**Done when:** deploy, redeploy, NODE_STATUS, DEBUG output and Board settings work on all three boards, and the
conformance test passes.

### 4. Raw REPL in TypeScript: runtime install, Remove flow, command box

Port the raw-REPL client: enter raw REPL, exec, chunked file write, hard reset, every read time-bounded as in
`raw_repl.py`. Port the install sequence from `runtime_installer.py` and `ws_relay.py`, including:

- the 2026-09-23 fixes (read latency, prompt handling, progress, timeouts, board diagnosis);
- the precompiled `.mpy` runtime files (`precompileRuntime`, already in the editor);
- the custom-image case (a board with a frozen inventory module gets only `/main.py`);
- stopping a running listener. It ignores Ctrl-C, and a native-USB board doesn't reset when the port opens, so read
  what `_install_runtime_exclusive` does before assuming.

Port Remove flow (`board_recovery.py`) at the same time. The command box becomes a plain write. Port the cases
in `backend/test/test_raw_repl.py` (they caught a real dropped-bytes bug) and test against a fake port.

**Done when:** on the three boards, the online build installs the runtime on fresh MicroPython, deploys a flow,
and Remove flow recovers a board stuck on a crashing flow.

### 5. Flashing in the browser

Section C: esptool-js runner for `firmware-dialog.ts`, download-and-drag for UF2, `machine.bootloader()` for a
Pico already running MicroPython. Then the File System Access spike for UF2, reported back before it's built.

**Done when:** a blank classic ESP32, a blank S3 and a blank Pico 2 each go from nothing to a deployed flow in
Chrome, using only the online editor and, for the Pico, one file drag. Every failure names the step and the next
action, following the project's fault rules.

If section D is confirmed, the install page is part of this task: a second entry point using the same flasher and
runtime install. **Done when** then also covers going from a blank board to "Open the editor" on the install page.

### 6. Saved values for the session

`sessionStorage` behind `saved-values.ts` (section B), with the one-line note and a Forget button. Flows keep the
demo's save and open (File System Access in Chrome and Edge).

**Done when:** a WiFi and MQTT flow can be set up, deployed, and reopened after a reload in the same tab without
typing the credentials again; closing the tab clears them; and what's stored where is written down.

### 7. Words and records

- Landing page and docs: what the online editor does and doesn't do (section A), Chrome or Edge on a desktop to
  reach a board, where credentials are kept. Adjust the "local only" message: the page still sends nothing
  anywhere except GoatCounter.
- A "Use it in your browser" page, which also covers the UF2 drag.
- Dated decision entries, not edits to old ones: `decisions/runtime-install-from-editor.md` (WebSerial is back,
  superseding "web serial is deprecated", 2026-09-22), `decisions/editor-firmware-flashing.md` (the browser
  flashes, esptool-js is a dependency), `decisions/firmware-catalogue.md` (the online build bundles its catalogue).
- Close or update `ambiguous-browser-only-claim.md`, `online-and-offline-editor.md` and `online-editor-demo.md`.
  Fix "not live yet" in `outstanding-items.md`.

## Open for Mike

None at the moment.
