// SPDX-License-Identifier: Apache-2.0
// editor/src/app/editor-version.ts
//
// How the editor names its own build (Mike, 2026-10-07: "editor should display its version
// somewhere" -- a stale build, still targeting an old runtime, had been hard to spot). The values come
// from vite.config.ts's editorBuild() at build time; these functions only format them.

export interface EditorBuild {
  readonly version: string | null;
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly builtAt: string;
  /** Unique per build (its ISO build time); what servedBuildCheck compares. */
  readonly id: string;
}

/** Short label for the toolbar: "v0.1.2 · 3f2a9c1", "+" when built from uncommitted changes. */
export function editorVersionLabel(b: EditorBuild): string {
  const parts: string[] = [];
  if (b.version) parts.push(`v${b.version}`);
  if (b.commit) parts.push(b.commit + (b.dirty ? "+" : ""));
  return parts.length > 0 ? parts.join(" · ") : "dev build";
}

/** One line for Help → About, the toolbar tooltip and the console. */
export function editorVersionLine(b: EditorBuild): string {
  const commit = b.commit
    ? `, commit ${b.commit}${b.dirty ? " with uncommitted changes" : ""}`
    : ", commit unknown";
  return `Editor ${b.version ?? "(version unknown)"}${commit}, built ${b.builtAt}`;
}

/** Outcome of comparing this tab's build with the one the backend serves now. */
export type ServedBuildCheck =
  | { readonly state: "same" }
  /** Can't confirm: tab not served by this backend (e.g. `npm run dev`), or the backend reported no build. */
  | { readonly state: "unknown" }
  | { readonly state: "stale"; readonly served: EditorBuild };

/**
 * Compares this tab's build with `served`, the `editorBuild` field of the backend's /api/alive (2026-11-04: a tab
 * left open across an update and restart kept its old JavaScript and compiled old node code against the new
 * libraries). `servedByBackend` is false when the page came from somewhere else, such as Vite's dev server; then
 * the backend's editor/dist says nothing about this tab.
 */
export function servedBuildCheck(own: EditorBuild, served: unknown, servedByBackend: boolean): ServedBuildCheck {
  if (!servedByBackend || typeof served !== "object" || served === null) return { state: "unknown" };
  const s = served as Partial<Record<keyof EditorBuild, unknown>>;
  if (typeof s.id !== "string" || s.id === "") return { state: "unknown" };
  if (s.id === own.id) return { state: "same" };
  return {
    state: "stale",
    served: {
      version: typeof s.version === "string" ? s.version : null,
      commit: typeof s.commit === "string" ? s.commit : null,
      dirty: s.dirty === true,
      builtAt: typeof s.builtAt === "string" ? s.builtAt : s.id,
      id: s.id,
    },
  };
}

/** The console line for a stale tab: what happened, then what to do. */
export function staleTabLine(own: EditorBuild, served: EditorBuild): string {
  let mine = editorVersionLabel(own);
  let theirs = editorVersionLabel(served);
  if (mine === theirs) {
    // Same commit, rebuilt: the build times are what differ.
    mine += `, built ${own.builtAt}`;
    theirs += `, built ${served.builtAt}`;
  }
  return `[editor] this tab's build (${mine}) isn't the one the backend now serves (${theirs}). ` +
    "Deploy is off: save your flow, then reload the page";
}
