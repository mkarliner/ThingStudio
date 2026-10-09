// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/orientation-shared.ts
//
// Screen orientation as a config node (2026-10-09, Mike). `thingstudio/config/orientation` holds one angle, the
// clockwise turn of the picture from the panel's natural (unrotated) orientation: 0, 90, 180 or 270. Three nodes
// point at it and each works out its own part:
//   display_spi   writes the MADCTL bits for the turn, and takes the panel's own width/height as its size
//   gui_screen    lays out at the turned size (width and height swap at 90 and 270)
//   touch panel   (through the gui screen) flips/swaps raw touch coordinates to match
// A flow with no orientation keeps today's behaviour: raw `rotation` code, typed sizes, typed swap/flip.
//
// The model, checked against Adafruit's ST7789 table (rotation 1 = MV|MX = 90 degrees clockwise): the picture's
// logical pixel (x, y) goes to the panel as: swap x and y if MV, then mirror x if MX, then mirror y if MY (in the
// panel's own dimensions). The display node's `rotation` is the panel's mounting at angle 0, and with an
// orientation it may only mirror (0 to 3): no MV, so the unturned picture has the panel's own size.
// The mapping is brute-forced over the eight MADCTL combinations rather than written out as a table, so it can't
// disagree with the model above.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext } from "../compiler/node-definition.js";

export const ORIENTATION_CONFIG_TYPE = "thingstudio/config/orientation";
export type Angle = 0 | 90 | 180 | 270;

export const MADCTL_MV = 0x20;
export const MADCTL_MX = 0x40;
export const MADCTL_MY = 0x80;

type Pt = { x: number; y: number };

/** The picture size once turned: width and height swap at 90 and 270. */
export function turnedSize(width: number, height: number, angle: Angle): { width: number; height: number } {
  return angle === 90 || angle === 270 ? { width: height, height: width } : { width, height };
}

// The unturned picture is w x h (the panel's own size). Turning it clockwise by `angle` points the picture's x and
// y axes a quarter turn round the panel: at 90 the x axis runs down the panel and the y axis leftwards. These two
// convert a pixel between the turned picture and the unturned one.

/** The unturned pixel (in w x h) that has the same panel position as pixel `n` of the turned picture. */
function fromTurned(n: Pt, w: number, h: number, angle: Angle): Pt {
  switch (angle) {
    case 0: return n;
    case 90: return { x: w - 1 - n.y, y: n.x };
    case 180: return { x: w - 1 - n.x, y: h - 1 - n.y };
    case 270: return { x: n.y, y: h - 1 - n.x };
  }
}

/** Inverse of fromTurned: the turned picture's pixel at the position of unturned pixel `l`. */
function toTurned(l: Pt, w: number, h: number, angle: Angle): Pt {
  switch (angle) {
    case 0: return l;
    case 90: return { x: l.y, y: w - 1 - l.x };
    case 180: return { x: w - 1 - l.x, y: h - 1 - l.y };
    case 270: return { x: h - 1 - l.y, y: l.x };
  }
}

/** Where MADCTL `bits` sends logical pixel `l` on a panel of pw x ph. */
export function madctlMap(bits: number, l: Pt, pw: number, ph: number): Pt {
  const t = bits & MADCTL_MV ? { x: l.y, y: l.x } : l;
  return { x: bits & MADCTL_MX ? pw - 1 - t.x : t.x, y: bits & MADCTL_MY ? ph - 1 - t.y : t.y };
}

/** A few asymmetric sample points, so no two different transforms can agree on all of them. */
function samples(w: number, h: number): Pt[] {
  return [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: 0, y: h - 1 }, { x: 1, y: 2 }, { x: w - 2, y: 3 }];
}
const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/**
 * The MADCTL axis bits (MV, MX, MY) that show the picture turned clockwise by `angle`, given the panel's
 * mounting `baseBits` at angle 0 (mirror bits only) on a panel of width x height in its own orientation.
 */
export function orientedMadctl(baseBits: number, angle: Angle, width: number, height: number): number {
  if (baseBits & MADCTL_MV) throw new CompileError("with an orientation, rotation can't swap axes: use 0 to 3");
  const turned = turnedSize(width, height, angle);
  for (let bits = 0; bits < 8; bits++) {
    const axes = bits << 5; // MV 0x20, MX 0x40, MY 0x80
    const ok = samples(turned.width, turned.height).every((n) => {
      const old = fromTurned(n, width, height, angle);
      return same(madctlMap(axes, n, width, height), madctlMap(baseBits, old, width, height));
    });
    if (ok) return axes;
  }
  throw new CompileError(`no display orientation matches a turn of ${angle} degrees`); // unreachable: the eight bit patterns cover a square's symmetries
}

/** The touch driver's transform (swap, then flips on the swapped size), as the flags it takes. */
export interface TouchFlags { swapXY: boolean; flipX: boolean; flipY: boolean }

function touchMap(f: TouchFlags, p: Pt, w: number, h: number): Pt {
  let x = p.x;
  let y = p.y;
  let tw = w;
  let th = h;
  if (f.swapXY) {
    [x, y] = [y, x];
    [tw, th] = [th, tw];
  }
  if (f.flipX) x = tw - 1 - x;
  if (f.flipY) y = th - 1 - y;
  return { x, y };
}

/**
 * The touch flags that give coordinates in the picture turned clockwise by `angle`, given the panel's own
 * flags `base` (which already match the unturned picture) and its raw size width x height.
 */
export function orientedTouch(base: TouchFlags, angle: Angle, width: number, height: number): TouchFlags {
  const unturned = base.swapXY ? { width: height, height: width } : { width, height };
  for (let n = 0; n < 8; n++) {
    const f: TouchFlags = { swapXY: (n & 1) !== 0, flipX: (n & 2) !== 0, flipY: (n & 4) !== 0 };
    const ok = samples(width, height).every((raw) => {
      const l = touchMap(base, raw, width, height);
      const want = toTurned(l, unturned.width, unturned.height, angle);
      return same(touchMap(f, raw, width, height), want);
    });
    if (ok) return f;
  }
  throw new CompileError(`no touch orientation matches a turn of ${angle} degrees`);
}

/** The angle a node's `orientationConfigId` picks, or null when it has none (today's raw behaviour). */
export function resolveOrientation(ctx: CodegenContext, node: GraphNode, what: string): Angle | null {
  const id = node.properties.orientationConfigId;
  if (typeof id !== "string" || id === "") return null;
  const raw = ctx.resolveConfig(id).angle;
  const angle = Number(raw ?? 0);
  if (angle !== 0 && angle !== 90 && angle !== 180 && angle !== 270) {
    throw new CompileError(`${what}: orientation angle "${String(raw)}" must be 0, 90, 180 or 270`);
  }
  return angle;
}
