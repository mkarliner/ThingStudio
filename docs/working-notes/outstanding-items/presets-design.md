# Presets: named, saveable, human-editable per-node property bundles

Raised by Mike two ways:

- `mikes-questions-and-points.md`: "generic policy for presets for nodes that are complex to set up, like
  display drivers, but also board configs / pin mappings."
- `road-to-mvp.md` (item 4/5 area): "Presets - things like board and processor definitions should be human
  editable files in the thingstudio config folder. Similarly, spi setup should be saveable with a name to be
  selected later."

MVP item 4 ("sensible defaults per chip family (pins, SPI speed)"). Scoped in conversation with Mike,
2026-09-22, before code was written (same pattern `credential-storage-design.md` used):

1. **Copy-on-apply, not a live reference.** Confirmed over the alternative (a persisted `presetName` on the
   node, re-resolved every compile, the way a config node's `credentialName` works). Credentials use a live
   reference specifically because the real secret value must never land in a shareable flow file --
   presets hold no secret, so that reason doesn't apply, and the whole point of the feature (Mike's own
   framing, "human editable files... spi setup should be saveable") is a flow file that stays self-contained:
   applying a preset copies its values into `node.properties` once, at selection time, same as picking a
   value off a dropdown. A `.flow.json` someone commits to git carries the real pin numbers directly, with no
   backend needed to make sense of it later.
2. **Hand-edited files must fail loudly, not just at the next write.** Mike's explicit addition when
   confirming (1): *"if a user adds a preset file manually that is invalid there should a very obvious syntax
   error flagged."* This is the one real behavioral departure from the credentials pattern below --
   credentials only validate JSON syntax at write time, because nothing expects a human to hand-edit a
   credential file. Presets are explicitly meant to be hand-edited (`~/.thingstudio/presets/<type>/<name>.json`
   is the "human editable files in the thingstudio config folder" Mike asked for), so `list_presets()` eagerly
   parses every file on disk and reports a `valid`/`error` flag per entry, and `read_preset()`/the editor's
   apply path both re-validate and surface the backend's own parse error rather than silently handing back (or
   applying) broken JSON. See `persisted_store.py`'s own "Presets" section for the exact mechanism.
