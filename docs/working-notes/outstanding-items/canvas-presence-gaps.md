# Most of the node library still has no canvas presence

`wire-type-system-scoping.md` flagged this directly: of 16 registered node types at the time, only
`inject`/`function`/`debug`/`gpio_out`/`timer` were wired onto the Rete canvas originally. Since then `interrupt`,
`wifi_status`, `udp_send`, `udp_receive` were added — but `variable_get`, `variable_set`, `pwm_out`, `http_request`
are still registry-only: real compiler-side codegen, no Rete node class, no palette entry, unreachable from the
actual editor UI. This is a large, currently-invisible gap between "the node library" and "what a user can actually
drag onto the canvas."

**`boolean`/`arithmetic`/`comparator` removed from this list 2026-08-21** — not a canvas-wiring gap to close
anymore, removed as node types entirely (redundant with `function`, never wired, no type-safety benefit as actually
built). `decisions.md`, "Config nodes / Tier 1 scope" section; `thingstudio-design-doc.md` §6 addendum.

**`mqtt_publish`/`mqtt_subscribe` also removed from this list 2026-08-21** — given real Rete node classes, palette
entries, and `PropertyPanel.vue` blocks in the same change that migrated them to config nodes (see
`http-request-config-node-gap.md`); no longer a canvas-presence gap, still pending the real-hardware pass tracked
under `network-hardware-pass-status.md`.
