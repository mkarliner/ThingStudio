// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/palette-folds.ts
//
// Which palette groups are folded (Mike, 2026-10-17): every group except "general" starts folded, and a
// group the user opens or folds stays that way across restarts, in this browser's localStorage. Only the
// groups the user has clicked are stored, so a group seen for the first time (a new custom node's) gets
// the default. Pure helpers here; PaletteSidebar.vue reads and writes the storage.

export const PALETTE_FOLDS_KEY = "thingstudio.paletteFolds";
export const OPEN_BY_DEFAULT = "general";

/** group name -> folded, for the groups the user has clicked. */
export type FoldState = Readonly<Record<string, boolean>>;

export function isFolded(state: FoldState, group: string): boolean {
  return Object.prototype.hasOwnProperty.call(state, group) ? state[group] === true : group !== OPEN_BY_DEFAULT;
}

export function toggleFold(state: FoldState, group: string): FoldState {
  return { ...state, [group]: !isFolded(state, group) };
}

/** Parses the stored value; anything unreadable is an empty state (every group back to its default). */
export function parseFolds(raw: string | null): FoldState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean") out[k] = b;
    return out;
  } catch {
    return {};
  }
}
