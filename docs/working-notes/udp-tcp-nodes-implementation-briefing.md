# Briefing: UDP/TCP nodes — implementation

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything below is committed.** This
session's own output (RP2040 bring-up flow files/findings, an RP2350
briefing) was handed to Mike as finished files, not a diff, same pattern
as always — should already be committed if you're reading this, but
confirm rather than assume, per the standing rule every prior briefing in
this repo has carried.

Then read `docs/working-notes/mvp-feature-priorities.md`'s Tier 1 item 5,
point 3 **in full — decision-complete as of 2026-08-17, this session
implements against it, doesn't re-derive it.** `docs/thingstudio-design-
doc.md` §6's 2026-08-17 addendum (the bullet starting "Raw UDP/TCP sockets
are promoted to a firm v1 node") is the design-level version of the same
call. `docs/working-notes/node-definition-model.md` and
`editor/src/compiler/node-definition.ts` for the current node-authoring
contract — four codegen patterns now (`source`/`transform`/`sink` plus the
event-source pattern the interrupt node introduced), all four already
exist and need no compiler changes for this session's work as currently
scoped (see the open design question below on TCP listen-receive, which
might be the exception).

## What kind of session this is

Implementation — the first real code against item 5's UDP/TCP resolution.
**Four new node types, deliberately scoped out of the interrupt-node
session as its own future work**, on the same "genuinely new technical
territory" footing that session's own briefing used to justify not
attempting everything in one sitting. Worth reading that footing
seriously here too, not just inherited as boilerplate: this batch has a
real, currently-unresolved MicroPython-level gap (below) that the
interrupt node's IRQ research didn't have an equivalent of — `asyncio`'s
own hard-IRQ-safe primitive already existed and just needed verifying;
raw UDP under `asyncio` has no equivalent clean primitive to verify, it
has to be designed.

**Scope-split judgment call, worth making explicitly rather than assuming
one sitting covers all four:** UDP send and UDP receive are the smaller,
more self-contained pair — no connection-cache machinery, mostly
reusing established source/sink codegen shapes as-is. TCP send and TCP
listen-receive are the harder pair — TCP send needs a genuinely new
shared module (the lazy-expiry connection cache, below), and TCP
listen-receive needs a design decision this session has to make, not
just implement (also below). If time is short, doing UDP send/receive
first and leaving TCP for its own follow-up mirrors how the interrupt
node session split away from the rest of item 5 rather than forcing
everything into one chat — but that's this session's call to make once
it's actually in progress, not decided in advance here.

## Scope clarification worth stating plainly

All four of these nodes need a network interface — they're moot on a
board with no radio at all (plain Pico/Pico 2, RP2040/RP2350 non-W). Real
hardware testing for this batch belongs on the ESP32-C3 rig
(`test/hil/`'s existing witness+DUT setup already has network
connectivity via that board's WiFi) or a Pico W/Pico 2 W if one's in
hand, not the plain-Pico rig this session's predecessor just finished
with. Also unlike the interrupt node's button-press hands-on pass, a real
test here needs a real network peer — a local UDP/TCP echo server or
listener on Mike's own machine, not the witness GPIO rig, which has no
way to originate/receive network traffic. `http-request.ts`'s own test
file (`editor/test/node-http-request.test.ts`) already hit this same
requirement — its header notes needing a local Node test server with an
explicit `Content-Length` header to be usable against that client. Same
shape of setup will be needed here (a local Node or Python UDP/TCP
listener script for the hands-on pass), not the ESP32-C3 witness rig's
`DRIVE_GPIO`-style commands.

## What to actually do

1. **UDP send** (`editor/src/node-library/udp-send.ts`, sink). Simplest
   of the four — no connection state (UDP has no connect step). Properties:
   `host`, `port`, maybe nothing else beyond `msg.payload`. Codegen:
   `socket.socket(socket.AF_INET, socket.SOCK_DGRAM)` once at setup
   (module-scope statement, same dedup-by-key pattern every other node
   here uses), `sock.sendto(<payload-as-bytes>, (host, port))` in the
   sink body. Reuse `mqtt-shared.ts`'s `payloadToBytesSnippet` pattern
   (or lift it to a shared `py-literals.js`-adjacent helper if it's
   generically useful across all four new nodes — check whether it's
   already exported somewhere more general before duplicating it a third
   time). Bound the send with `asyncio.wait_for` per `CLAUDE.md`'s
   fault-handling priority, matching `http-request.ts`'s convention, even
   though a UDP `sendto` to a local buffer rarely blocks in practice —
   "rarely" isn't "never," and the existing convention already pays this
   cost everywhere else network I/O happens.

2. **UDP receive** (`editor/src/node-library/udp-receive.ts`, source).
   **Real open research question, not just implementation** — see below.
   `bytes` payload, no parsing (matches design doc §6's "not validating
   payload content" stance).

3. **TCP send** (`editor/src/node-library/tcp-send.ts`, transform).
   Shaped like `http-request.ts` almost directly — reuse its
   `asyncio.open_connection`/`asyncio.wait_for` pattern (that file is the
   right template to read first, not `mqtt-publish.ts`, despite TCP send
   needing a connection cache like MQTT's). New shared module needed
   (e.g. `tcp-shared.ts`, mirroring `mqtt-shared.ts`'s structure): a
   lazy-expiry connection cache keyed per `host:port` (not per broker),
   double-checked-locking connect snippet adapted from
   `mqttEnsureConnectedSnippet`, plus **one staleness check against an
   N-second budget** (the concrete addition item 5's write-up calls for
   beyond MQTT's own pattern, since MQTT's client owns its own
   reconnect/keepalive state machine and a raw TCP socket cache doesn't).
   Proactive expiry (closing an idle connection with no further traffic)
   stays v2 per the design doc — this session only adds the
   check-on-next-use staleness path, not a background expiry task.

4. **TCP listen-receive** (`editor/src/node-library/tcp-listen-receive.ts`,
   source). **Real design question, not just implementation** — see
   below. `uasyncio.start_server` accepts concurrent connections without
   a hand-rolled poll loop, but bridging its callback-per-connection shape
   into this project's "one coroutine, one `msg` per wake" source model
   needs a real decision. `maxConnections` property (default 10) as the
   resource-exhaustion bound (§5's fault-isolation framing, not content
   filtering — the design doc is explicit that an open listening port
   is an acknowledged attack-surface fact, not something this project is
   trying to firewall).

## Worth flagging explicitly, not resolving silently

- **`asyncio`'s own UDP support is a confirmed, currently-open gap, not
  an oversight in this project's design.** Verified against
  [MicroPython issue #13382](https://github.com/micropython/micropython/issues/13382)
  ("Asyncio's UDP API," open as of this research): unlike TCP's
  `open_connection`/`start_server`, `asyncio` has no first-class datagram
  primitive on any port, including rp2/esp32. The practical default,
  consistent with `CLAUDE.md`'s "cheapest implementation that's actually
  correct" principle and not a new compiler pattern: a non-blocking UDP
  socket (`sock.setblocking(False)`), polled inside the existing
  `SourceCodegenResult`/`repeatMs` shape (a short interval, try/except
  around `recvfrom()` catching the expected `OSError`/`EAGAIN` when
  nothing's pending) — the same poll-loop shape `wifi_status`/
  `mqtt_subscribe`'s mandatory-yield already use, not the newer
  event-source pattern, since there's no real external event/flag to
  wait on here the way the interrupt node's `ThreadSafeEvent` is one.
  This doesn't foreclose a cleaner implementation later if `asyncio`
  gains real UDP support upstream — it's purely internal codegen, no
  flow-author-visible API changes if it's swapped out — so it's a safe
  cheap-now choice, not a one-way door. State this reasoning in the
  node's own header comment when built, the same way `interrupt.ts`
  documents its own debounce-algorithm choice, so the next person doesn't
  have to re-derive it.

- **TCP listen-receive's callback-to-coroutine bridge is a real design
  gap, not a known pattern to copy.** `uasyncio.start_server(handler,
  host, port)` invokes `handler(reader, writer)` per accepted connection
  — that's not naturally "one coroutine awaits the next message," it's
  "a new coroutine per connection." The shape this session likely wants:
  spawn `start_server` once at setup (a background task, not the node's
  own source coroutine), have its handler read messages from each
  connection and push them onto a shared queue (mirroring
  `mqtt-subscribe.ts`'s `client.queue.__anext__()` pattern — an actual
  multi-item queue, not a single flag, since concurrent connections can
  produce a burst), and have the source node's own coroutine simply await
  the next queue item. Whether that queue is a hand-rolled fixed-capacity
  ring buffer or something reusable is this session's call — check
  whether `micropython-async`'s already-vendored-adjacent
  `ThreadSafeQueue` (same package `ThreadSafeEvent` came from, not
  currently vendored) fits, or whether a plain `list` + `asyncio.Event`
  is enough for single-core, non-IRQ producer/consumer (no thread-safety
  concern here the way the interrupt node had, since `start_server`'s
  handler runs as an ordinary coroutine on the same event loop, not in
  hard-IRQ context — a real, worth-stating distinction from why
  `ThreadSafeEvent` was needed at all last time).
- **Per-connection read timeout on TCP listen-receive isn't resolved by
  `maxConnections` alone.** The connection-count bound stops resource
  *exhaustion* from too many connections; it doesn't stop one slow or
  silent client from holding a connection (and its task) open
  indefinitely without sending anything. §5's fault-isolation priority
  says this needs a bounded read the same way `http-request.ts` bounds
  every network read with `asyncio.wait_for` — decide the actual timeout
  value and behavior on expiry (close the connection? or is an
  indefinite listen the intended behavior for a "wait for a client to
  say something" node?) rather than leaving it implicit.
- **Not a firewall, restated so it isn't quietly reversed while building
  this**: `mvp-feature-priorities.md` and the design doc addendum are
  both explicit that payload content isn't validated or gatekept on
  either protocol (Mike's own call, on record) — don't add validation
  that wasn't asked for, but do keep the one-line attack-surface
  acknowledgment (open listening port) somewhere visible, matching how
  every other network-facing node in this library states its own real
  limitations plainly (see `http-request.ts`'s header for the pattern).

## Stop conditions

- `uasyncio.start_server` turns out unavailable or behaves meaningfully
  differently across the two network-capable target families (ESP32,
  Pico W/Pico 2 W) — the premise TCP listen-receive rests on; stop and
  reconsider rather than working around a missing primitive silently.
- Any existing test suite needs modifying (standing condition every
  prior session has used).
- The UDP non-blocking-poll workaround turns out to not actually work
  cleanly on-device (e.g. `EAGAIN` isn't raised the way expected, or the
  poll interval needed to avoid missing datagrams is uncomfortably tight)
  — that's real research this session does on real hardware before
  committing to the pattern, not something to assume from the desk
  research above alone.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — standing sandbox
  bug, unchanged.
- **`npm test`/`vite build`/`npm run dev` still can't run from the
  sandbox** (Mac-only native bindings) — `tsc --noEmit` is the
  sandbox-side check, Mike's own build-and-run pass is the real one.
- **A real hardware pass needs a network-capable board and a real network
  peer** — not the plain-Pico rig or the ESP32-C3 witness GPIO rig as-is;
  see the scope clarification above.
- **Prompt Mike to commit at natural boundaries** — UDP pair landed, TCP
  pair landed (if attempted same session), tests passing, each a
  reasonable stopping point independently.

## Not in scope for this chat

- Any node work outside these four.
- TCP send's proactive (closes-even-if-idle) connection expiry —
  explicitly v2, unchanged from item 5's own scoping.
- mDNS, on-device HTTP server, file ops — resolved away or deferred
  elsewhere already; not this session's job to revisit.
- Deciding whether raw UDP/TCP should ever get payload validation —
  already decided (no), not open for silent reversal here.

## Success criteria

Four new node types registered (`thingstudio/udp_send`,
`thingstudio/udp_receive`, `thingstudio/tcp_send`,
`thingstudio/tcp_listen_receive` — or however they end up named, matching
this library's existing `snake_case` type-string convention), each with a
real codegen implementation matching the shapes above, `tsc --noEmit`
clean, off-device tests for each (matching the
`editor/test/node-<type>.test.ts` pattern every existing node type has).
UDP's non-blocking-poll pattern's real-hardware behavior confirmed, not
just desk-researched. TCP listen-receive's callback-to-queue bridge
designed and built, with a real per-connection read timeout, not left
implicit. A real hands-on pass against an actual local UDP/TCP peer
(Mike's own machine, not the witness rig) for whichever subset of the
four actually gets built this session.

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
