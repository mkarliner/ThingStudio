# tools

Build scripts and the dependency license-scan tooling flagged in design doc §12 (an SPDX-based checker over the pinned dependency tree, to run before any public release). Placeholder — nothing here yet.

- `build_fonts.py` -- builds the GUI font set: board modules in `device-runtime/src/vendor/fonts/` and the
  editor's metrics in `editor/src/gui/fonts/`, from `tools/fonts/` with the vendored `font_to_py`. Needs
  `pip install freetype-py`. `--check` fails if the committed outputs are stale.
