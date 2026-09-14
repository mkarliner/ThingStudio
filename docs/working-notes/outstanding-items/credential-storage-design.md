# Credential storage: move WiFi/MQTT secrets into `~/.thingstudio`, out of the flow file

Raised by Mike, 2026-09-13 (`mikes-questions-and-points.md`): "Save credentials to persistence store in
.thingstudio, not in flow." Same underlying need as the already-deferred
`credential-free-committable-flows.md` (2026-09-04) -- **this design resolves that item too**, not just the
fresh note; see "Relationship to credential-free-committable-flows.md" below.

Scoped in conversation with Mike, 2026-09-13, before any code was written (same pattern as
`palette-node-family-ordering.md`/`multi-pane-canvas.md`). Four forks were his call, not guessed here:

1. **Lookup key: by name (SSID/broker nickname), not by config-node id.** One store entry per real-world
   network/broker, reused by any config node that names it -- not Node-RED's one-secret-per-node-instance model.
2. **Backend-required is fine.** This only works when the backend is reachable, same as custom-node storage
   today. Direct/WebSerial-only mode simply doesn't support externally-stored credentials -- no inline fallback.
3. **UX: "drop down of existing, saved credentials, form for new (or editing) credentials."** Mike's own words --
   this is, almost verbatim, the existing `ConfigRefField.vue` dropdown/pencil/+/edit-form pattern (see below),
   one level down.
4. **Scope this session as a design doc, not straight to implementation.**

## The actual mechanism doesn't change what the compiler sees

Compile is fully synchronous today -- `CodegenContext.resolveConfig(id): Record<string, unknown>` (`compile.ts`)
just reads a plain in-memory object, no I/O. The compiled MicroPython source (visible in the source-preview
panel) still needs the *real* ssid/password/broker-username/password baked in as string literals for the device
to run -- nothing about "don't commit this to git" changes that. So this design is about **where the value lives
at rest and how it gets into the in-memory `configs` store**, not about changing the compiler's contract at all.
`resolveConfig()` stays exactly as it is; nothing downstream of it needs to know a credential came from a
backend fetch instead of a hand-typed literal.

## Design: credentials become their own backend-owned store, referenced by name

Mirrors `ConfigRefField.vue`'s own established pattern (dropdown of existing entries + pencil "edit" + "+" "add
new" + inline Save/Close form) one level down -- a **new, parallel widget** (`CredentialRefField.vue`) for the
secret-shaped fields specifically, backed by the backend instead of the flow file's own `configs` store.

### What moves out of the config node entirely

Rather than a partial split (keep `ssid` inline, only externalize `password`), **the whole network/broker
identity plus its secret moves into the named credential bundle** -- a WiFi or MQTT-broker config node's own
flow-file properties shrink to just a credential-name reference (plus `security` for WiFi, which is a
per-flow compile-behavior flag, not part of "which network," and stays on the config node as today):

- `thingstudio/config/wifi` config's properties become `{ credentialName: string, security: "password" |
  "open" | "unmanaged" }` -- `ssid`/`password` no longer live here at all.
- `thingstudio/config/mqtt-broker` config's properties become `{ credentialName: string }` -- `broker`/`port`/
  `username`/`password` no longer live here at all.

**Decided, 2026-09-13: Option B, the whole bundle.** `credentialName` is the only thing left on the
config node; nothing about which network/broker a flow uses is visible without the backend. Confirmed by Mike
over Option A (keep `ssid`/`broker`/`port` inline, externalize only `password`/`username`).

### Backend: new persisted-store namespace + admin API routes

Same conventions `persisted_store.py`/`admin_api.py` already established for flows/custom-nodes (atomic
temp-file-then-`os.replace` writes, `^[A-Za-z0-9_-]{1,100}$` name validation checked pre-filesystem-call,
structured `NODE_ERROR` JSON on failure, automatically covered by the existing Host-allowlist middleware since
it's installed at the `Application` level):

```
~/.thingstudio/
  credentials/wifi/<name>.json          -- { "ssid": ..., "password": ... }
  credentials/mqtt-broker/<name>.json   -- { "broker": ..., "port": ..., "username": ..., "password": ... }
