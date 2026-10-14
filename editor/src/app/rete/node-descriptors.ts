// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/node-descriptors.ts
//
// The one lookup for a built-in node's canonical descriptor
// (compiler/node-descriptor.ts), built from the compiler registry so the canvas, the palette and the
// catalog all read the same data a compiled flow does. A built-in is "migrated" when its
// NodeDefinition carries a `paletteId` (node-descriptor-unification-briefing.md); until every family
// is migrated, an unmigrated kind still gets its styling from palette.ts's NODE_PALETTE.
//
// App layer, deliberately: it reads node-library/registry.ts (allowed from app/, not from compiler/)
// and palette.ts's fallback row.
import { buildRegistry } from "../../node-library/registry.js";
import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type KindStyle, type NodeKind } from "./palette.js";

let cache: Map<string, NodeDescriptor> | null = null;

/** Every migrated built-in descriptor, keyed by its short palette id. Built once, lazily. */
export function builtinDescriptors(): Map<string, NodeDescriptor> {
  if (!cache) {
    cache = new Map<string, NodeDescriptor>();
    for (const def of buildRegistry().values()) {
      if (def.paletteId) cache.set(def.paletteId, def);
    }
  }
  return cache;
}

/** The canonical descriptor for a migrated built-in kind, or undefined for an unmigrated/custom kind. */
export function descriptorFor(kind: string): NodeDescriptor | undefined {
  return builtinDescriptors().get(kind);
}

/** A node kind's palette styling: the migrated descriptor's own fields when present, else
 * palette.ts's legacy row, else the default. One place so the canvas, palette sidebar, property
 * panel and catalog can't drift from one another during the migration. */
export function paletteStyleFor(kind: string): KindStyle {
  const d = descriptorFor(kind);
  if (d && d.label !== undefined && d.group !== undefined && d.priority !== undefined) {
    return {
      color: d.color ?? DEFAULT_KIND_STYLE.color,
      bgcolor: d.bgcolor ?? DEFAULT_KIND_STYLE.bgcolor,
      icon: d.icon ?? DEFAULT_KIND_STYLE.icon,
      label: d.label,
      group: d.group,
      priority: d.priority,
    };
  }
  return NODE_PALETTE[kind as NodeKind] ?? DEFAULT_KIND_STYLE;
}
