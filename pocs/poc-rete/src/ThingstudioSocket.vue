<!--
  Thingstudio poc-rete — custom socket renderer, replacing the default
  `Presets.classic` Socket.vue (a fixed 24×24 circle with a 6px margin,
  checked in the installed rete-vue-plugin bundle). Wired in via
  `customize.socket()` in editor-setup.ts alongside `customize.node()`.

  Why this needed its own component rather than just CSS on
  ThingstudioNode.vue's port wrapper: the wrapper (a `Ref`-rendered div,
  positioned/sized by ThingstudioNode.vue's `.ts-port` class) only anchors
  *where* a socket sits — the actual visible circle is a separate component
  VuePlugin mounts *inside* that wrapper once `Ref` emits its `render`
  signal. Without overriding `customize.socket` too, that inner circle is
  still the default Socket.vue's own 24×24/6px-margin box, which the
  wrapper's sizing has no power over — confirmed hands-on (Mike's
  screenshot, 2026-08-15): oversized green balls hanging off a
  barely-visible correctly-positioned anchor point, not a CSS specificity
  problem, a "styling the wrong element" one.
-->
<template>
  <div class="ts-socket-dot" :title="data.name" />
</template>

<script setup lang="ts">
// `data` is the actual `ClassicPreset.Socket` instance (or one of this
// app's `BoolSocket`/`NumberSocket`/etc. subclasses, sockets.ts) — the
// renderer hands the render context's `payload` straight through as this
// prop, same pattern as ThingstudioNode.vue's `data` (confirmed in the
// installed bundle's `render()`, not assumed). `.name` is set by
// `ClassicPreset.Socket`'s own constructor from the string passed to
// `super(...)` — "bool"/"number"/"string"/"any" for this app's sockets —
// used here only as a hover tooltip, not for color-coding (out of scope
// for this pass; every socket renders identically regardless of type).
defineProps<{ data: { name: string } }>();
</script>

<style scoped>
.ts-socket-dot {
  /* Width/height must match ThingstudioNode.vue's `SOCKET_SIZE` constant —
     that file uses this size to compute where to position the anchor
     wrapping this dot (in pixels, not a CSS transform — see its
     `portStyle()` comment for why a transform broke wire endpoints). */
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 6px;
  border: 1px solid #fff;
  background: #96b38a;
  cursor: pointer;
}
.ts-socket-dot:hover {
  border-width: 2px;
}
</style>
