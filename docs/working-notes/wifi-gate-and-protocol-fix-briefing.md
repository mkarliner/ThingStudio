# Briefing: wifi_gate node, WiFi-provisioning hardening, and a real-hardware protocol
# bug fix -- landed and committed

For the next chat. Read `CLAUDE.md` in full, as always -- it picked up a new "Behavior
Preferences" note and an `@AGENTS.md` reference since the last handoff doc (`AGENTS.md`
itself is currently an empty placeholder, nothing to act on there).

**Everything below is committed.** Tip as of this writing: `0ea4dfb` ("Fix DEPLOY encoder
sending CBOR null (device decoder can't parse it)"). Working tree is fully clean -- no
untracked files either (the old scratch `test-flows/untitled-flow.flow.json` the prior
handoff flagged is gone; Mike must have cleared it himself, nothing to follow up on).

Note: a handful of small, unrelated commits (`992b1de`, `12e2177`, `5857f51`, `e86395b`,
`67c838f`, `9b5e684` -- a Cancel-button standardization, an inject.md/viewport-jump fix, the
prior handoff doc itself, a scratch multi-pane test flow, `AGENTS.md`) landed between the
credential-store session and the work below. None of it is this session's own doing and none
of it is touched by anything here -- flagged only so the commit log doesn't look surprising.

## What landed this session

**1. WiFi self-provisioning hardening (real-hardware bugfixes, not new scope).** Two issues
Mike found testing the captive-portal feature on real hardware: a reported "joins the wrong
network" bug turned out to be a misread transient state, not a real defect (traced via code +
a clean console transcript, no fix needed); a real scan-only-finds-one-network bug was
root-caused (with Mike's own research) to `WIFI_FAST_SCAN`, ESP-IDF's default scan mode,
which isn't reachable from MicroPython's `network.WLAN` API -- fixed with a manual-SSID-entry
fallback on the provisioning portal's form (`device-runtime/src/wifi_provision.py`), not a
chase for the underlying scan-mode toggle (`CLAUDE.md`'s board-idiosyncrasy corollary).
Also added a dedicated `docs/user-guide/wifi-provisioning.md` page (setup network, manual
entry, the reprovisioning fallback and its trusted-network caveat, the AP-password mpremote
workaround). Full trail: `outstanding-items/wifi-provisioning-captive-portal.md`'s
"Real-hardware follow-up, 2026-09-14" section. Commits `fe94325`, `2fc376b`.

**2. `thingstudio/wifi_gate` -- pass-or-drop WiFi-link status gate, built end-to-end.** The
pass-or-drop half of the long-standing "connection-state gate/router nodes" item
(`outstanding-items/connection-state-gate-router-nodes.md`). Scoped to WiFi link state only
(Mike's explicit call, asked via `AskUserQuestion` before implementing -- "WiFi link only"
over a WiFi+MQTT-broker-aware version). One input, one output: passes `msg` through unchanged
when `_wifi_sta.isconnected()` is true at message-arrival-time, drops it (same mechanism a
`function` node's own `return None` uses) otherwise -- checks live link state per message, not
a value read off `wifi_status`'s own (emit-on-change-only) output, so a fast-firing source
gated off it can't see stale state. No properties; derives WiFi credentials from the flow's
own sole `wifi_status` node, same pattern every other network node type already uses. Full
canvas wiring (registry, Rete class, palette entry, property panel, flow-file verifier), a
vitest suite run against real generated Python (`pymock`'s `network.WLAN.CONNECTED` toggle),
and a user-guide page (`docs/user-guide/nodes/wifi-gate.md`). The item's other original ask --
a dedicated router/switch node -- stays open, deferred to **POST-MVP** (Mike's call, 2026-09-14:
a `function` node's own multiple outputs plus an in-code switch already cover that need).
Commits `f877b05`, `2be747d`.

**3. `test-flows/wifi-gate-test.flow.json` + real-hardware smoke test, confirmed by Mike.**
Two chains off one shared `wifi_status` node: `wifi_status` -> `debug` (link-state reference)
and `timer` (2s) -> `wifi_gate` -> `debug` (a counter that should only reach the second debug
node while connected). Verified via `verify-flow-file.ts`, a real `compile()` dry run, and
then an actual deploy-and-run on Mike's board ("ok smoke test works"). **Not yet separately
confirmed:** the specific pass-vs-drop behavior on an actual link drop/reconnect -- the smoke
test confirms it deploys and runs cleanly, not that the gated stream visibly stops and resumes
as designed. Worth a quick real check next time Mike has the board handy (power off the AP or
walk out of range, watch both debug streams, per the file's own "What to watch for" section in
`test-flows/README.md`). Commit `39714ad`.

**4. Real, hardware-confirmed protocol bug found and fixed -- not specific to wifi_gate.**
`wifi-gate-test.flow.json`'s first deploy attempt crashed the device's decoder
(`LISTENER_ERR protocol MessageDecodeError(... "unsupported CBOR simple/float value ...")`).
Root cause: `editor/src/protocol/codec.ts`'s `encodeMessageBody()` never filtered `null`-valued
fields before CBOR-encoding a message, and the device's hand-rolled CBOR decoder
(`device-runtime/src/cbor.py`) has never supported decoding a CBOR null at all -- by design,
optional fields are meant to be omitted from the map entirely. `device-runtime/src/messages.py`
already carried the matching filter on its own (device-to-editor) encode path, with a comment
citing an identical 2026-09-05 bug for HELLO's `runtimeBuild` field -- that fix was simply never
mirrored to the editor's (editor-to-device) encode path. `DEPLOY`'s other nullable fields
(`flowName`/`deployId`) never surfaced this in practice since a current editor always
populates them; `wifiProvision` (added the same day as item 1 above) is the first field that's
genuinely, routinely null in the ordinary case, so it's what finally tripped this. Notably, the
existing `protocol.roundtrip.test.ts` already had null-valued sample messages and passed
anyway, since that test round-trips entirely through the editor's own encoder/decoder (`cborg`
happily decodes its own CBOR null) -- it never actually exercised the device's stricter
decoder. Fixed: `encodeMessageBody()` now strips null-valued keys, mirroring `messages.py`
exactly; a new structural regression test walks the decoded body recursively and asserts no
encoded message ever contains an actual CBOR null. Logged as a "learnings" entry too -- this is
the third occurrence of the same root pattern (two independently-tested sides of a wire
protocol agreeing with themselves but not each other), see
`learnings/backend-serial-wire-format.md`. Verified: `tsc --noEmit` clean, fresh `npm ci` +
vitest in an isolated copy of `editor/` -- 457/457 passing. Commit `0ea4dfb`.

## Open threads carried forward, not fully closed

- **`wifi_gate`'s pass-vs-drop behavior itself** -- deploys and runs, per the smoke test, but
  the actual gating behavior (stream stops on disconnect, resumes on reconnect) hasn't been
  watched on real hardware yet. Low risk (the vitest suite exercises this against real
  generated Python already), but worth the five minutes next time the board's in hand.
- **An MQTT-broker-specific gate** (WiFi up but a specific broker unreachable) was explicitly
  flagged as a separate, still-open follow-up if finer granularity than link-level ever turns
  out to matter -- not scoped, not built, no urgency signaled by Mike either way.
- **Router/switch node stays POST-MVP** -- Mike's call, not being pursued now. See item 2 above.
- **`mikes-questions-and-points.md`'s "## Nodes" scratch note** (Button/Switch/ADC, Peter
  Hinch's driver-based nodes) -- flagged in the *prior* handoff (`credential-store-
  implementation-briefing.md`) as a duplicate of the already-tracked **[P4] eswitch/ebutton**
  item, never folded in. Still sitting there untouched -- still worth doing next time someone's
  in that file.
- **Real vitest coverage is solid for this session's own work** (457/457, fresh `npm ci`), but
  nothing backend-side (`pytest`) was touched or re-run -- no backend code changed this
  session, so no gap, just noting the "confirm both suites" bar from the prior handoff wasn't
  fully re-established, only the editor half.

## Suggested next-session candidates

Pulled from `outstanding-items.md`'s current priority tags, unchanged by this session's own
work (none of it came from this backlog) -- see that file directly for the complete picture,
this is not a re-audit:

1. **Node-status-indicators' still-owed tail** (P2, otherwise landed) -- the real MicroPython
   unix-port test suite for the device-runtime changes, a `vitest` re-run against the updated
   mqtt/wifi codegen, a hardware check of `mqtt_publish`'s connected/disconnected reporting
   once it's published at least once, and clear-on-redeploy. ([detail](outstanding-items/node-status-indicators.md))
2. **Context model, Node-RED-style** (P2) -- `variable_get`/`variable_set` hidden from the
   canvas since 2026-09-06, replacement (node/flow/global scope, a generic context node) not
   scoped yet. ([detail](outstanding-items/context-model-node-red-style.md))
3. **TCP send / TCP listen-receive** (P3) -- the UDP/TCP batch's last unbuilt piece.
   ([detail](outstanding-items/tcp-send-listen-receive.md))
4. **I2C/SPI sensor nodes** (P3) -- not started, gated on having sensor hardware on hand; also
   carries an unresolved stuck-I2C-device fault-handling question.
   ([detail](outstanding-items/i2c-spi-sensor-nodes.md))
5. **machine.reset() before each deploy** (P3) -- Mike's own raised item, not yet scoped past
   the tradeoff analysis already written up. ([detail](outstanding-items/reset-before-deploy.md))

Not picked for this shortlist but still live: everything else in `outstanding-items.md`'s
"Network / config nodes", "UI / editor", "Redeploy / runtime", and "Backend / auth" sections --
none of it touched by today's session either.

## Not in scope for this chat

- `wifi_gate`'s own live drop/reconnect confirmation -- needs Mike with the board, not a guess.
- The MQTT-broker-specific gate follow-up -- not asked for, not scoped.
- Any of the backlog items above -- today's session was WiFi-provisioning hardening,
  `wifi_gate`, and the protocol fix it surfaced, nothing else.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact
commands to run himself, never executed from the sandbox. Read-only git commands
(`status`/`log`/`diff`) are fine to run directly -- but even those reliably leave a stale
`.git/index.lock` behind on this shared-mount setup -- always tell Mike to
`rm -f .git/index.lock` before any commit attempt, regardless of what ran before it.

Working tree as of this writing: clean, nothing untracked.
