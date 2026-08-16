# Working note: Rete migration — decision and scoped plan

Status: decision + plan, 2026-08-16. Answers
`rete-migration-planning-briefing.md`'s two open questions. Supersedes
design doc §11's "resolved 2026-08-11 per POC-C: Litegraph.js" (the
*library* call only — POC-C's comparison method and its Drawflow findings
stand). Planning session only: no migration code was written, by the
briefing's own scope.

Reading this note assumes `pocs/poc-rete/README.md`'s verdict and
`mvp-feature-priorities.md`'s Tier 3 "Real editor shell" entry. It does
not restate them.

---

## Decision 1 — how to get to Rete

**The briefing's framing (from-scratch vs. migrate incrementally) is a
false binary, and the coupling evidence is what shows it.** Neither
option is actually available in the form the question implies:

- *"Migrate incrementally"* normally means a coexistence period — old and
  new running side by side, cut over piece by piece. That is not
  reachable here. Litegraph and Rete both want to own the same canvas
  element, the same pointer events, and the same graph state. There is no
  half-migrated canvas. The one file that has to change (`app/nodes.ts`)
  changes all at once or not at all.
- *"From scratch"* implies rebuilding `editor/` — which would be
  destructive. 3,652 lines of TypeScript live under `editor/src`, and the
  Litegraph-specific portion of it is roughly 190 lines.

**The decision: targeted replacement of the canvas layer, everything else
untouched.** Rebuild `app/nodes.ts` against Rete; replace the ~60 lines of
Litegraph glue inside `app/main.ts`; leave `compiler/`, `protocol/`,
`node-library/`, and `flow-file/flow-file.ts` alone entirely. This is
"from scratch" within a blast radius small enough that the phrase stops
being frightening, and "migrate" for everything outside it in the sense
that migrating it costs nothing because it was already decoupled.

### The evidence this rests on

The briefing asked for its coupling reading to be confirmed rather than
treated as settled, specifically flagging that `main.ts` had only been
grepped, not read. It has now been read in full. **The reading holds, and
is if anything understated.**

`main.ts` is 584 lines, of which the genuinely Litegraph-shaped parts are:

| Region | Lines (approx.) | Fate |
|---|---|---|
| `LGraph`/`LGraphCanvas` construction, `resize()`, `graph.start()` | ~20 | replaced |
| `addNode()` + toolbar button wiring | ~15 | replaced |
| `extractCanvasSnapshot()` — `node.pos` Float32Array copy, `graph.links` walk | ~16 | rewritten |
| `applyFlowFile()` — `LG.createNode`, `node.configure`, `connect()` | ~38 | rewritten |
| `allCanvasNodes()` / `clearNodeHighlights()` / `highlightNode()` | ~28 | rewritten (smaller) |
| `currentSource()`'s `graph.serialize()` call | 1 | adapter (below) |
| the 1s `refreshPreview` poll | ~3 | **deleted** |

Everything else in that file — the mpy-cross WASM loader and its
`window.__thingstudioCreateMpyCross` bridge, the device console, the
`HELLO`/version gate and its whole soft-on-absence/hard-on-mismatch
reasoning, `waitForMessage`, the Deploy handler, `highlightNodeFromMpyError`'s
line→node lookup, `highlightNodeFromNodeError`, the save/load button
orchestration — is canvas-agnostic and survives verbatim.

Two findings beyond what the briefing had:

**The 1s preview poll exists *because of* Litegraph and dies with it.**
Its own comment says so: "Litegraph 0.7.18 has no reliable 'graph changed'
callback worth depending on sight-unseen, so the preview is kept fresh by
a plain poll rather than an assumed hook." Rete's `editor.addPipe` — the
exact mechanism poc-rete's checkpoint 1 already proved against the real
installed package — sees every graph mutation. The migration deletes a
documented workaround rather than porting it. Small, but it's the
migration paying for itself somewhere instead of only costing.

