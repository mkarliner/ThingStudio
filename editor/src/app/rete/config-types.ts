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
//     provisions its own WiFi outside of any deployed flow (a soft-AP/
//     captive-portal fallback, raised by Mike 2026-08-20 -- BUILT
//     2026-09-14, device-runtime/src/wifi_provision.py, see
//     outstanding-items/wifi-provisioning-captive-portal.md) is exactly
//     the real case this state exists for -- a flow's network nodes still
//     need a way to say "someone else manages this connection" without
//     that way being an easy-to-miss blank field. The new
//     `allowReprovisioning` field below is what actually opts a config
//     into this feature's fallback-reprovisioning behavior; "unmanaged"
//     alone (this field) is what tells the compiler this feature is in
//     play for the flow at all (computeWifiProvisionMarker(), wifi-status.ts).

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
  kind: "text" | "password" | "number" | "select" | "credential" | "boolean" | "configRef";
  /** Only meaningful when `kind` is "configRef" -- the config type this field points at (another config's id),
   * edited with a nested ConfigRefField. First user: a touch panel's I2C bus. */
  configType?: string;
  /** Only meaningful when `kind` is "select" -- the fixed set of allowed values. */
  options?: { value: string; label: string }[];
  /** Only meaningful when `kind` is "credential" -- which credential-store
   * namespace this field resolves against (credential-types.ts). */
  credentialType?: "wifi" | "mqtt-broker";
  /** Short plain-text note rendered under the field, any kind -- added for
   * "boolean" (`allowReprovisioning` below) specifically because a checkbox's
   * label alone can't carry the security caveat Mike asked for (a loud
   * warning, not a quiet default-off setting easy to flip without reading) --
   * see docs/working-notes/outstanding-items/wifi-provisioning-captive-
   * portal.md's "Trigger condition" decision. Generic on the descriptor
   * (not hardcoded to this one field) so any future field can use it the
   * same way, matching this file's own established "derive from field/
   * option data, don't hardcode to WiFi" convention. */
  help?: string;
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
  /** At most one config of this type exists in a flow (2026-09-25, Mike's call, for WiFi: a board has one
   * radio). Any node can still pick or create one from its own field; store.ts's createConfig() hands back
   * the existing instance, updated, instead of adding a second -- so every node that asks gets the same one
   * and nothing else needs to know. */
  singleton?: boolean;
  /** Keyed singleton (2026-09-26, I2C bus): at most one config per value of this field. store.ts's
   * createConfig() hands back the existing config with the same key, and ConfigRefField's "+" starts a new
   * one on the lowest unused key. Two configs made to share a key by editing are a compile error in the
   * nodes that use them (i2c-shared.ts). Values are compared as numbers. */
  keyField?: string;
}

export const CONFIG_TYPES: Record<string, ConfigTypeDescriptor> = {
  "thingstudio/config/wifi": {
    type: "thingstudio/config/wifi",
    label: "WiFi",
    singleton: true,
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
      {
        // wifi-provisioning-captive-portal.md (2026-09-14, confirmed with Mike): kept as its own
        // field rather than folded into `security` above -- same reasoning wifi-status.ts's own
        // `deferToMqtt` is kept separate from `security` (a flow author's declared intent vs. a
        // second, independently-toggled choice). Only meaningful when security is "unmanaged" --
        // computeWifiProvisionMarker() (wifi-status.ts) only ever reads it in that branch -- but
        // always shown, same as `security` itself; no conditional-field-visibility mechanism exists
        // in this generic per-kind loop yet, not worth building for one field.
        name: "allowReprovisioning",
        label: "Allow reprovisioning on connect failure",
        kind: "boolean",
        help:
          "Off by default: the device only opens its setup AP on first run. Turning this on lets " +
          "it reopen that AP any time WiFi drops, not just once -- only do this on a trusted, " +
          "physically-controlled network. Anyone in radio range while WiFi is down could otherwise " +
          "connect to the AP and redirect this device to a different network.",
      },
    ],
    defaults: { credentialName: "", security: "password", allowReprovisioning: false },
    // The credential's own name doubles as the summary -- Fork #1 (the
    // design doc) already makes it a human-chosen nickname for a real
    // network ("home-wifi"), so there's no separate SSID to show anymore.
    summarize: (properties) => (typeof properties.credentialName === "string" ? properties.credentialName : ""),
  },
  // I2C bus (2026-09-26): pins and clock, set once per bus and shared by every I2C node on it
  // (node-library/i2c-shared.ts). Keyed by bus number.
  "thingstudio/config/i2c-bus": {
    type: "thingstudio/config/i2c-bus",
    label: "I2C bus",
    keyField: "bus",
    fields: [
      { name: "bus", label: "bus", kind: "number" },
      { name: "scl", label: "scl pin", kind: "number" },
      { name: "sda", label: "sda pin", kind: "number" },
      { name: "freq", label: "frequency (Hz)", kind: "number", help: "100000 suits most sensors; 400000 for displays that can take it." },
    ],
    defaults: { bus: 0, scl: null, sda: null, freq: 100000 },
    summarize: (p) => {
      const pins = p.scl !== null && p.scl !== undefined && p.sda !== null && p.sda !== undefined ? `SCL ${String(p.scl)}, SDA ${String(p.sda)}` : "pins not set";
      return `bus ${String(p.bus ?? 0)}: ${pins}`;
    },
  },
  // Touch panel (2026-10-09, button rework): the controller, its I2C bus and the panel's geometry, set once. A gui
  // screen names one and polls it itself; a touch_i2c node can name one for raw {x, y}. Using one panel from two
  // places is a compile error (node-library/touch-panel-shared.ts).
  "thingstudio/config/touch-panel": {
    type: "thingstudio/config/touch-panel",
    label: "Touch panel",
    fields: [
      {
        name: "controller",
        label: "controller",
        kind: "select",
        options: [{ value: "ft6336u", label: "FT6336U (Freenove ESP32 displays)" }],
        help: "Other controllers (GT911, CST820) aren't supported yet.",
      },
      { name: "i2cConfigId", label: "I2C bus", kind: "configRef", configType: "thingstudio/config/i2c-bus" },
      { name: "address", label: "address", kind: "text", help: "7-bit, e.g. 0x38." },
      { name: "rstPin", label: "reset pin", kind: "text", help: "Blank if the panel has none." },
      { name: "pollMs", label: "poll every (ms)", kind: "number" },
      { name: "width", label: "panel width", kind: "number" },
      { name: "height", label: "panel height", kind: "number", help: "The panel's own size. If the display is rotated, tick swap/flip until a touch lands where you pressed." },
      { name: "swapXY", label: "swap x and y", kind: "boolean" },
      { name: "flipX", label: "flip x", kind: "boolean" },
      { name: "flipY", label: "flip y", kind: "boolean" },
    ],
    defaults: { controller: "ft6336u", i2cConfigId: "", address: "0x38", rstPin: "", pollMs: 20, width: 320, height: 480, swapXY: false, flipX: false, flipY: false },
    summarize: (p) => `${String(p.controller ?? "ft6336u").toUpperCase()} ${String(p.width ?? "?")}x${String(p.height ?? "?")}`,
  },
  "thingstudio/config/mqtt-broker": {
    type: "thingstudio/config/mqtt-broker",
    label: "MQTT Broker",
    fields: [{ name: "credentialName", label: "credential", kind: "credential", credentialType: "mqtt-broker" }],
    defaults: { credentialName: "" },
    summarize: (properties) => (typeof properties.credentialName === "string" ? properties.credentialName : ""),
  },
};
