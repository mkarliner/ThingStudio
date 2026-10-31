# Briefing: credential-store implementation + UX fixes, landed and committed

For the next chat. Read `CLAUDE.md` in full, as always.

**Everything from this session is committed** -- tip is `712cded` ("Move WiFi/MQTT-broker secrets out of flow
files into a named credential store"), one commit (not split docs/code this time -- the doc changes were mostly
small, scattered updates to files the code changes themselves touched, not a separable unit). Working tree is
otherwise clean except one untracked scratch file, see "Git" below.

This was Mike's own fresh ask (`mikes-questions-and-points.md`: "Save credentials to persistence store in
.thingstudio, not in flow"), picked back up from the already-scoped-but-unbuilt
`outstanding-items/credential-storage-design.md` -- not drawn from this file's own "Next up" backlog. None of the
items that backlog already had queued (see "Suggested next-session candidates" below) were touched this session.

## What landed this session

**The feature itself (Option B, the whole bundle externalized):** WiFi/MQTT-broker config nodes no longer hold
real secret values at all. The actual `ssid`/`password` (WiFi) or `broker`/`port`/`username`/`password`
(MQTT-broker) bundle now lives in a new backend-owned, name-keyed credential store
(`~/.thingstudio/credentials/<type>/<name>.json`), referenced from the config node by a `credentialName` string.
A resolved credential's fields get merged into the same in-memory config `properties` object `resolveConfig()`
already reads (so `compile.ts` needed zero changes), but `extractConfigsSnapshot()` (`main.ts`) filters that
object back down to only the field names `config-types.ts` still declares before a flow saves -- a real secret
never round-trips into a committed `.flow.json`. Four decisions confirmed by Mike before any code was written
(Option B over partial-secrecy Option A; rename/delete out of scope for v1; a credential's value is shared by
every config referencing it by name, by design; resolution happens once at flow-load time) -- full record in
`outstanding-items/credential-storage-design.md`, which also now carries the "Built" + four rounds of UX-fix
notes below.

Backend: `PersistedStore.{list,read,write,delete}_credential` (`persisted_store.py`), four
`/api/credentials/{type}[/{name}]` routes (`admin_api.py`), matching test coverage (`test_persisted_store.py`/
`test_admin_api.py`).

Editor: `config-types.ts`'s wifi/mqtt-broker entries now carry only `credentialName` (+ `security` for wifi);
the real secret-shaped fields moved to a new `credential-types.ts` table; a new `CredentialRefField.vue`
(dropdown/pencil/+, backend-fetch-backed) renders inside `ConfigRefField.vue`'s edit panel for the new
`kind: "credential"` field kind; `admin-api-client.ts` grew matching CRUD functions; `main.ts`'s
`applyFlowFile()` calls a new `resolveConfigCredentials()` right after configs load (a missing/unreachable
credential logs a clear, attributed console error rather than failing silently, per this project's standing
fault-handling priority).

**Real-data migration:** six committed test-flow files already had Mike's actual home WiFi/MQTT-broker
credentials sitting in plaintext (`basic-mqtt`, `basic-http-request`, `basic-http-in`, `wifistatus`,
`badcredentials`, `udp-echo-tester`) -- confirmed with Mike before touching anything, then migrated: real values
seeded into `~/.thingstudio/credentials/{wifi,mqtt-broker}/<name>.json` on Mike's machine (`mihome`,
`mihome-wrong-password` for the deliberately-invalid-password test flow, `your-wifi` for the one file that only
ever had `YOUR_WIFI_SSID`/`YOUR_WIFI_PASSWORD` placeholders, `lan-mqtt-broker`, `verdi-mqtt-broker`), flow files
rewritten to hold only `credentialName`/`security`. `test-flows/README.md` updated to match (it used to tell
readers to edit ssid/password directly in a flow's own `configs` array -- no longer true).

**Docs:** `docs/user-guide/canvas-basics.md`'s "Config nodes" section and `docs/user-guide/flow-lifecycle.md`
(the "what still lives on the backend" line) rewritten; `docs/thingstudio-design-doc.md` §6's config-node
paragraph updated to describe the credential-store mechanism instead of the old inline `{ssid, password}` shape
-- this was folded into the same commit since the design-doc trim from earlier in the session (removing
historical narrative and closed-decision rationale, per Mike's own explicit feedback -- see that trim's own
context if picking this up fresh) touched the same file.

**Four rounds of UX fixes, all from Mike's own hands-on browser testing today, not code review** -- worth
reading in order since each one only surfaced once the previous fix was in place:

1. **Double-save confusion.** The outer config edit panel had its own Save button stacked on top of
   `CredentialRefField.vue`'s own nested Save for the credential -- two Saves doing two different things read as
   one confusing double-save. Fixed: outer panel auto-saves on every change (`watch(draft, ..., {deep: true})`),
   dropped to a single "Close" -- the only explicit Save left anywhere is the credential's own, which is
   unavoidably a real backend call. **Open tension, not resolved:** this cuts against Mike's own still-standing
   note in `mikes-questions-and-points.md` ("close is just to escape without saving") for this one panel
   specifically. Flagged to him directly; no response yet either way. If picking this up, either get an explicit
   answer or leave as-is -- don't silently change it back.
2. **"+" created an anonymous config**, forcing a second, nested "+" inside it just to name a credential. Fixed:
   `addNew()` now opens one combined form (name + the credential type's own fields + any other config-level
   fields like `security`) with a single Save, creating the credential and the config together. A config type
   with no credential field (none exist today) falls back to the original create-then-edit behavior.
3. **Empty dropdown on a fresh canvas** despite already-saved credentials existing in the backend. Fixed:
   `options` now merges this flow's own configs with every backend credential name not already referenced by one
   of them -- picking one auto-provisions (or reuses) a config on the spot. Fetched once on mount and again after
   this widget's own `saveNew()`; does **not** react to a credential created elsewhere in the same session (a
   page reload picks it up) -- accepted for now.
