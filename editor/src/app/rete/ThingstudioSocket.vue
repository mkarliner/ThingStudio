<!--
  editor/src/app/rete/ThingstudioSocket.vue

  Custom socket renderer, replacing the default `Presets.classic`
  Socket.vue (a fixed 24x24 circle with a 6px margin). Wired in via
  `customize.socket()` in editor-setup.ts alongside `customize.node()`.
  Ported verbatim from pocs/poc-rete/src/ThingstudioSocket.vue -- see that
  file's own header for why this needs to be its own component rather than
  CSS on ThingstudioNode.vue's port wrapper: the wrapper only anchors
  *where* a socket sits, the visible circle is a separate component
  VuePlugin mounts *inside* that wrapper, and without overriding this too
  that inner circle stays the default 24x24 box regardless of the
  wrapper's own sizing (confirmed hands-on in poc-rete: oversized circles
  hanging off a correctly-positioned but invisible anchor).
-->
<template>
  <div class="ts-socket-dot" :title="data.name" />
</template>

<script setup lang="ts">
// `data` is the actual socket instance (AnySocket, sockets.ts) -- the
// renderer hands the render context's `payload` straight through as this
// prop, same pattern as ThingstudioNode.vue's `data`. `.name` is set by
// `ClassicPreset.Socket`'s own constructor from the string passed to
// `super(...)` ("any" for this app's one socket type) -- used here only as
// a hover tooltip.
defineProps<{ data: { name: string } }>();
</script>

<style scoped>
.ts-socket-dot {
  /* Width/height must match ThingstudioNode.vue's `SOCKET_SIZE` constant --
     that file uses this size to compute where to position the anchor
     wrapping this dot. */
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
