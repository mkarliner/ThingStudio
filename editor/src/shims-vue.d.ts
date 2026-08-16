// SPDX-License-Identifier: Apache-2.0
// editor/src/shims-vue.d.ts
//
// Standard Vue+TS boilerplate -- without this, `tsc` (not vite, which
// handles .vue natively via @vitejs/plugin-vue) has no idea what a `.vue`
// import resolves to. Ported from pocs/poc-rete/src/shims-vue.d.ts (same
// missing-declaration error that file documents catching, and confirmed
// against this exact toolchain in a scratch build during Phase 0/1 of
// docs/working-notes/rete-migration-decision.md's plan).
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
