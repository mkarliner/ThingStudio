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
// Deliberately just one entry for this session's success bar --
// `thingstudio/config/wifi`, `{ssid, password}` -- matching the one
// config type the briefing scopes as required (a `mqtt_broker` config
// type is explicitly optional/deferred, see mqtt-shared.ts's own header
// on why it still takes `ssid`/`password` directly for now).
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

export interface ConfigFieldDescriptor {
  /** Must match the key this field is stored under in a config's own `properties`. */
  name: string;
  label: string;
  kind: "text" | "password" | "number" | "select";
  /** Only meaningful when `kind` is "select" -- the fixed set of allowed values. */
  options?: { value: string; label: string }[];
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
      { name: "ssid", label: "SSID", kind: "text" },
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
      { name: "password", label: "password", kind: "password" },
    ],
    defaults: { ssid: "", security: "password", password: "" },
    summarize: (properties) => (typeof properties.ssid === "string" ? properties.ssid : ""),
  },
};