4. **Form layout, panel width, no "unmanaged" option** -- three smaller ones landed together: (a) plain
   `<label>{{f.label}}<input></label>` fields ran together as one paragraph rather than one row per field (a
   nested component doesn't inherit `PropertyPanel.vue`'s own `label { display: block }` scoped rule) -- fixed
   with a `.field-row` flex class in both `ConfigRefField.vue` and `CredentialRefField.vue`; (b) property panel
   widened 260px -> 340px (`PropertyPanel.vue`) -- it already collapses to a thin rail when nothing's selected,
   so little of the usual space tradeoff applies; (c) `security: "unmanaged"` needs no credential at all, but
   once "+" required a name to create anything (fix 2, above), there was no way to reach it from a blank canvas
   -- fixed with a synthetic "Unmanaged (...)" dropdown entry, derived generically from config-types.ts's own
   field/option data (not hardcoded to WiFi), that creates a credential-less config directly.

Full detail on all of the above, in the order it actually happened: `outstanding-items/credential-storage-design.md`'s
"Built" section and its four numbered UX-fix addenda.

## Open threads carried forward, not touched this session

- **The save/close auto-save tension** (fix 1, above) -- flagged to Mike directly mid-session; no reply in
  chat, but while this briefing was being written he removed his own "close is just to escape without saving"
  note from `mikes-questions-and-points.md` (that file's own convention: items get removed once resolved or
  tracked elsewhere). Best read as tacit acceptance of the auto-save behavior as shipped, not as an explicit
  confirmation -- worth a quick check-in next session rather than either assuming it's settled or re-raising it
  as if nothing happened.
- **`mikes-questions-and-points.md` grew a new "## Nodes" section this session** (Button/Switch/ADC, Peter
  Hinch's driver-based nodes) -- added by Mike concurrently, not this session's own work. Looks like a fresh
  reminder of, not new scope beyond, the already-tracked **[P4] eswitch/ebutton nodes** item
  (`outstanding-items.md`, folds in his ADC-monitoring driver too) -- worth folding this note into that item and
  clearing it from the scratchpad next session, rather than treating it as a new ask.
- **No automated `.vue` component test coverage exists in this project** (confirmed by grep in an earlier
  session) -- every one of today's four UX-fix rounds was verified by `tsc --noEmit` (clean each time) plus
  Mike's own hands-on browser testing, never by an automated test. Don't trust a clean `tsc` run alone for a
  future change in this area.
- **Real backend/editor test suites (`pytest`, `vitest`) were never confirmed run this session** -- only
  `tsc --noEmit` (clean, every round) and `python3 -m py_compile` (syntax-only) from the sandbox, per the
  standing macOS-native-venv/shared-`node_modules` restrictions. Worth confirming green before trusting this
  feature is fully regression-safe, especially given point above.
- Everything in this file's own "Next up"/priority sections below was untouched by this session -- see the
  prior handoff (`palette-ordering-and-multi-panes-landed-briefing.md`) for what was already open going into
  today; nothing here changed that picture except adding the two threads just above.

## Suggested next-session candidates

Pulled from `outstanding-items.md`'s current priority tags, highest first -- unchanged by this session's own
work, since that work came from outside this backlog:

1. **`mqtt_publish`/`mqtt_subscribe` boot-race** (P4) -- suspected missing publish-after-subscribe-confirmed
   ordering guarantee, implicated in an unconfirmed real-hardware silent failure, 2026-09-02.
   ([detail](outstanding-items/mqtt-pubsub-boot-race.md))
2. **TCP send / TCP listen-receive** (P3) -- the UDP/TCP batch's last unbuilt piece. TCP send needs a
   lazy-expiry connection cache; TCP listen-receive needs a callback-to-coroutine bridge design.
   ([detail](outstanding-items/tcp-send-listen-receive.md))
3. **I2C/SPI sensor nodes** (P3) -- not started, gated on having actual sensor hardware on hand; also carries
   an unresolved stuck-I2C-device fault-handling question. ([detail](outstanding-items/i2c-spi-sensor-nodes.md))
4. **WiFi provisioning / captive portal** (P3) -- scan-at-runtime, pick-from-a-dropdown; needs its own scoping
   session before it's buildable. ([detail](outstanding-items/wifi-provisioning-captive-portal.md))
5. **RP2350 bring-up continuation** (P5) -- gated on Mike's own timeline to wire the button for the interrupt-flow
   pass and memcheck comparison. ([detail](outstanding-items/rp2350-bringup.md))

Not picked for this shortlist but still live: everything else in `outstanding-items.md`'s "Network / config
nodes", "UI / editor", and "Backend / auth" sections -- see that file directly for the full current picture
(context model, low-memory warning, board-specific node collections, posture-2 auth, etc.), none of it touched
by today's session.

## Not in scope for this chat

- The save/close auto-save tension -- needs Mike's own answer, not a guess.
- Any of the backlog items above -- today's session was entirely the credential-store feature and its
  follow-on UX fixes.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are fine to run
directly -- but even those reliably leave a stale `.git/index.lock` behind on this shared-mount setup (confirmed
twice more this session) -- always tell Mike to `rm -f .git/index.lock` before any commit attempt, regardless of
what ran before it.

Working tree as of this writing: clean except one untracked file, `test-flows/untitled-flow.flow.json` -- looks
like Mike's own scratch save from testing today (a lone `wifi_status` node), deliberately left alone rather than
added or deleted. Worth a glance next session in case it's meant to be kept, renamed, or just deleted.
