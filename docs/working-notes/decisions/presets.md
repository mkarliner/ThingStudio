# Decisions — Presets (named, saveable, human-editable per-node property bundles)

Status: detail file for `decisions.md`'s "Presets" index entry. Full design writeup:
`docs/working-notes/outstanding-items/presets-design.md`.

- **2026-09-22 — MVP item 4 (`mvp-kickoff-brief.md`) built, per-node scope only.** Raised by Mike two
  ways: `mikes-questions-and-points.md`'s "generic policy for presets for nodes that are complex to set
  up, like display drivers, but also board configs / pin mappings," and `road-to-mvp.md`'s "things like
  board and processor definitions should be human editable files in the thingstudio config folder.
  Similarly, spi setup should be saveable with a name to be selected later." Scoped in conversation with
  Mike before any code was written, same pattern `credential-storage-design.md` used.
- **Copy-on-apply, confirmed over a live-reference design.** The alternative considered was mirroring
  config nodes' `credentialName` — a persisted reference re-resolved every compile. Rejected because
  that indirection exists specifically to keep a real secret out of a shareable flow file, and a preset
  holds no secret; the whole point of the feature (Mike's own framing) is a flow file that stays
  self-contained. Selecting a preset copies its values onto `node.properties` once, right then — no
  reference is left behind, and re-saving/re-sharing the flow later carries the real values, not a name
  that needs a backend to resolve.
- **Hand-edited-file validity flagging — Mike's explicit follow-up when confirming copy-on-apply:**
  *"if a user adds a preset file manually that is invalid there should a very obvious syntax error
  flagged."* This is the one real behavioral departure from the credentials pattern this otherwise
  mirrors: credentials validate JSON only at write time, because nothing expects a human to hand-edit a
  credential file directly. Presets are explicitly meant to be hand-edited
  (`~/.thingstudio/presets/<type>/<name>.json` is the "human editable files" Mike asked for), so
  `PersistedStore.list_presets()` eagerly parses every file on disk and returns a `valid`/`error` flag
  per entry rather than raising on the first broken one (one bad hand-edit shouldn't hide every other
  saved preset of that type); `read_preset()` re-validates for the same reason a file can go from valid
  to broken between a list and a read call. The editor's `PresetRefField.vue` shows invalid entries
  disabled in the dropdown plus a summary line naming which files are broken and where to fix them —
  the backend's own parse error reaches the UI verbatim (same "structured NODE_ERROR message surfaces
  as-is" convention `admin-api-client.ts`'s header already documents for every other route).
- **v1 scope: per-node presets only, no board/chip-family auto-seeding.** Asked (AskUserQuestion, no
  strong preference given) whether v1 should also let a preset seed several nodes' properties at once
  from a single board choice — Mike had no preference, so this defaults to the narrower, better-
  understood shape already built for credentials/custom-nodes: one preset, one node kind, applied
  explicitly from that node's own property panel. `board-processor-reference-data.md` (curated
  board/processor reference data seeding multiple nodes from one board pick) stays its own,
  separately-scoped, not-yet-built item — this feature supplies the storage/UI mechanism a future
  board-preset type could sit on top of, it doesn't build that layer.
- **No field descriptor table, unlike credentials.** `CredentialTypeDescriptor`
  (`credential-types.ts`) exists because a credential bundle's fields (ssid/password, broker/port/
  username/password) live nowhere else in the app. A preset's fields are exactly whatever a node's own
  property panel already exposes — that panel *is* the editing UI, both before and after a preset is
  applied. `PresetRefField.vue` therefore takes the live `properties` object directly
  (`Object.assign(properties, presetData)` on apply, `{ ...properties }` on save) rather than a lookup-
  table key into a fields list. One consequence, noted rather than treated as a bug: a saved
  `display_spi` preset also captures `palette` (a 16-number array) even though `palette` has no
  PropertyPanel.vue form field yet — the snapshot doesn't discriminate on whether a field has a widget.
- **Backend:** `PersistedStore.list_presets`/`read_preset`/`write_preset`/`delete_preset`
  (`persisted_store.py`), same atomic-write/name-validation conventions as flows/custom-nodes/
  credentials, `type` validated with the same regex as `name` rather than a fixed tuple (credentials'
  `_CREDENTIAL_TYPES` has no preset equivalent — open namespace by design, see presets-design.md).
  Mirrored `GET /api/presets/{type}`, `GET/PUT/DELETE /api/presets/{type}/{name}` routes in
  `admin_api.py`, covered by the same Host-allowlist middleware as every other route (installed at the
  `Application` level, nothing route-specific needed).
- **Editor:** `admin-api-client.ts` gets `listPresets`/`getPreset`/`putPreset`/`deletePreset` (typed
  `presetType: string`, not a closed union). New `PresetRefField.vue` widget: dropdown + save-as-name +
  refresh, `:key="node.id"`'d at each call site so switching the selected node (even between two of the
  same kind) remounts it fresh instead of showing a stale "which preset is loaded" name from a
  previously-selected node. Wired into `PropertyPanel.vue`'s `display_spi`/`display_i2c` blocks — the
  two kinds Mike named explicitly ("complex to set up, like display drivers").
- **Picked up in the same change: `display_spi`'s missing `colorOrder`/`invertColors`/
  `dataLatchOrder` fields (MVP item 5's own named gap).** These three real, already-compiled-against
  properties (`display-spi.ts`'s codegen has read them since the 2026-09-18 CYD pass) had no
  `nodes.ts` declared-property-type entry, no default, and no PropertyPanel.vue form field at all
  before this change — a freshly-dropped `display_spi` node simply had no way to set them except
  hand-editing the flow file's JSON. Closed alongside the presets work because a "save this display's
  SPI setup as a preset" feature is markedly less useful if three of its real properties can't be seen
  or set from the panel doing the saving. `nodes.ts`'s `DisplaySpiNode` defaults now match
  `display-spi.ts`'s own codegen fallback values exactly (`colorOrder: "bgr"`, `invertColors: false`,
  `dataLatchOrder: true`) — not the CYD-tuned `rotation: 1` default mentioned in the same
  `display-spi.ts` comment block, which `nodes.ts` already diverges from (`rotation: 0`) independent of
  this change and was left alone as out of scope. `palette` remains the one display_spi property with
  no form field — a 16-entry RGB565 color picker is a separate, larger UI piece, not attempted here.
- **Verified:** `backend/test/test_persisted_store.py`/`test_admin_api.py` (round-trip, 404/400
  mapping, independent type namespaces, and specifically the validity-flagging behavior: a file
  written directly to disk with broken JSON, bypassing `write_preset()`'s own validation, shows up as
  `valid: false` in a list and raises on read) and `editor/test/admin-api-client.test.ts`
  (request shape, error surfacing, including the hand-edited-file 400 case). Isolated `pytest`/
  `vitest run` — see the working-notes entry this pass leaves in `learnings.md`/session notes for the
  exact pass/fail counts.
- **Not done — real hardware, and no delete-preset UI.** No board was available this session, same
  caveat every other MVP item this session touched carries. `deletePreset()` exists in
  `admin-api-client.ts` for parity with the backend's full route table (same "provided, not yet wired
  to a button" precedent `writeCustomNode`/`deleteCustomNode` already set) but `PresetRefField.vue` has
  no delete button — removing a preset today means deleting its file by hand, consistent with presets
  being explicitly human-editable files, cheap to add a button for later if it turns out to matter.
