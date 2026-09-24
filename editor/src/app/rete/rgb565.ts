// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/rgb565.ts
//
// RGB565 <-> "#rrggbb" conversion for PaletteField.vue. An <input
// type="color"> only speaks 24-bit hex, while display_spi's palette is raw
// RGB565 (display-spi.ts's requirePalette). 565 -> 888 replicates the high
// bits into the low ones so 0xffff shows as #ffffff, not #f8fcf8; 888 ->
// 565 truncates. A picked color is therefore rounded to the nearest color
// the panel can show, which is what the device will draw anyway.

/** Raw RGB565 (0-65535) to "#rrggbb". Out-of-range input is clamped. */
export function rgb565ToHex(value: number): string {
  const v = Math.min(0xffff, Math.max(0, Math.round(Number(value) || 0)));
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  const r = (r5 << 3) | (r5 >> 2);
  const g = (g6 << 2) | (g6 >> 4);
  const b = (b5 << 3) | (b5 >> 2);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** "#rrggbb" to raw RGB565. Throws on anything that isn't a 6-digit hex color. */
export function hexToRgb565(hex: string): number {
  const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex.trim());
  if (!m) throw new Error(`"${hex}" is not a #rrggbb color`);
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

/** Formats a raw RGB565 value the way the flow file's own docs write it, e.g. "0xf800". */
export function formatRgb565(value: number): string {
  return "0x" + (Math.round(Number(value) || 0) & 0xffff).toString(16).padStart(4, "0");
}
