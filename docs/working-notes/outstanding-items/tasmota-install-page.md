# Tasmota-style runtime install page — not scoped, blocked on an unscoped prerequisite
> **2026-10-30 sweep:** Update: the unscoped prerequisite below now exists — the frozen classic- ESP32 image is
  catalogued and editor-flashable from blank. What remains unbuilt is the on-device install-page
  feature itself.


Needs `device-runtime` packaged as a single flashable image first (a frozen MicroPython build with the listener/runtime baked in) — that packaging question isn't scoped anywhere either. `deployment-and-distribution-notes.md`.

## 2026-11-18

Being delivered as the online build's install page (`editor/setup.html`, served at web.thingstudio.net/setup), on the branch
`online-editor-webserial`: flash in the browser, then Install runtime. Close this item when the branch is merged and
live. Plan: `online-editor-webserial-briefing.md`, section D.