**`applyFlowFile()` is a rewrite, not a port, and the briefing didn't
know why.** It leans on a specific Litegraph behavior its own docstring
calls out as verified-not-guessed: per-node `configure({properties, pos,
size})` syncs `node.properties` *and* each inline widget's displayed value
in one call. Rete has no widget layer to sync — which makes the
replacement simpler, not harder, but it does mean this function is
rewritten against a different model rather than translated. Its
fault-handling contract must survive intact: an unknown node type is
reported and skipped, along with any edge touching it, rather than
aborting the load. That behavior is CLAUDE.md's fault-handling priority
applied to file I/O and is not negotiable in the rewrite.

### What this decision is not

It is not permission to redesign the editor while the canvas is open. See
"Explicitly out of scope" below — that list is the load-bearing half of
this decision, because the realistic failure mode here is not the
migration being too hard, it is the migration quietly absorbing four
deferred items and becoming a rewrite after all.

---

## Decision 2 — app platform

**Recorded, decided by Mike this session: a thin local backend, Node-RED's
model, most likely Python.** Not Electron, not Tauri.

"Thin" is the load-bearing word and is part of the decision, not a detail:
the backend owns serial I/O, flow-file I/O, and static serving. The
compiler and the mpy-cross WASM build **stay client-side**. Moving codegen
into Python would rewrite ~1,800 lines of adversarially-tested,
hardware-validated Tier 0 work (`compile.ts`, `node-definition.ts`, 17
`node-library/*.ts`, ~20 test files) for elegance and nothing else — an
order of magnitude more work than this entire Rete migration.

### Why this doesn't block the Rete work

The two decisions touch disjoint halves of the same file. Rete replaces
the canvas glue; a backend replaces the transport glue
(`protocol/transport.ts`, `flow-file/file-io.ts`). They meet only in
`main.ts`'s top-level wiring. **Sequence them independently.**

`transport.ts` is already the single chokepoint, by design — its own
header states it is "intentionally the only place in `editor/src/protocol/`
that touches a real browser API (`navigator.serial`)," and `WebSerialPort`
is a hand-rolled 4-member structural interface, not `@types/web-serial`.
A backend swap is one ~230-line WebSocket sibling; `framing.ts`,
`codec.ts`, `messages.ts`, `protocol.ts`, `version.ts` and their five test
files are untouched. The `F64:`/base64 line framing also survives
unchanged, because it exists for a device-side reason (POC-D's `read(n)`
hang), not a browser one — pyserial would ride the same lines.

### One argument that has expired, worth recording so it isn't re-made

The obvious case for a backend used to include "escapes Chrome/Edge
lock-in." **That is now mostly false: Firefox 151 shipped Web Serial in
May 2026**, leaving only Safari without it. The File System Access API
*is* still Chromium-only (Firefox and Safari implement the Origin Private
File System but not `showSaveFilePicker`/`showDirectoryPicker`), so
Tier 3's save/load gap is real — but the transport half of the lock-in
argument has evaporated on its own and should not be cited going forward.

The argument that does hold: **§4 specifies v2 WiFi transport as "local
mDNS-discovered device."** No browser can do mDNS or raw UDP/TCP, in any
vendor, at any point. Today that is a cliff the current architecture walks
off at v2. A backend clears it, and partly pre-builds §10's v3 "companion
server" rather than being off-roadmap.

### The decisive argument (Mike, this session): remote access

Stronger than either of the above, and it does not appear anywhere in the
design doc yet. **A realistic deployment is a backend running wherever the
devices actually are — with serial or local-network access to them — and a
human driving the editor from a browser somewhere else.**

That use case is not merely awkward in the current architecture, it is
*impossible*. Pure-browser means the person must be physically sitting at
the machine with the USB cable in it, because `navigator.serial` is a
local-hardware API. A backend decouples "where the device is" from "where
the human is," which is a capability unlock rather than a packaging
convenience — and it reframes the whole platform question: Electron and
Tauri would *also* have failed this, since a desktop GUI app is just as
tied to the machine it runs on. Only the backend model satisfies it.

This also promotes §4's "companion server/relay is a reasonable v2
addition for team use, remote fleets" and §10's v3 "companion server for
team libraries and fleet deployment" from later-roadmap to
falls-out-of-the-architecture. Worth updating §4 to say so rather than
leaving the design doc describing a constraint the project has decided
against.