3. **v1 scope: per-node presets only, no board/chip-family auto-seeding.** Mike had no preference when asked,
   so this defaults to the narrower, already-well-understood shape: a preset is a named snapshot of one node's
   own `properties`, picked explicitly from that node's property panel. `board-processor-reference-data.md`
   (curated board/processor reference data, seeding several nodes' pins/settings at once from a board choice)
   remains its own separately-scoped, not-yet-built item -- this feature supplies the storage/UI mechanism a
   future board-preset type could sit on top of, but doesn't build that layer itself.

## Design: a new persisted-store namespace, mirroring credentials, minus the descriptor table

Same backend conventions `persisted_store.py`/`admin_api.py` already established for flows/custom-nodes/
credentials (atomic temp-file-then-`os.replace` writes, `^[A-Za-z0-9_-]{1,100}$` name validation checked
pre-filesystem-call, structured `NODE_ERROR` JSON on failure, automatically covered by the existing
Host-allowlist middleware):

```
~/.thingstudio/
  presets/<type>/<name>.json    -- <type> is a node kind string (e.g. "display_spi"),
                                    an OPEN namespace, not a fixed tuple
```

**`type` is open, unlike credentials' fixed `wifi`/`mqtt-broker` tuple.** Presets cover whichever node kinds
are complex enough to deserve one, now or later (Mike's own examples: "display drivers... board configs / pin
mappings") -- no backend code change is needed to add a new preset type, only a new `PresetRefField` usage in
the editor pointed at that node kind. `persisted_store.py`'s name-validation regex is reused for `type` too
(same charset, since a node kind like `display_spi` already fits it).

**A preset's content is the entire node's `properties` object, snapshotted as-is -- not a curated field
list.** This is the one place this design is genuinely *simpler* than credentials, not just a mirror of them:
`CredentialTypeDescriptor` (`credential-types.ts`) exists because a credential bundle's fields live nowhere
else in the app (there's no other UI that already edits an SSID/password pair). A preset's fields, by
contrast, are exactly whatever a node's own property panel already exposes -- that panel *is* the editing UI,
both for a fresh node and for a about-to-be-saved preset. So `PresetRefField.vue` takes a live `properties`
object directly and does `Object.assign(properties, presetData)` on apply / `{ ...properties }` on save,
with no per-type field descriptor anywhere. One consequence: a display_spi preset also captures `palette` (a
16-number array) even though `palette` has no PropertyPanel.vue form field of its own yet -- the snapshot
doesn't care that a field lacks a widget, it just copies whatever's in `properties`.

### Backend (`persisted_store.py`/`admin_api.py`)

`PersistedStore.list_presets(type) -> list[PresetInfo]`, `read_preset(type, name) -> str`,
`write_preset(type, name, text) -> None`, `delete_preset(type, name) -> None`. `PresetInfo` is
`{name, valid, error}` -- `list_presets()` eagerly tries `json.loads()` on every file's contents and reports
per-entry validity rather than raising on the first broken one, so one bad hand-edit doesn't hide every other
saved preset of that type. `read_preset()` re-validates (a file can go from valid to broken between a list and
a read call) and raises `PersistedStoreError` with a message calling out that a hand-edit may be the cause.

`admin_api.py` mirrors this 1:1: `GET /api/presets/{type}` (returns `{"presets": [{name, valid, error}, ...]}`),
`GET/PUT/DELETE /api/presets/{type}/{name}`.

### Editor (`admin-api-client.ts`, `PresetRefField.vue`)

`admin-api-client.ts` gets `listPresets`/`getPreset`/`putPreset`/`deletePreset`, structurally the closest
cousin of the credential functions, typed with an open `presetType: string` rather than a `CredentialType`
union.

`PresetRefField.vue` is the one new widget: a dropdown of saved presets for a given `presetType` (invalid
entries shown disabled, with a summary line naming which files are broken and where to fix them by hand), a
save button that snapshots the current `properties` under a chosen name, and a refresh button. See that file's
own header for the full reasoning; the short version is "CredentialRefField.vue's shape, minus the descriptor
table and the live-reference semantics."

### v1 usage: display_spi and display_i2c

`PropertyPanel.vue` gets one `PresetRefField` each in the `display_spi`/`display_i2c` blocks -- the two node
kinds Mike named explicitly as "complex to set up." Picked up alongside this work: `display_spi`'s
`colorOrder`/`invertColors`/`dataLatchOrder` properties (MVP item 5's own named gap) had no PropertyPanel.vue
form fields at all before this change, which would have made a "save this display's SPI setup as a preset"
feature markedly less useful (three of the real properties a preset snapshot would carry couldn't be seen or
edited afterward). Closed in the same change -- `nodes.ts`'s `DisplaySpiNode` defaults now match
`display-spi.ts`'s own codegen fallback values (`colorOrder: "bgr"`, `invertColors: false`,
`dataLatchOrder: true`), and PropertyPanel.vue has form fields for all three. `palette` remains the one
display_spi property with no form field (a 16-entry RGB565 color picker is a separate, larger UI piece) --
still captured correctly in a preset snapshot regardless, just not editable from the panel afterward.

## What this doesn't do

- No board/chip-family "pick your board, get sensible pin defaults seeded across several nodes at once" --
  `board-processor-reference-data.md` stays its own item.
- No preset *renaming* -- same "+"-to-add / pencil-only-edits-values pattern credentials chose for the same
  reason (renaming needs either a copy-then-delete-old dance client-side or a new backend rename op; not asked
  for, not built).
- No preset deletion UI yet -- `deletePreset()` exists in `admin-api-client.ts` for parity with the backend's
  full route table (same "provided, not yet wired to a button" precedent `writeCustomNode`/`deleteCustomNode`
  already set), but `PresetRefField.vue` has no delete button. Deleting a preset today means removing its file
  by hand from `~/.thingstudio/presets/<type>/` -- consistent with presets being explicitly human-editable
  files, and cheap to add a button for later if it turns out to matter.
