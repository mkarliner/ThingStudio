// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/config-types.ts
//
// Config nodes (config-node-and-palette-implementation-briefing.md): the
// small, editor-only descriptor table the briefing calls for -- "a config
// type's 'descriptor' only matters to the editor... doesn't belong in
// compiler/node-definition.ts at all," matching how palette.ts already
// keeps per-kind editor metadata (color/icon/label) separate from the
// compiler's own registry. ConfigRefField.vue is parameterized by a
// `configType` key into this table rather than hardcoding WiFi's own
// fields -- a second config type (e.g. a later `mqtt_broker`) costs one
// entry here, not a new component.
//
// Was deliberately just one entry for the original session's success bar
// -- `thingstudio/config/wifi`, `{ssid, password}` -- matching the one
// config type that briefing scoped as required (a `mqtt_broker` config
// type was explicitly optional/deferred at the time). Built 2026-08-21,
// on Mike's own request once mqtt_publish/mqtt_subscribe got their first
// canvas presence: `thingstudio/config/mqtt-broker`, `{broker, port,
// username, password}` -- broker/port move out of each mqtt node's own
// properties into a referenced config, same "stop duplicating the same
// value across every node pointed at the same target" fix the wifi
// config already gave ssid/password. `username`/`password` here are
// mqtt_as's own broker-level auth fields (`config['user']`/
// `config['password']`) -- a different credential pair from the
// referenced WiFi config's own `ssid`/`password`, which authenticates to
// the WiFi network, not the broker. See mqtt-shared.ts's own header for
// how a node resolves both configs together.
//
// `security` field added (redeploy-cleanup-and-network-fault-detection-
// briefing.md, Problem 2b/3): three states, not two --
//   - "password" (default): a normal WPA/WPA2/WPA3 network. An empty
//     password on a "password"-security config is a loud CompileError
//     (wifi-status.ts's wifiSetupStatement), not a silent open connect --
//     Problem 2's "barf on undefined network details," applied here.
//   - "open": an intentionally open, no-password network. Mechanically
//     identical to what an empty password already did before this field
//     existed (MicroPython's `.connect(ssid, "")`) -- this state's whole
//     job is making that a labeled, explicit choice instead of
//     indistinguishable from a forgotten password.
//   - "unmanaged": this config declares NO connection of its own -- the
//     referencing node's wifiSetupStatement brings the station interface
//     up (`.active(True)`) but issues no `.connect()` call at all, riding
//     on whatever the device is already connected to. This is the
//     explicit replacement for what an *omitted* wifiConfigId used to
//     mean implicitly (see wifi-status.ts's header) -- Problem 2b's
//     Option B makes referencing a wifi config mandatory for
//     wifi_status/udp_send/udp_receive, so "ride on an existing
//     connection" now has to be a flow author's own labeled choice
//     (create/pick an "unmanaged" config) rather than a silent omission.
//     Deliberately kept open, not removed by Option B: a device that
//     provisions its own WiFi outside of any deployed flow (e.g. a
//     Tasmota-style captive-portal/soft-AP fallback that saves credentials
//     to NVS on first boot -- raised by Mike 2026-08-20, not built or
//     scoped anywhere yet, see outstanding-items.md) is exactly the real
//     case this state exists for -- a flow's network nodes still need a
//     way to say "someone else manages this connection" without that way
//     being an easy-to-miss blank field.

// Credential storage (docs/working-notes/outstanding-items/
// credential-storage-design.md, confirmed with Mike 2026-09-13): a WiFi
// or MQTT-broker config's own secret-shaped fields (ssid/password, or
// broker/port/username/password) moved OUT of this file's `defaults`/
// `fields` entirely -- the whole named bundle now lives in the backend's
// own credential store (persisted_store.py), referenced by
// `credentialName`, not split field-by-field the way a partial-secrecy
// design would. `security` stays here for the WiFi type -- it's a
// per-flow compile-behavior flag (wifi-status.ts), not part of "which
// network," so it isn't a secret and doesn't move.
//
// `kind: "credential"` is the new field kind this adds:
// `ConfigRefField.vue`'s edit panel renders it as `CredentialRefField.vue`
// instead of a plain input -- same per-kind dispatch pattern `select` vs.
// plain `input` already uses, one level down. `credentialType` says which
// credential-store namespace ("wifi" or "mqtt-broker") the field resolves
// against; see credential-types.ts for that store's own field shapes.

export interface ConfigFieldDescriptor {
  /** Must match the key this field is stored under in a config's own `properties`. */
  name: string;
  label: string;
  kind: "text" | "password" | "number" | "select" | "credential";
  /** Only meaningful when `kind` is "select" -- the fixed set of allowed values. */
  options?: { value: string; label: string }[];
  /** Only meaningful when `kind` is "credential" -- which credential-store
   * namespace this field resolves against (credential-types.ts). */
  credentialType?: "wifi" | "mqtt-broker";
}

export interface ConfigTypeDescriptor {
  /** e.g. "thingstudio/config/wifi" -- matches GraphConfigNode/FlowFileConfig's own `type` string. */
  type: string;
  /** Short label for the dropdown/pencil/+ widget, e.g. "WiFi". */
  label: string;
  fields: ConfigFieldDescriptor[];
  /** Seed properties for a freshly "+"-added config of this type. */
  defaults: Record<string, unknown>;
  /** Given one config's properties, a short human-readable summary for the
   * dropdown option text (e.g. the SSID itself) -- falls back to the
   * config's own id (below) when this returns an empty/falsy value (a
   * freshly-added, not-yet-filled-in config). */
  summarize(properties: Record<string, unknown>): string;
}

export const CONFIG_TYPES: Record<string, ConfigTypeDescriptor> = {
  "thingstudio/config/wifi": {
    type: "thingstudio/config/wifi",
    label: "WiFi",
    fields: [
      { name: "credentialName", label: "credential", kind: "credential", credentialType: "wifi" },
      {
        name: "security",
        label: "security",
        kind: "select",
        options: [
          { value: "password", label: "Password (WPA/WPA2/WPA3)" },
          { value: "open", label: "Open (no password)" },
          { value: "unmanaged", label: "Unmanaged (device connects itself, e.g. captive portal)" },
        ],
      },
    ],
    defaults: { credentialName: "", security: "password" },
    // The credential's own name doubles as the summary -- Fork #1 (the
    // design doc) already makes it a human-chosen nickname for a real
    // network ("home-wifi"), so there's no separate SSID to show anymore.
    summarize: (properties) => (typeof properties.credentialName === "string" ? properties.credentialName : ""),
  },
  "thingstudio/config/mqtt-broker": {
    type: "thingstudio/config/mqtt-broker",
    label: "MQTT Broker",
    fields: [{ name: "credentialName", label: "credential", kind: "credential", credentialType: "mqtt-broker" }],
    defaults: { credentialName: "" },
    summarize: (properties) => (typeof properties.credentialName === "string" ? properties.credentialName : ""),
  },
};
