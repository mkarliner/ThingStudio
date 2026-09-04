# Credential-free flows for git — deferred, 2026-09-04

Raised by Mike, same session as the single-wifi-owner fix (`wifi-single-owner-fix.md`) and the WiFi-provisioning/
captive-portal refinement (`wifi-provisioning-captive-portal.md`), but a distinct concern from both: he wants to be
able to check a *valid, mqtt-including* flow into git without any real WiFi credentials embedded in the flow file
itself — a dev-workflow/secrets-hygiene need, not a device-runtime feature.

**Confirmed blocked by today's design, deliberately:** `mqtt_publish`/`mqtt_subscribe` (via `parseMqttBrokerProps`,
`mqtt-shared.ts`) now hard-require a real, non-empty `ssid` resolved from the flow's one `wifi_status` node —
`mqtt_as` manages its own WiFi connection and has no "unmanaged"/no-credentials mode (this file's sibling,
`wifi-single-owner-fix.md`, has the full story, including the real compile error Mike hit testing this exact gap).
So an mqtt-including flow cannot compile today without real credentials living somewhere `ctx.resolveConfig()` can
read — which today means inside the flow file's own config-node properties, in plaintext.

**Options, not yet evaluated or chosen (Mike's call, when this is picked back up):**

- Placeholder/dummy credentials committed to git (e.g. `ssid: "CHANGE_ME"`) — zero code change, but the committed
  flow doesn't actually compile-and-run as-is; a local, never-committed edit fills in real values before deploy.
  Doesn't need any new mechanism, but doesn't really give a "valid" (deployable-as-committed) flow either.
- A real secrets-injection mechanism: WiFi (and broker) config values supplied from OUTSIDE the flow file at
  compile/deploy time (e.g. a local, gitignored secrets file merged in by `test-flows/deploy_runtime.py` or the
  compiler itself), so the flow file committed to git has no credential fields populated at all, yet still compiles
  and deploys correctly when the local secrets are present on the machine doing the deploying. Real design/scope
  work: where the secrets file lives, how it's keyed to which config node, whether `ctx.resolveConfig()` needs a
  new source, and how this interacts with the editor's own property panel (would a config node's ssid/password
  fields need a "read from local secrets instead" toggle, or is this compile/deploy-pipeline-only, invisible to
  the canvas?).
- Something that piggybacks on the WiFi-provisioning/captive-portal work (`wifi-provisioning-captive-portal.md`) —
  if a flow can legitimately reference a config with no credentials at all (the "scan at runtime" case), an
  mqtt-including flow might eventually be able to do the same if mqtt's own credential requirement is relaxed —
  but that depends on decoupling mqtt_as's WiFi management from its broker-session management, the same
  architectural fork already flagged as a live possibility in `wifi-single-owner-fix.md` (the zcattacz/mqtt_as
  fork, and Mike's plan to raise this with Peter Hinch upstream).

**Decision (Mike, 2026-09-04): defer.** Likely wants the mqtt-including version (option discussed was "probably 2"
in the exchange that raised this), but no design/implementation work started. Revisit once picked back up.