Tauri was ruled out on a specific technical ground rather than taste: its
system webview is WKWebView on macOS and WebKitGTK on Linux, neither of
which implements Web Serial. It forces the transport rewrite *anyway*,
while also adding Rust and keeping the full packaging/signing burden — it
costs what the backend costs plus what Electron costs.

### Security: two perimeters, not one (Mike, this session)

A correction to how this note's own author first framed it. Node-RED
provides username/password access to *the editor*; that is a different
perimeter from access to *the board runtime*, and a backend only
addresses the first one for free.

- **Editor/backend perimeter.** A listening socket that can push
  unsandboxed Python to hardware. This is a *new* attack surface the
  pure-browser architecture does not have, and it is an honest cost of the
  decision, not only a benefit.

  Given the remote-access use case above, **there are two supported
  deployment postures with materially different app-level requirements,
  and the design has to name which one it defaults to rather than
  assuming localhost:**

  1. *Network-secured* — backend bound to `127.0.0.1`, reached remotely
     over a VPN or an SSH tunnel (Mike's own note: "a VPN would allow
     localhost only access"). Security lives in the network layer. The
     app still needs `Origin`/`Host` validation against DNS rebinding,
     which is a real attack against localhost-bound services regardless of
     VPN, but it needs no TLS or account system of its own. Cheapest, and
     the right default.
  2. *App-secured* — backend bound to a LAN or public interface, reached
     directly. Now needs username/password or token auth, session/CSRF
     handling, and TLS (directly or via a documented reverse-proxy
     posture). Node-RED is the precedent to follow closely here rather
     than invent against: it binds broadly by default and documents
     `adminAuth` plus HTTPS as the thing you must turn on, which is
     exactly the shape of this problem.

  Recommendation, not yet decided: default to posture 1, make posture 2
  explicit opt-in that refuses to start without auth configured rather
  than starting insecure with a warning — CLAUDE.md's fault-handling
  priority applied to a security default, since "warns and continues" is
  how Node-RED-adjacent tools have historically ended up exposed.
- **Board runtime perimeter.** Mike's standing question from
  `mikes-questions-and-points.md` ("do we need a password for access to
  the board transport? ... at least basic security for the board from day
  1"), and his call this session that it wants password or public/private
  key auth. §9 currently answers this only for USB ("physical access as
  its natural gate") and defers WiFi pairing to v2. A backend does *not*
  answer it — the backend is just a new thing standing where the browser
  used to stand.

  **The remote-access use case invalidates §9's reasoning outright, and
  this is the sharpest consequence of Decision 2.** "USB serial in v1 has
  physical access as its natural gate" holds only while the person
  clicking Deploy is the person standing next to the board. Once the
  backend is remote-reachable, a USB-connected device is exposed to
  whoever can reach the backend — the physical gate protects the *cable*,
  not the *deploy path*. So board-runtime auth stops being defence in
  depth behind a strong perimeter and becomes the only perimeter left if
  the backend is ever compromised or misconfigured. That promotes Mike's
  "at least basic security from day 1" from a reasonable ask to a
  consequence of an architectural decision already taken.

  One constraint worth checking before scoping that, rather than assuming
  asymmetric keys are free: MicroPython's built-in `cryptolib` is AES
  only, with SHA-256 via `hashlib`. HMAC-SHA256 challenge–response over a
  shared secret is therefore cheap and available on-device today, and
  §13's `HELLO` is a natural place to carry the nonce. Ed25519/ECDSA
  verification would need either a pure-Python implementation (likely slow
  enough on an ESP32-C3 to matter) or a native module — which per §7 means
  a firmware rebuild. **Unverified — this is reasoning from the API
  surface, not measured on hardware.** Worth a real check before the
  password-vs-keypair call is made.

Neither perimeter is scoped here. Both belong in a security working note
of their own.

---

## Sub-decisions this migration forces

Each of these is a real call the briefing asked not to be made silently.

### 1. `compiler/graph.ts` — adapter, not rewrite

`graph.ts`'s header says its `{nodes, links}` input shape was modeled on
`LGraph.serialize()` "so whatever the real canvas integration produces
later doesn't need translating." It now does.

**Decision: write a Rete-graph → `{nodes, links}` adapter.** It keeps the
tested compiler input contract unchanged, which keeps the migration's
blast radius where this note has claimed it is. Changing `graph.ts`'s
accepted shape is arguably more correct long-term but touches tested
compiler code for no benefit available today.

**One requirement on the adapter, so this isn't paid for twice:** emit
real slot indices, even though `origin_slot` is `0` everywhere today.
poc-rete's headless check confirmed Rete supports independently-typed,
independently-keyed named outputs with zero extra plumbing, and
`mvp-feature-priorities.md` already has a two-output status router and a
generic switch/router node waiting on exactly this. An adapter that
hardcodes `0` would need revisiting the moment that work starts.

### 2. Palette drag-and-drop — keep the hand-rolled version, drop `rete-dock-plugin`

The spike ended with both mechanisms having existed. `rete-dock-plugin`
places a dropped node via `editor.addNode()` + `area.translate()`,
bypassing the `Drag` pointer pipeline entirely — which is precisely what
broke drag-to-splice in the spike and cost a hands-on debugging round to
find. The hand-rolled native HTML5 DnD (`PaletteSidebar.vue`/`App.vue`)
is proven working in a real browser and is this project's own code.

**Decision: hand-rolled, and `rete-dock-plugin` does not come across.**
One fewer dependency on the ledger, one fewer signal-pipeline mismatch,
and the left-sidebar palette made the dock redundant anyway.

### 3. Wire-type checking — a genuine gap, and *not* the one the briefing described

The briefing flagged poc-rete's `Any → Bool` rejection as "a real
type-compatibility gap" to resolve during migration. Having read
`app/nodes.ts`, the framing needs correcting:

**The real editor has no wire type checking at all today.** Every port in
`nodes.ts` is declared `"*"` — `inject` emits `addOutput("msg", "*")`,
`gpio_out` accepts `addInput("signal", "*")` despite its own description
saying "bool-only input." Litegraph's `isValidConnection` (the thing POC-C
chose it for) is effectively inert in the shipped editor.

So poc-rete is not a regression against the editor; it is *ahead* of it,
and its strictness surfaced an absence rather than introducing a
conflict. §6's typed payload with defined coercion (`int` may feed
`number`, `bytes` may not feed `string`) is Tier 0 work that was never
finished on the editor side.

**Decision: do not build the type system inside this migration.** Port
the ports as `any`-equivalent sockets to preserve current behavior
exactly, and let the migration be judged on canvas parity alone. Then
build §6's real socket types as its own task, against Rete, immediately
after. Landing both at once makes any regression impossible to attribute
— which is the same reasoning POC-D's own sequencing used.

### 4. Drag-to-splice trigger — flagged, needs Mike's hands-on call

poc-rete moved splice detection from `nodedragged` to `nodetranslated` to
cover dock drops. With the dock dropped (sub-decision 2), the trade-off
that fix carried — splicing on every intermediate drag position rather
than on release, so passing near a wire mid-drag splices immediately — is
now paid for a gesture that no longer exists. Worth re-testing whether
`nodedragged` plus an explicit hook on the palette-drop path reads better.
Not resolvable from a sandbox; this is a real-browser judgment, same as
every other feel question in this project.

---

## Dependency risk: the release hiatus, checked rather than assumed

Raised by Mike before approving Phase 0, and the right question to ask
given design doc §2 already carries MicroFlo as a cautionary tale about
exactly this failure mode ("the idea was right; it didn't survive
sustained maintenance").

Checked 2026-08-16 against the GitHub API, not recalled:

| Signal | `retejs/rete` |
|---|---|
| Stars / forks / watchers | 12,068 / 747 / 165 |
| **Open issues** | **10** |
| Last push to repo | **2026-05-22** |
| Last npm publish (`2.0.6`, still `latest`) | 2025-06-30 |
| Archived | no |
| License | MIT |

**This is a release hiatus, not a maintenance hiatus.** The repo received
commits eleven months *after* the last npm publish. The decisive number is
10 open issues against 12k stars — abandonment manifests as accumulating
issues, not as a quiet release cadence, and MicroFlo's contrasting profile
(220 stars, dormant, issues left rotting) is what that failure actually
looks like. Most benign consistent explanation: a feature-complete core
with low defect inflow, where changes don't accumulate to release-worthy.
The plugin packages doing the rendering work are current regardless
(`rete-area-plugin` 2026-07-08, `rete-vue-plugin` 2026-07-10, per
`pocs/poc-rete/README.md`'s registry `time` check).

**Not verified, flagged rather than glossed:** GitHub's array-returning
API endpoints (commits, issues, releases) came back empty through the
tooling available in this environment, so *what* the May 2026 commits
contain — real code versus docs/CI — and the issue tracker's actual
content were not inspected. Worth Mike's own look, same pattern as every
other hands-on confirmation in this project.

**The risk that is real is bus factor, not cadence** — this appears to be
a single-maintainer project. But it must be compared against the actual
alternative, not an ideal one: Litegraph 0.7.18 is a *vendored single
file* of a library this project already treats as unmaintained, with no
upstream relationship at all. Rete is MIT with 747 forks; the worst case
is pin-and-fork, which is precisely the posture `editor/` already holds
for Litegraph today. **On dependency risk specifically, this migration is
a net improvement, not a net cost** — which is not an argument for the
migration on its own, but does dispose of an argument against it.

## Scoped task list

Sequenced so a working deploy path exists at every point. **The existing
Litegraph editor stays runnable until the Rete one has passed the same
hardware round-trip** — build the new canvas alongside, cut over on
evidence, delete afterwards. That ordering is the whole risk-management
story here and shouldn't be optimized away for tidiness.

**Phase 0 — set-up**

1. **Approved by Mike, 2026-08-16** — seven packages, not six; the
   original count in this note omitted `@vitejs/plugin-vue`, without which
   `.vue` files don't compile at all.

   | Package | Pin | Role |
   |---|---|---|
   | `rete` | 2.0.6 | runtime — headless core |
   | `rete-area-plugin` | 2.3.2 | runtime — canvas surface |
   | `rete-connection-plugin` | 2.0.5 | runtime — wire drag |
   | `rete-render-utils` | 2.0.3 | runtime — peer of the renderer |
   | `rete-vue-plugin` | 2.1.3 | runtime — Vue node renderer |
   | `vue` | 3.5.41 | runtime — peer of the above |
   | `@vitejs/plugin-vue` | ^6.0.0 | **dev** — SFC compilation |

   Carry poc-rete's exact pins (least drift from what was validated
   hands-on). `rete-dock-plugin` deliberately does not come across
   (sub-decision 2). These become the first non-`cborg` runtime
   dependencies `editor/` has taken on, and Vue in particular is a
   framework commitment, not just a library — accepted knowingly.

2. **Vite 8 compatibility: resolved, no blocker.**
   `@vitejs/plugin-vue@6.0.8` declares
   `peerDependencies.vite: "^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0"`, so
   `editor/`'s existing `vite ^8.2.1` is supported and poc-rete's `^6.0.0`
   pin resolves correctly against it. No version reconciliation needed —
   the concern raised when scoping this was unfounded, checked rather than
   assumed.

3. **Supply-chain check, worth recording since CLAUDE.md's npm rules ask
   for one:** both `@vitejs/plugin-vue@6.0.8` and `rete-vue-plugin@2.1.3`
   publish **npm provenance attestations** (SLSA provenance predicate,
   trusted-publisher OIDC). That is the strongest available signal that
   the published tarball matches the repo it claims to come from, and it
   is a check this project can make as a *consumer* even though §12's
   provenance discussion is framed around publishing. Verify the same for
   the remaining five at install time rather than assuming.

   Also confirmed from registry metadata: `rete-vue-plugin`'s sole
   maintainer is `ni55an` (Vitaliy Stoliarov), corroborating the
   single-maintainer bus-factor read above; and the package description
   carries a Discord badge, so a community channel does exist — its
   activity level was not measured.

4. Install with `--ignore-scripts`, into a scratch directory outside the
   live-mounted repo, per `editor-look-and-feel-briefing.md`'s
   `node_modules` corruption workaround. Copy source only. Re-check
   `rete`'s `postinstall.js` is still the harmless console banner
   poc-rete inspected, rather than trusting that finding is still current.
5. Add all seven to `docs/third-party-licenses.md` in the same change,
   pulling versions/licenses from installed package metadata. Move them
   from the poc-rete spike section into a real `editor/` runtime
   dependency section — the ledger currently files them as spike-only,
   which stops being true here.

**Phase 1 — canvas layer**

4. Port the five node types from `app/nodes.ts` to Rete node classes
   (inject, function, debug, gpio_out, timer). Properties must keep
   matching each `node-library/*.ts` codegen exactly — `payloadType`/
   `payloadValue`/`repeat`, `code`, none, `pin`, `intervalMs`. Sockets
   `any`-equivalent for now, per sub-decision 3.
5. Per-type Vue node components carrying the existing colour palette
   (inject `#2e5c2e`/`#1f3f1f`, function `#6e5b2e`/`#3f341f`, debug
   `#2e4a6e`/`#1f2c3f`, gpio_out `#6e3b3b`/`#3f1f1f`, timer
   `#5b3b6e`/`#331f3f`) — these are the real editor's values, which
   differ from poc-c's for debug and add timer.
6. Editor setup: area plugin, connection plugin, Vue render preset,
   `AreaExtensions.selectableNodes` + `accumulateOnCtrl` for multi-select,
   validation pipe via `addPipe`.
7. Port the palette sidebar and its hand-rolled HTML5 DnD.
8. Re-check declared `width`/`height` per type against the real
   components — poc-rete's own gotcha (declared size is a real clipping
   budget in Rete's classic preset, unlike Litegraph) applies to node
   types it never rendered.

**Phase 2 — the seam**

9. Rete-graph → `GraphData` adapter, with real slot indices
   (sub-decision 1). Unit-test it directly against a fixture graph; this
   is the one new piece of logic in the migration and the compiler's whole
   tested contract sits behind it.
10. Replace `currentSource()`'s `graph.serialize()` call with the adapter.
    Delete the 1s poll; drive `refreshPreview` off Rete's pipe instead.

**Phase 3 — app shell**

11. Rewrite `extractCanvasSnapshot()` and `applyFlowFile()` against Rete.
    **Preserve the skip-and-report contract for unknown node types and
    orphaned edges** — verify against `editor/test/flow-file.test.ts`,
    which is canvas-independent and should stay green untouched.
12. Rewrite node highlighting. Error-attribution *logic*
    (`highlightNodeFromMpyError`'s line→node lookup,
    `highlightNodeFromNodeError`'s untrusted-ID guard) is canvas-agnostic
    and must not be touched — only the mechanism that turns a node red,
    which becomes reactive component state rather than
    `node.color`/`node.bgcolor` mutation plus `setDirty`.
13. Property panel: port poc-rete's `PropertyPanel.vue` + `nodepicked`
    hook, and retire the one-off `window.thingstudioOpenCodeEditor` /
    `#code-modal` for the function node into it. This closes
    `mvp-feature-priorities.md`'s deferred "compact node appearance" item
    as a side effect — the one deferred item this migration legitimately
    absorbs, because Rete's lack of a widget layer forces it rather than
    inviting it.

**Phase 4 — verification**

14. `npx tsc --noEmit` clean. Note poc-rete's own finding: `vite build`
    alone does not type-check (esbuild strips types), so the build passing
    proves nothing here.
15. Full `npm test` green — the ~20 compiler/protocol/node-library suites
    should be *untouched and passing*. Any change needed in them is a
    signal the blast radius claim in this note was wrong, and is worth
    stopping on rather than accommodating.
16. **Hardware round-trip parity against the real board**, matching the
    2026-08-14 result: `inject → gpio_out` on GPIO12, plus the fan-out
    case (inject to both `gpio_out` and `debug`). Plus a
    `function`-with-invalid-Python case to confirm mpy-cross error
    attribution still lands on the right node, and a save→reload→deploy
    cycle. Mike's, on his machine, per this project's standing pattern.
17. Delete the Litegraph canvas path and the vendored
    `editor/public/vendor/litegraph`. Remove its entries from
    `docs/third-party-licenses.md` and design doc §12/§14.

**Phase 5 — documentation**

18. Design doc §11: supersede the POC-C Litegraph resolution, citing
    poc-rete rather than silently editing the old text — this repo's
    established pattern is strikethrough-plus-replacement, and the
    reasoning for the reversal should survive.
19. Design doc §12 and §14: Litegraph row replaced by the Rete package
    set; §14's "vendored third-party code (Litegraph.js)" line no longer
    describes reality, since these are real npm dependencies.
20. `mvp-feature-priorities.md`: mark compact-node-appearance closed via
    Phase 3; leave drag-to-splice open (out of scope below).

**Immediately after, as its own task, not folded in:** §6's wire-type
system (sub-decision 3).

---

## Explicitly out of scope

Load-bearing. The realistic failure mode is scope absorption, not
difficulty.

- **The type system.** Sub-decision 3 — ports stay `any`-equivalent.
- **Drag-to-splice.** poc-rete has a working ~90-line reimplementation and
  `mvp-feature-priorities.md` reclassified it axis-2 → axis-1, so it will
  come across eventually. Not during a migration being judged on parity.
- **The backend.** Decision 2 — disjoint half of `main.ts`, sequence
  separately.
- **`rete-engine` / live value propagation.** poc-rete's hand-rolled
  `propagate()` and the missing dataflow engine are a real open question
  (Litegraph gave this for free; Rete does not), but live values are
  Tier 2 `VALUE_STREAM` work driven by the *device*, not by a canvas-side
  execution engine. The spike needed local propagation only because it had
  no device. **The real editor may need no execution engine at all** —
  worth confirming explicitly before anyone installs `rete-engine` out of
  habit.
- **Any new node type**, and the Tier 1 reprioritization from Mike's
  2026-08-16 review.

---

## Cost, stated plainly

Per the briefing's own instruction not to let the coupling finding make
this sound free: `app/nodes.ts` and the canvas half of `app/main.ts` are
working, hardware-proven code — a real Connect/Deploy round-trip ran
against real hardware on 2026-08-14, including fan-out. This decision
throws that away and rebuilds it, on the strength of a spike tested
against five fake node types with no compiler and no device.

The four poc-rete checkpoints have not been tested against the real node
set, the real property shapes, the real deploy flow, or a real board.
Phase 4 exists to catch that, and Phase 4 step 16 is the only step in this
plan whose failure would mean the decision was wrong. Everything before it
is reversible; the Litegraph path stays runnable until it passes.

What is *not* being weighed against this, and shouldn't be: bundle size
(181 KB vs. 491 KB) and the property-panel win are real but are not worth
a rewrite on their own. The reason to do this is that Rete's component
rendering model fits where this editor is going — a separate property
panel, compact Node-RED-shaped nodes, per-type visuals, drag-to-splice,
and multi-output routing are all either free or cheap there and all
either expensive or absent in Litegraph 0.7.18, an unmaintained vendored
file. Four separately-tracked deferred items in
`mvp-feature-priorities.md` all point the same way.

---

## Open, needs Mike

1. **Splice trigger** — `nodedragged` vs. `nodetranslated` (sub-decision
   4). Real-browser feel call.
2. **Backend language and framework**, and whether the runtime-auth
   design (password vs. HMAC challenge–response vs. keypair) gets scoped
   before or after the Rete migration. Both are separate notes. Given the
   §9 collapse above, the auth note is arguably the more urgent of the
   two, since it constrains the backend's shape rather than the reverse.
   Design doc §4 (the "browser-based... no install" framing), §9 (the
   physical-access gate), and §13 (auth fields, currently "deliberately
   not fixed yet") all need revising as part of it — flagged here, not
   edited, since this session's scope was Rete.
3. **`deployment-and-distribution-notes.md` now has a stale premise** —
   its "static site for editor hosting" item assumes a pure-browser
   editor with no server component. Under Decision 2, distribution becomes
   a package-install story instead. The Tasmota-style runtime install page
   in that same note is unaffected (it stays a standalone browser page).
   Flagged rather than edited, since that note isn't this session's scope.
