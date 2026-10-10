# GUI fonts (source files)

Source fonts for the GUI font set. `tools/build_fonts.py` converts them with `font_to_py` into the board modules
(`device-runtime/src/vendor/fonts/`) and the editor's metrics (`editor/src/gui/fonts/`). The list of fonts,
sizes and character sets is in `device-runtime/runtime_manifest.py` (`FONT_SOURCES`, `FONT_CHARSETS`,
`FONT_SIZES`).

- `AtkinsonHyperlegible-Regular.ttf`, `AtkinsonHyperlegible-Bold.ttf`: Atkinson Hyperlegible by the Braille
  Institute of America, from [googlefonts/atkinson-hyperlegible](https://github.com/googlefonts/atkinson-hyperlegible)
  (`fonts/ttf/`, repo HEAD `1cb311624b2ddf88e9e37873999d165a8cd28b46`, 2021-04-29). SIL Open Font License 1.1,
  `OFL.txt`; no Reserved Font Name. Unmodified. sha256: Regular `7fb917c89019896d…`, Bold `5a3b0c8cc8ca5451…`
  (first 16 hex digits).

Chosen by Mike, 2026-10-07, from a look test against DejaVu Sans and Spleen
(`docs/working-notes/gui-font-pipeline-scoping.md`).

- `DSEG7Classic-Bold.ttf`: DSEG7 Classic Bold from DSEG v0.46 by Keshikan
  ([keshikan/DSEG](https://github.com/keshikan/DSEG)), seven-segment display font. SIL Open Font License 1.1,
  `DSEG-LICENSE.txt`; Reserved Font Name "DSEG". Unmodified. sha256 begins `d16181c4eeae29e695ca`.
  Used as the `seg7` set (digits, colon, dot, minus, space) for clock readouts.