```

Routes, mirroring `/api/flows`/`/api/custom-nodes` exactly:

- `GET /api/credentials/{type}` -- list saved names (type is `wifi` or `mqtt-broker`).
- `GET/PUT/DELETE /api/credentials/{type}/{name}`.

**Named security trade-off, not silently accepted:** posture-1 auth is a Host-header allowlist only, no real
authentication -- a `GET` returns the real secret in plaintext over local HTTP, same risk profile
`~/.thingstudio`'s existing flow/custom-node content already has. Not a new regression this design introduces,
but worth stating plainly per this project's fault-handling-first priority. Posture-2 session-cookie auth, once
built, covers these routes the same automatic way it will cover the existing ones.

### Editor: new admin-api-client.ts functions + CredentialRefField.vue

- `admin-api-client.ts`: `listCredentials(type)`, `getCredential(type, name)`, `putCredential(type, name, data)`,
  `deleteCredential(type, name)` -- same shape as the existing (already-written, currently-unused)
  `writeCustomNode`/`deleteCustomNode` functions that item noted.
- `CredentialRefField.vue`: new component, structurally a close cousin of `ConfigRefField.vue` but async
  (`fetch`-backed instead of a synchronous in-memory Map) -- dropdown of names from `listCredentials()`, pencil
  edit / "+" add-new opening an inline form with the bundle's real fields (ssid+password, or
  broker+port+username+password), Save calling `putCredential()`.
- `config-types.ts`: `ConfigFieldDescriptor` gets a new `kind: "credential"` (alongside today's
  `text`/`password`/`number`/`select`), carrying which credential-store `type` it points at
  (`"wifi"`/`"mqtt-broker"`) -- `PropertyPanel.vue`'s per-kind field loop renders this as `CredentialRefField`
  instead of a plain input, same dispatch-by-`kind` pattern already there for `select` vs. plain `input`.
- Selecting (or creating/editing) a credential resolves its real values into the *referencing config's own*
  in-memory `properties` at the same synchronous point `resolveConfig()` already reads from -- i.e. the fetch
  happens once, at selection/load time (see below), not per-compile. `resolveConfig()` itself needs zero
  changes.

### Flow-file load: the one place this genuinely needs new async plumbing

`buildFlowFile()` never serializes a credential's real values (there aren't any left on the config node to
serialize, per the Option B shape above) -- it only ever writes `credentialName`. The gap is the reverse
direction: **`applyFlowFile()` today is synchronous end-to-end; resolving `credentialName` back into a real
`ssid`/`password` (etc.) needs an async backend fetch that has to complete before Deploy/compile can succeed.**

Proposed handling: right after a flow loads, walk every wifi/mqtt-broker config, fetch its named credential, and
populate the in-memory `properties` -- same "fetch once at load time, not per-compile" shape selecting from the
dropdown already uses. If the backend is unreachable, or the named credential no longer exists in the store
(renamed/deleted since the flow was last saved), that's a clear, attributed `NODE_ERROR`-style message in the
console (this project's standing fault-handling priority) naming which config and which credential name failed
to resolve -- not a silent empty-string password reaching the compiler.

## Relationship to `credential-free-committable-flows.md`

That item deferred, 2026-09-04, on exactly this design gap ("a real secrets-injection mechanism... where the
secrets file lives, how it's keyed... how this interacts with the editor's own property panel" -- named as
unresolved, not evaluated). This doc is that evaluation. Once built, `credential-free-committable-flows.md`
should move to Resolved -- Option B above gives Mike a "valid, mqtt-including flow" committed to git with
literally zero WiFi/broker info in it (not just no plaintext password), which was that item's original ask.

## Decisions, confirmed by Mike 2026-09-13

1. **Option B** (whole bundle externalized) over Option A -- see above.
2. **Renaming/deleting a saved credential is out of scope for v1.** No flow-file migration story for a renamed
   name. A deleted-out-from-under-you credential is caught by the load-time fetch's error path, not prevented.
3. **A credential's real value is shared across every flow naming it, by design.** Editing "home-wifi"'s
   password in one flow's property panel changes what every other flow referencing "home-wifi" resolves to on
   its next load. Follows directly from looking credentials up by name rather than by config-node id.
4. **Fetch timing: on load, not lazily before compile.** Right after a flow loads, walk every wifi/mqtt-broker
   config and fetch its named credential. Keeps `resolveConfig()`/compile fully synchronous and untouched.

Scoped and confirmed; ready for implementation.

## Built, 2026-09-13

Implemented same day as the decisions above. Backend: `PersistedStore.{list,read,write,delete}_credential`
(`persisted_store.py`), four `/api/credentials/{type}[/{name}]` routes (`admin_api.py`), test coverage in
`test_persisted_store.py`/`test_admin_api.py`. Editor: `config-types.ts`'s wifi/mqtt-broker entries now carry
only `credentialName` (+ `security` for wifi) as their own fields; the real secret-shaped fields moved to a new
`credential-types.ts` table; a new `CredentialRefField.vue` (dropdown/pencil/+, backend-fetch-backed) renders
inside `ConfigRefField.vue`'s edit panel for the new `kind: "credential"` field kind; `admin-api-client.ts` grew
matching CRUD functions. `main.ts`'s `applyFlowFile()` calls a new `resolveConfigCredentials()` right after
configs load, merging each resolved credential's fields into the in-memory config properties `resolveConfig()`
reads -- a missing/unreachable credential logs a clear, attributed error rather than failing silently. Save-time,
`extractConfigsSnapshot()` filters a config's properties down to only the field names `config-types.ts` declares
for its type before handing them to `buildFlowFile()`, so a resolved secret never round-trips back into the
saved `.flow.json` -- the mechanism that actually delivers on this doc's whole premise.

The six real test-flow files that had plaintext credentials committed (`basic-mqtt`, `basic-http-request`,
`basic-http-in`, `wifistatus`, `badcredentials`, `udp-echo-tester`) were migrated the same day: real values
seeded into `~/.thingstudio/credentials/{wifi,mqtt-broker}/<name>.json` on Mike's machine, flow files rewritten
to hold only `credentialName`/`security`. `credential-free-committable-flows.md` moved to Resolved in
`outstanding-items.md` as a result -- see that file's own note.

`docs/user-guide/*` and `docs/thingstudio-design-doc.md` updated to match, same day.

**UX fix, same day, from Mike's own hands-on testing:** the first cut left `ConfigRefField.vue`'s edit panel
with its own Save button stacked on top of `CredentialRefField.vue`'s nested Save button -- two Saves doing two
different things (persisting `credentialName`/`security` onto the config vs. persisting the credential's actual
values to the backend) read as one confusing double-save. Fixed by auto-committing the outer panel's `draft` to
the config on every change and dropping it to a single "Close" -- the only explicit Save left anywhere in the
widget is the credential's own, which is unavoidably a real backend call.

**Second UX fix, same day, from Mike's own continued hands-on testing:** the double-Save fix above still left
"+" creating an anonymous config (`credentialName: ""`) and opening its own edit panel just to reach a SECOND,
nested "+" for the credential itself -- Mike's direct words: "clicking + on wifi ... brings up a un[n]amed wifi
... I'd expect to be able to give it a name, and then ssid and passwd." Fixed by giving `ConfigRefField.vue`'s
`addNew()` a combined one-shot form for any config type with a credential field: one name input, the credential
type's own fields, and any other config-level fields (`security`, for WiFi), one Save, creating the credential
and the config together -- no intermediate anonymous config ever exists. Editing an EXISTING config still uses
the dropdown/pencil/+ picker (legitimate there -- you might want to point it at a different already-saved
credential), so that path is unchanged.

**Third UX fix, 2026-09-14, from Mike's own continued hands-on testing:** a brand-new flow's WiFi dropdown
showed empty even though he already had several saved WiFi credentials -- correct as to state (a fresh flow
really has zero `configs` of its own) but useless as UX, since the whole point of a named credential store is
picking one you already saved without recreating it per flow. Fixed by having `ConfigRefField.vue`'s `options`
merge this flow's own configs with every backend credential name of this type not already referenced by one of
them; picking one of those auto-creates (or reuses, if some other node in the flow already made one) a matching
config on the spot. `credentialNames` is fetched on mount and refreshed after this widget's own `saveNew()`; it
does not react to a credential created elsewhere in the same session (a page reload picks it up) -- accepted for
now, revisit if that gap actually bites someone.

**Fourth round of fixes, 2026-09-14, same session as the third:** three more issues from Mike's own continued
hands-on testing, landed together --

1. **Field-row layout.** The combined create-new form's plain `<label>{{f.label}}<input></label>` fields (name,
   ssid/password, security) rendered as one run-on paragraph, wrapping wherever the browser found room, not one
   row per field -- an inline `<label>` around an inline-flowing `<input>` doesn't stack the way PropertyPanel.vue's
   own top-level fields do (that file sets `label { display: block }` itself; scoped styles don't leak into a
   child component, so this nested form needed its own). Fixed with a `.field-row` class (flex row, label text in
   a `<span class="field-label">`, input/select filling the rest) applied consistently in both
   `ConfigRefField.vue`'s panels and `CredentialRefField.vue`'s own edit panel -- Mike's own explicit ask: "field
   name and field on the same line and then a line break."
2. **Property panel width**, 260px to 340px (`PropertyPanel.vue`) -- Mike's own ask, noting the panel already
   collapses to a thin rail when nothing's selected rather than staying open full-width all the time, so there's
   little of the usual "wider sidebar eats canvas space" tradeoff to weigh against it.
3. **No way to pick "unmanaged" (no credential) from a blank canvas.** `security: "unmanaged"` needs no
   credential at all (`wifi-status.ts`'s `wifiSetupStatement` returns before ever consulting ssid/password for
   this value) -- but once "+" started requiring a name to create anything (round 2's fix), there was no way to
   reach it without first creating some other, real, named config and then flipping its security select via the
   pencil. Fixed by adding a synthetic "Unmanaged (...)" entry directly to `ConfigRefField.vue`'s merged dropdown
   (`UNMANAGED_OPTION_ID`), derived generically from config-types.ts's own field/option data (whichever
   `select`-kind field declares an `"unmanaged"` option) rather than hardcoded to WiFi specifically. Picking it
   creates (or reuses, if one already exists in this flow) a config with an empty credential name and that
   field set to `"unmanaged"` -- no backend call, no named credential involved.

Real backend/editor test suites (pytest, vitest) and a manual browser smoke test of the new dropdown/pencil/+
widget still need Mike to run them himself, per this project's sandbox/shared-mount restrictions -- not yet
confirmed green.
