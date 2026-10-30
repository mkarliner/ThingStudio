# Tasmota-style runtime install page — not scoped, blocked on an unscoped prerequisite
> **2026-10-30 sweep:** Update: the unscoped prerequisite below now exists — the frozen classic- ESP32 image is
  catalogued and editor-flashable from blank. What remains unbuilt is the on-device install-page
  feature itself.


Needs `device-runtime` packaged as a single flashable image first (a frozen MicroPython build with the listener/runtime baked in) — that packaging question isn't scoped anywhere either. `deployment-and-distribution-notes.md`.
