# Most of the node library still has no canvas presence

`wire-type-system-scoping.md` flagged this directly: of 16 registered node types at the time, only
`inject`/`function`/`debug`/`gpio_out`/`timer` were wired onto the Rete canvas originally. Since then `interrupt`,
`wifi_status`, `udp_send`, `udp_receive` were added — but `variable_get`, `variable_set`, `pwm_out`
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

**`http_request` also removed from this list 2026-09-05** — given a real Rete node class (`HttpRequestNode`,
`nodes.ts`), a palette entry (`palette.ts`, "network" group), and a `PropertyPanel.vue` section, following
`mqtt-publish.ts`'s own worked example (see `http-request-config-node-gap.md`). Off-device verified clean
2026-09-06 (`tsc --noEmit`, full `vitest` suite) but **not yet committed and not yet given a real-hardware
pass** — tracked as its own active item under "Network / config nodes" in the top-level index, not folded into
this file's own resolved history.

**Fully closed 2026-09-06** — the last three registry-only types (`variable_get`, `variable_set`, `pwm_out`)
given real canvas presence, following `http_request`'s own worked example (Rete node class, palette entry,
`PropertyPanel.vue` section). `variable_get`'s output port is dynamic (`payloadType`-dependent, same
`resolvePortType` mechanism `inject`'s own output already used) with its own `retypeOutput()` method and
`PropertyPanel.vue` `@change` handler, mirroring `InjectNode`'s. `variable_set`: plain `any`-in/`any`-out
pass-through, same shape as `function`. `pwm_out`: single `duty` (`number`) input, sink kind, same shape as
`gpio_out`'s own `signal` input. Existing off-device tests (`node-variable.test.ts`, `node-pwm-out.test.ts`)
gained port-declaration assertions; nothing about each node's own codegen changed. Off-device verified clean
(`tsc --noEmit`, full `vitest` suite: 29 files / 329 tests passing, up from 326). This file's own gap is now
fully closed — nothing left registry-only in the node library. Only the git commit is still owed.
