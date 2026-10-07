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
