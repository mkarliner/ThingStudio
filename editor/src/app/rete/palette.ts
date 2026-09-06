// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/palette.ts
//
// Single source of truth for per-node-kind color + icon, shared between
// ThingstudioNode.vue (canvas render) and PaletteSidebar.vue (the sidebar
// list) so neither can drift from the other -- same reasoning
// pocs/poc-rete/src/palette.ts gives for its own version of this file.
//
// Colors are app/nodes.ts's real values (rete-migration-decision.md, Phase
// 1 step 5), not poc-c's/poc-rete's: debug is `#2e4a6e`/`#1f2c3f` here, not
// poc-rete's grey `#555555`/`#2b2b2b`, and timer (`#5b3b6e`/`#331f3f`) has
// no poc-rete equivalent at all, being a new type. Icons are plain Unicode
// glyphs, same convention poc-rete established (no icon asset library) --
// "◷" for timer chosen to echo a clock/interval, matching
// "▶"/"ƒ"/"≡"/"■"'s one-glyph-per-kind pattern.
//
// wifi_status/udp_send/udp_receive added config-node-and-palette-
// implementation-briefing.md (2026-08-18): the palette-wiring half of that
// session, following interrupt's own wiring exactly. Colors picked from
// the unused range below existing kinds (a teal/blue network-ish family,
// distinct from debug's own blue and interrupt's amber). http_request
// stayed registry-only at the time -- an explicit, flagged follow-up (see
// that briefing's own "Success criteria" section), not silently dropped.
//
// mqtt_publish/mqtt_subscribe added 2026-08-21 (same config-node migration
// as wifi_status/udp_send/udp_receive got, plus first-time canvas wiring --
// see nodes.ts's own header). Magenta/purple pair, distinct from every
// existing network-node color -- "⇧"/"⇩" (hollow, double-stroke arrows)
// echo udp_send/udp_receive's own "↑"/"↓" direction-of-travel convention
// while staying visually distinct from them.
//
// http_request given a palette entry, 2026-09-05 -- its long-flagged
// canvas-presence follow-up finally closed (nodes.ts's own header). Lands
// in the "network" group alongside every other network node type (group
// field added by the 2026-09-04 UI-cleanup pass). Amber/gold, distinct
// from every other network-node color used so far -- "⇄" (bidirectional
// arrows) for the one network node type here that's a transform (both
// sends a request and returns a response) rather than a pure source or
// sink, echoing udp_send/udp_receive/mqtt_publish/mqtt_subscribe's own
// direction-of-travel icon convention without reusing any of their
// single-direction glyphs.
//
// delay added 2026-09-06 (mikes-questions-and-points.md's original node-
// prioritisation list, never built until now -- outstanding-items.md).
// "general" group, alongside inject/function/timer -- it's a plain
// message-flow building block, not network- or hardware-specific.
// Slate-blue, distinct from every existing color; "⌛" (hourglass) for
// the waiting semantics, distinct from timer's own "◷" clock glyph
// (timer repeats on an interval, delay waits out a single one).
//
// pwm_out added 2026-09-06 -- one of the last three node types
// canvas-presence-gaps.md flagged as registry-only. "hardware" group,
// alongside gpio_out/interrupt -- real GPIO peripheral output. Blue,
// distinct from gpio_out's maroon and interrupt's amber; "∿" (sine wave)
// for the duty-cycle/analog-ish nature of PWM, distinct from gpio_out's
// binary "■" and interrupt's "⚡".
//
// variable_get/variable_set: given canvas presence alongside pwm_out
// 2026-09-06, then hidden again the same day -- Mike's call, after
// walking through the actual use case (decoupling a producer and a
// consumer on independent triggers, e.g. a timer-fed variable_set and an
// mqtt_subscribe-fed variable_get sharing a name) and deciding the right
// answer is to do this properly, Node-RED-style
// (https://nodered.org/docs/user-guide/context -- node/flow/global
// scope, pluggable storage backends, a generic node for setting context
// rather than a single-purpose one) rather than ship the current narrow
// pair. Codegen/registry (variable-get.ts/variable-set.ts) and the
// function node's flow.get/flow.set (which read/write the exact same
// store) are UNCHANGED and still fully working -- only the two
// dedicated canvas nodes are hidden. See
// docs/working-notes/decisions/editor-canvas.md and
// outstanding-items/context-model-node-red-style.md.
export type NodeKind =
  | "inject"
  | "function"
  | "debug"
  | "gpio_out"
  | "pwm_out"
  | "timer"
  | "interrupt"
  | "wifi_status"
  | "udp_send"
  | "udp_receive"
  | "http_request"
  | "mqtt_publish"
  | "mqtt_subscribe"
  | "delay";

