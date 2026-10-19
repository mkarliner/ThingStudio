# Compile-hook browser smoke test fixtures

Used by `tools/compile_hook_smoke.py`. Not user-facing; not part of the docs or the example nodes.

- `hooked.flow.json` -- `wifi_status` (a core package with a compile hook) + `debug`, an "unmanaged" WiFi config so
  no saved credential is needed.
- `spin.flow.json` -- `timer` -> `smoke/spin` -> `debug`.
- `custom-nodes/spin.*` -- a custom node whose `compile.py` loops forever, to exercise the 1 s hook budget. Copied
  into the test's throwaway data folder; never into `~/.thingstudio`.

The hook-free case reuses `docs/screenshots/blink.flow.json`.
