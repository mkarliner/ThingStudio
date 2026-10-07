# font_to_py (vendored build tool)

`font_to_py.py` from [peterhinch/micropython-font-to-py](https://github.com/peterhinch/micropython-font-to-py),
repo HEAD `c24761448e6ef1c40716b9b2b629e6fa37b2c9d2` (2025-05-28), version 0.42. MIT, `LICENSE`. Unmodified.
sha256 first 16 hex digits: `662aa116f80d2bea`.

Build-time only: `tools/build_fonts.py` runs it to convert `tools/fonts/` into font modules. It needs
`freetype-py` (`pip install freetype-py`). Nothing here is shipped to boards or in the release bundles; the
generated font modules are (each under its source font's licence).
