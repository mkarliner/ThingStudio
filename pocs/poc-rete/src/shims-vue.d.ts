// Standard Vue+TS boilerplate — without this, `tsc` (not vite, which
// handles .vue natively via @vitejs/plugin-vue) has no idea what a `.vue`
// import resolves to. Missing this is what produced main.ts's
// "Cannot find module './App.vue'" error under `tsc --noEmit`.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
