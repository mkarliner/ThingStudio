// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/screens-store.ts
//
// The flow's `screens` section (gui/screens.ts) as shared editor state: main.ts loads it from the flow file and
// saves and compiles from it; ScreenOutline.vue edits it. A shallowRef holding an immutable value (gui/
// screen-edit.ts returns new objects, never mutates), so replacing it is the only change signal needed.
// Every edit also bumps the property version, which is what refreshes the source preview and re-enables Deploy.

import { shallowRef } from "vue";
import type { ScreenSpec, ScreensSection } from "../../gui/screens";
import { bumpPropertyVersion } from "./store";

export const screens = shallowRef<ScreensSection>({});

export function setScreens(s: ScreensSection): void {
  screens.value = s;
}

/** Applies an edit to one screen's layout (creating it empty first if it has none yet). */
export function updateScreen(screenId: string, fn: (s: ScreenSpec) => ScreenSpec): void {
  const current = screens.value[screenId] ?? { pages: [] };
  const next = fn(current);
  if (next === current) return;
  screens.value = { ...screens.value, [screenId]: next };
  bumpPropertyVersion();
}

/** A GUI-related node on the canvas, as the layout editor needs to list it. */
export interface GuiNodeInfo {
  readonly id: string;
  readonly type: string;
  readonly name: string;
}

let lister: () => GuiNodeInfo[] = () => [];

/** main.ts gives the layout editor a way to see the canvas's GUI nodes without importing the Rete editor. */
export function setGuiNodeLister(fn: () => GuiNodeInfo[]): void {
  lister = fn;
}

export function listGuiNodes(): GuiNodeInfo[] {
  return lister();
}
