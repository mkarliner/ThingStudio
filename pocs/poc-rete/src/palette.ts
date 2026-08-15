// Thingstudio poc-rete — single source of truth for per-node-kind color +
// icon, shared between ThingstudioNode.vue (the actual canvas node render)
// and App.vue (the toolbar's "+" buttons, restyled as mini palette entries
// per Mike's steer against the real Node-RED screenshot, 2026-08-15 — see
// editor-look-and-feel-briefing.md). Kept in one file rather than defined
// twice so the toolbar button for a kind can never drift from what that
// kind's node actually renders as on the canvas.
//
// Colors match pocs/poc-c/nodes.js's palette (color = border/accent,
// bgcolor = fill) for a fair side-by-side per the briefing's "Why". Icons
// are plain Unicode glyphs (no icon asset library in this spike) chosen to
// echo real Node-RED's own iconography where there's a direct match — "ƒ"
// for function is literally Node-RED's own function-node glyph.
export type NodeKind = "inject" | "function" | "debug" | "gpio_out" | "mqtt_publish";

export interface KindStyle {
  color: string;
  bgcolor: string;
  icon: string;
  label: string;
}

export const NODE_PALETTE: Record<NodeKind, KindStyle> = {
  inject: { color: "#2e5c2e", bgcolor: "#1f3f1f", icon: "▶", label: "inject" },
  function: { color: "#6e5b2e", bgcolor: "#3f341f", icon: "ƒ", label: "function" },
  debug: { color: "#555555", bgcolor: "#2b2b2b", icon: "≡", label: "debug" },
  // "●" (a filled circle) was the original choice here — visually
  // indistinguishable from a socket dot when it sits right next to one
  // (the icon chip is flush against the left edge, same place the input
  // socket anchors), confirmed hands-on via the Chrome extension
  // (2026-08-15): looked like two overlapping circles, not one icon plus
  // one socket. "■" reads clearly as a distinct shape at a glance instead.
  gpio_out: { color: "#6e3b3b", bgcolor: "#3f1f1f", icon: "■", label: "gpio out" },
  mqtt_publish: { color: "#3b3b6e", bgcolor: "#1f1f3f", icon: "→", label: "mqtt out" },
};

export const DEFAULT_KIND_STYLE: KindStyle = { color: "#555", bgcolor: "#2b2b2b", icon: "?", label: "?" };
