# Working note: backend language and platform — decided

Status: decision, 2026-08-16. Answers the half of `rete-migration-decision.md`
Decision 2 left open — "a thin local backend, Node-RED's model, most likely
Python" recorded language as a lean, not a commitment. This note commits it,
plus the framework and serial-I/O library choices Decision 2 didn't reach.
Worked out in conversation this session, checked against current package
health rather than assumed. No code written; nothing here is implemented.

---

## 1. The decision

**Python. `aiohttp` for the HTTP/WebSocket server. Plain `pyserial` (sync),
its blocking calls wrapped in `asyncio.to_thread`/`run_in_executor` rather
than an async-serial dependency.**

## 2. Why Python

Mike's reasoning, recorded plainly since it's the actual basis for the
call: the likely contributor demographic for a maker-tool backend skews
Python-literate, and a Python backend makes that audience feel at home the
way a Node.js backend wouldn't necessarily. TypeScript on the browser side
is separately justified (the editor is a browser app; there's no
Python-in-the-browser option that doesn't cost more than it buys), so this
isn't "avoid TypeScript everywhere," it's "don't add a third language for
no reason" — a stated preference for not accumulating technologies, which
this decision satisfies by keeping the project at two languages
(TypeScript/browser, Python/backend+device) instead of three.

**Worth being explicit about why there's no strong counter-argument,
rather than leaving that implicit:** the usual case against Python —
runtime speed — doesn't apply here the way it does on-device. §5's whole
MicroPython-vs-bespoke-VM reasoning is about a genuinely constrained
target (RAM/flash-limited MCUs); this backend runs on a desktop-class
machine relaying WebSocket messages and serial bytes, an I/O-bound
workload where Python's interpreter overhead is not the bottleneck. The
audience-fit argument gets to be decisive on its own merits because
there's no competing technical cost to weigh against it.

**The one real trade-off, flagged rather than glossed over:** end-user
distribution. A compiled-language backend (Go, Rust) gives a single
static binary, no runtime dependency for whoever installs it. Python
needs an interpreter present, or a frozen build (PyInstaller and similar).
This is well-mitigated for the stated target audience — Python-literate
users already have Python — but it's a real structural cost a
compiled-language choice wouldn't have had, worth carrying forward as a
known trade-off rather than an unexamined one. If the audience broadens
past Python-comfortable users later, packaging (not language) is where
that shows up first.

## 3. Framework choice: `aiohttp` over FastAPI

The actual job is narrow: relay WebSocket messages between browser and
device, serve the editor's static built assets, and (once
`transport-auth-design.md`'s mechanism lands) check auth on mutating
messages. That's the whole "thin" backend Decision 2 committed to —
worth choosing a framework sized to that, not to what's most popular.

**FastAPI** is the default reach for most Python contributors today —
confirmed via PyPI stats this session, over 100M downloads/week, the most
likely framework a Python-literate contributor already knows. But it's
built on Starlette, with Pydantic and Uvicorn riding along for request
validation and the ASGI server — three additional dependencies for
capabilities (automatic request-body validation, OpenAPI docs generation)
this backend doesn't need, since it isn't exposing a public REST API
surface, just a WebSocket relay and static files.

**`aiohttp`** does both HTTP static serving and WebSocket natively, as one
mature, long-established library, with none of Pydantic/Starlette/Uvicorn's
weight riding along. Less reach-for-it-by-default fame than FastAPI, but
well documented, and closer to this backend's actual footprint. **Chosen
over FastAPI for that reason** — consistent with "thin" being load-bearing
and with not wanting to accumulate more dependencies than the job needs.

Raw `asyncio` + the `websockets` library was the minimal extreme
considered and set aside: fewest dependencies, but it means hand-writing a
static file handler aiohttp already provides, for a saving that doesn't
justify itself given aiohttp is already about as lean as a real framework
gets.

## 4. Serial I/O: plain `pyserial`, not `pyserial-asyncio`

**Checked this session rather than assumed, same diligence this project
already applies to npm dependencies (CLAUDE.md):** `pyserial-asyncio` is
dead — last released September 2021, no activity since. A maintained fork,
`pyserial-asyncio-fast`, exists (referenced in a Home Assistant developer
blog post from January 2026), but it's newer and its own track record is
thin.

**Decision: don't take on an async-serial dependency at all.** Keep plain
`pyserial` — the actual standard, extremely mature, BSD-licensed — and
wrap its blocking reads/writes in `asyncio.to_thread`/`run_in_executor` to
sit inside the `aiohttp` event loop. One fewer dependency to audit and
re-check for abandonment later, at the cost of writing the thread-executor
wiring by hand — a small, one-time cost against a recurring maintenance
question.

**pyserial's own maintenance profile, checked rather than assumed:** no
new PyPI release in roughly the past 12 months, current stable is still
3.5, a small contributor base (≤10). Worth reading with the same nuance
`rete-migration-decision.md` applied to `rete` itself rather than treating
low commit velocity as abandonment on its own — serial port I/O over a
handful of OS backends (POSIX termios, Windows COM) is a narrow, largely
solved problem, the kind of API surface that plausibly *should* stop
changing once correct, not a signal of neglect. No known vulnerabilities.
Still the right choice: it's the option with the most accumulated
real-world fixes for exactly the chipset/OS quirks below, which matters
more here than release recency.

## 5. Serial-handling pain points — known, and treated as fault-handling requirements, not surprises

Raised by Mike this session ("serial is always a pain in python"), and
right to take seriously rather than wave off — this is largely inherent
to USB-serial as a domain, not a pyserial defect, but the project's own
fault-handling priority (CLAUDE.md) means these get named now rather than
discovered hands-on the way POC-D discovered the device-side equivalents
(§5's listener-task hardening: never die from an unhandled exception,
bound every blocking read, don't assume a specific-byte-count read is
safe). **The backend's serial-handling code needs the same symmetric
treatment the device-side listener already got, not weaker treatment just
because it's off-device:**

- **DTR/RTS-triggered auto-reset on port open.** Many dev boards (the
  ESP32-family boards §3 targets included, depending on the specific
  board's auto-reset circuit) reset when DTR/RTS toggle during connection
  — `pyserial`'s default `Serial()` open can trigger this unexpectedly.
  Needs explicit `dsrdtr`/`rts`/`dtr` handling, and it's genuinely
  board-dependent — a real hands-on check per target board, not something
  to get right from documentation alone, consistent with this project's
  standing "verify on hardware" pattern.
- **Cross-platform port identity is inherently messy.** `/dev/ttyUSB0`
  (Linux) vs. `/dev/cu.usbserial-*` (macOS — `/dev/tty.*` blocks on DCD
  and should be avoided) vs. `COMn` (Windows, can renumber across
  replugs). `serial.tools.list_ports` helps enumerate by VID/PID, but
  doesn't fully resolve ambiguity when more than one compatible device is
  attached — the editor/backend will need its own device-picker UX for
  that case, not a library fix.
- **Disconnect must not wedge the relay.** A physical unplug mid-session
  has to degrade the same way §5 already requires of the device-side
  listener: caught, logged, structured, the rest of the process kept
  alive — never an uncaught `SerialException` taking down the backend
  process or hanging a request.
- **Permissions and drivers are a docs problem, not a code one, but worth
  naming so they aren't rediscovered as a support burden:** Linux needs
  the user in the `dialout` group (or equivalent udev rule); Windows
  needs the right driver for common USB-serial clone chipsets (CH340,
  CP2102) on cheap dev boards. Belongs in eventual install/setup docs,
  flagged here so it's remembered when those get written.

## 6. Licensing — checked against §12's constraint

Design doc §12 requires every dependency to carry a permissive,
OSI-approved license. Checked this session: `aiohttp` is Apache-2.0/MIT
(dual), `pyserial` is BSD (3-clause, same as `pyserial-asyncio-fast` were
it used instead). Both clear the bar. Not yet added to
`docs/third-party-licenses.md` — that ledger tracks what's actually
installed, and nothing has been installed yet; add them in the same change
that actually adds the dependency, per CLAUDE.md's existing convention for
npm packages, worth applying with the same care to pip packages once this
is built (check maintenance activity, note any install/build scripts,
prefer fewer dependencies — the same reasoning that ruled out
`pyserial-asyncio`).

## 7. What this deliberately does not decide

- **Perimeter 1 — editor ↔ backend auth** (Node-RED's `adminAuth`
  problem). `transport-auth-design.md` scoped this out explicitly; still
  open, still needs its own pass.
- **The WebSocket wire protocol's exact shape** between browser and
  backend. §13's CBOR framing is defined for editor↔device; whether the
  backend relays those frames verbatim over the WebSocket or wraps them in
  something else isn't decided here.
- **Packaging/distribution mechanics** — pip install, a frozen
  PyInstaller-style build, or something else. Flagged as the thing
  `working-notes/deployment-and-distribution-notes.md` already has a
  stale premise about (its "static site for editor hosting" item assumes
  the old pure-browser architecture); that note still needs its own
  update pass, not done here.
- **Where the backend actually runs relative to the editor** in the two
  postures `rete-migration-decision.md` named (localhost-behind-a-VPN vs.
  LAN-exposed-with-auth) — recorded there, not re-decided here.

## 8. Design doc changes this implies

None, deliberately. §4's 2026-08-16 update already describes "a thin local
backend, Node-RED's model" without naming a language or framework, and
that's the right level of detail for the design doc — implementation
technology choices belong in working notes like this one, not the design
doc itself, the same way the design doc doesn't name Vite or Vue for the
editor either.
