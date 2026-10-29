// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/credential-types.ts
//
// The credential-store counterpart to config-types.ts, one level down:
// where config-types.ts describes a *config node's* editable fields
// (now just `credentialName` + `security` for WiFi, `credentialName`
// alone for MQTT broker -- see that file's own header), this table
// describes the *credential bundle itself* -- the real secret-shaped
// fields a named credential in the backend's store actually holds
// (persisted_store.py's `credentials/<type>/<name>.json`).
//
// Deliberately its own small table, not folded into config-types.ts's
// `ConfigTypeDescriptor`: a config type and its credential type are
// related but distinct concepts now (a config references a credential by
// name; it no longer *is* one), and CredentialRefField.vue is
// parameterized by a `credentialType` key into this table the same way
// ConfigRefField.vue is parameterized by a `configType` key into
// config-types.ts -- ONE new field kind ("credential" -- config-types.ts)
// PLUS one new component (CredentialRefField.vue) cost this whole
// feature, not per-type bespoke UI.
//
// See docs/working-notes/outstanding-items/credential-storage-design.md
// for the full design (confirmed with Mike 2026-09-13).

export interface CredentialFieldDescriptor {
  /** Must match the key this field is stored under in a credential bundle's own JSON. */
  name: string;
  label: string;
  kind: "text" | "password" | "number";
  placeholder?: string;
}

export interface CredentialTypeDescriptor {
  /** "wifi" or "mqtt-broker" -- matches persisted_store.py's own
   * `_CREDENTIAL_TYPES` and the `{type}` path segment in admin_api.py's
   * `/api/credentials/{type}` routes. */
  type: "wifi" | "mqtt-broker";
  /** Short label for the widget, e.g. "WiFi credential". */
  label: string;
  fields: CredentialFieldDescriptor[];
  /** Shown in the empty name box when making a new one. */
  namePlaceholder: string;
  /** Seed properties for a freshly "+"-added credential of this type. */
  defaults: Record<string, unknown>;
}

export const CREDENTIAL_TYPES: Record<string, CredentialTypeDescriptor> = {
  wifi: {
    type: "wifi",
    label: "WiFi credential",
    namePlaceholder: "e.g. home-wifi",
    fields: [
      { name: "ssid", label: "SSID", kind: "text" },
      { name: "password", label: "password", kind: "password" },
    ],
    defaults: { ssid: "", password: "" },
  },
  "mqtt-broker": {
    type: "mqtt-broker",
    label: "MQTT broker credential",
    namePlaceholder: "e.g. home-broker",
    fields: [
      { name: "broker", label: "host", kind: "text", placeholder: "e.g. 192.168.1.20 or broker.local" },
      { name: "port", label: "port", kind: "number" },
      // Both optional, same reasoning config-types.ts's own header used
      // to give for these two fields before the migration: an empty
      // username/password means "no broker auth," a normal, common
      // broker setup (mqtt_as's own config defaults both to "" for
      // exactly this reason) -- not a likely-forgotten-credential case
      // worth a loud rejection over.
      { name: "username", label: "username", kind: "text", placeholder: "optional" },
      { name: "password", label: "password", kind: "password", placeholder: "optional" },
    ],
    defaults: { broker: "", port: 1883, username: "", password: "" },
  },
};