export const DEFAULT_NODE_GROUPS = ["general", "network", "hardware"] as const;

export interface KindStyle {
  color: string;
  bgcolor: string;
  icon: string;
  label: string;
  /** Palette section this kind sorts into (PaletteSidebar.vue). One of
   * DEFAULT_NODE_GROUPS for every built-in kind today, but not typed as
   * that closed union -- a custom node's own descriptor.group (custom-
   * node.ts) shares this same field name/meaning and is free-form. */
  group: string;
}

export const NODE_PALETTE: Record<NodeKind, KindStyle> = {
  inject: { color: "#2e5c2e", bgcolor: "#1f3f1f", icon: "▶", label: "inject", group: "general" },
  function: { color: "#6e5b2e", bgcolor: "#3f341f", icon: "ƒ", label: "function", group: "general" },
  debug: { color: "#2e4a6e", bgcolor: "#1f2c3f", icon: "≡", label: "debug", group: "general" },
  gpio_out: { color: "#6e3b3b", bgcolor: "#3f1f1f", icon: "■", label: "gpio out", group: "hardware" },
  timer: { color: "#5b3b6e", bgcolor: "#331f3f", icon: "◷", label: "timer", group: "general" },
  // Distinct from every existing color -- amber/orange, no prior node type
  // uses this range. "⚡" for the hard-IRQ-driven, event-fired nature (vs.
  // timer's "◷" clock glyph for its own poll/sleep-shaped source).
  interrupt: { color: "#8a5a1f", bgcolor: "#3f2e14", icon: "⚡", label: "interrupt", group: "hardware" },
  // Teal -- a status/radio glyph ("◉") for the polling connectivity check.
  wifi_status: { color: "#1f6e6e", bgcolor: "#123f3f", icon: "◉", label: "wifi status", group: "network" },
  // Blue/green send-receive pair, up/down arrows echoing direction of
  // travel the same way interrupt's "⚡" echoes its own trigger mechanism.
  udp_send: { color: "#3b5c8a", bgcolor: "#1f2e4a", icon: "↑", label: "udp send", group: "network" },
  udp_receive: { color: "#3b8a6e", bgcolor: "#1f4a3a", icon: "↓", label: "udp receive", group: "network" },
  // Amber/gold -- see this file's header for the icon reasoning.
  http_request: { color: "#8a6e1f", bgcolor: "#4a3a1f", icon: "⇄", label: "http request", group: "network" },
  // Magenta/purple pair -- see this file's header for the icon reasoning.
  mqtt_publish: { color: "#8a3b6e", bgcolor: "#4a1f3a", icon: "⇧", label: "mqtt publish", group: "network" },
  mqtt_subscribe: { color: "#6e3b8a", bgcolor: "#3a1f4a", icon: "⇩", label: "mqtt subscribe", group: "network" },
  // Slate-blue -- see this file's header for the icon reasoning.
  delay: { color: "#4a4a6e", bgcolor: "#2a2a3f", icon: "⌛", label: "delay", group: "general" },
  // Blue -- see this file's header for the icon reasoning.
  pwm_out: { color: "#1f5c8a", bgcolor: "#12334a", icon: "∿", label: "pwm out", group: "hardware" },
};

export const DEFAULT_KIND_STYLE: KindStyle = { color: "#555", bgcolor: "#2b2b2b", icon: "?", label: "?", group: "general" };

// Shared between PaletteSidebar.vue's `dragstart` (dataTransfer.setData)
// and the eventual app-shell `drop` handler (dataTransfer.getData) -- not
// wired to a drop target yet (Phase 3, alongside main.ts's rewrite). A
// plain string constant in one place so the two ends of the drag gesture
// can't drift out of sync with each other later, same reasoning
// NODE_PALETTE itself gets.
export const DRAG_MIME = "application/x-thingstudio-node-kind";

// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20): a separate MIME type from DRAG_MIME above --
// a dropped custom node's payload is its own namespaced type id (e.g.
// "custom/dht22"), not a NodeKind literal, so the canvas drop handler
// (main.ts) needs a way to tell which table to resolve the dropped value
// against without guessing from its shape.
export const CUSTOM_DRAG_MIME = "application/x-thingstudio-custom-node-type";
