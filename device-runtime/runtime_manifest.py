# SPDX-License-Identifier: Apache-2.0
# device-runtime/runtime_manifest.py
#
# The one file list for "what device-runtime/src/*.py + vendor libs get pushed onto a board's
# filesystem to install/upgrade the runtime" -- shared by test-flows/deploy_runtime.py (the
# existing manual mpremote-based path) and backend/src/thingstudio_backend/runtime_installer.py
# (the new browser-triggered path, outstanding-items/deploy-runtime-from-editor.md's 2026-09-22
# scoping) so the two can't silently drift the way two hand-maintained copies of the same list
# eventually do -- CLAUDE.md's own concern elsewhere in this project (device-runtime version
# bump discipline), applied here before a second copy of this particular list got a chance to
# exist at all rather than after the fact.
#
# Plain-data module, stdlib only, deliberately living at device-runtime/'s top level (not under
# src/) -- this file itself is host-side tooling metadata, never pushed to a board, and living
# outside src/ keeps that distinction obvious rather than relying on a comment alone.

from __future__ import annotations

# Copied as-is onto the device -- everything listener.py imports at module scope. wifi_provision.py
# added 2026-09-14 (see listener.py's own guarded `import wifi_provision`, which degrades to a
# no-op on a board bootstrapped before this line existed, so a re-run of an install onto an
# already-bootstrapped board is never destructive just because this list grows).
# deps.py added 2026-10-07 (flow dependencies).
CORE_FILES: list[str] = ["errors.py", "cbor.py", "framing.py", "messages.py", "protocol.py", "runtime.py", "wifi_provision.py", "board_settings.py", "net_transport.py", "deps.py"]

# Installed as main.py so the board boots straight into it.
LISTENER_FILE: str = "listener.py"

# Flow dependencies (2026-10-07, docs/working-notes/flow-dependencies-scoping.md). Replaces
# VENDOR_FILES: vendored libraries are no longer pushed to every board at runtime install. Deploy
# installs the ones a flow imports into the board's /lib (device-runtime/src/deps.py), and removes
# them once no flow needs them.
#
# One entry per library:
#   name     -- what the board's index and the DEP_PUT/DEPLOY messages call it. Kept equal to the
#               module name, so the editor can map an `import x` in a compiled flow straight to it.
#   files    -- (path relative to device-runtime/src/vendor/, file name on the board). Every file
#               name, minus .py, is a module the library provides.
#   requires -- other libraries this one imports. The editor installs those too.
# Served to the editor as JSON at /api/dependencies (backend dependencies.py), which also checks
# this list (names, files present, requires known, no cycles).
DEPENDENCIES: list[dict] = [
    {"name": "threadsafe_event", "files": [("threadsafe_event/threadsafe_event.py", "threadsafe_event.py")], "requires": []},
    # mqtt_as's own __init__.py lands flat as mqtt_as.py: generated code does `import mqtt_as`.
    {"name": "mqtt_as", "files": [("mqtt_as/__init__.py", "mqtt_as.py")], "requires": []},
    {"name": "delay_ms", "files": [("primitives_events/delay_ms.py", "delay_ms.py")], "requires": []},
    {"name": "events", "files": [("primitives_events/events.py", "events.py")], "requires": ["delay_ms"]},
    {"name": "st7789py", "files": [("st7789py_mpy/st7789py.py", "st7789py.py")], "requires": []},
    {"name": "ssd1306", "files": [("ssd1306/ssd1306.py", "ssd1306.py")], "requires": []},
    {"name": "bme280_float", "files": [("bme280/bme280_float.py", "bme280_float.py")], "requires": []},
    # Thingstudio's own GUI subsystem (gui-layout-widget-system-scoping.md, phase 4): a library, not part of the
    # runtime, so flows without a GUI never carry it.
    {"name": "thingstudio_gui", "files": [("thingstudio_gui/gui.py", "thingstudio_gui.py")], "requires": []},
    # One library per widget type, so a flow carries only the widgets it uses. They draw through the surface
    # they're given and import nothing from thingstudio_gui.
    {"name": "tsgui_label", "files": [("thingstudio_gui/label.py", "tsgui_label.py")], "requires": []},
    {"name": "tsgui_readout", "files": [("thingstudio_gui/readout.py", "tsgui_readout.py")], "requires": []},
    {"name": "tsgui_bar", "files": [("thingstudio_gui/bar.py", "tsgui_bar.py")], "requires": []},
    {"name": "tsgui_led", "files": [("thingstudio_gui/led.py", "tsgui_led.py")], "requires": []},
    {"name": "tsgui_pagedots", "files": [("thingstudio_gui/pagedots.py", "tsgui_pagedots.py")], "requires": []},
]

# GUI fonts (2026-10-07, docs/working-notes/gui-font-pipeline-scoping.md): a prebuilt set, one library per
# (charset, size), so a flow carries only the fonts its generated code imports. tools/build_fonts.py reads
# these three tables, converts tools/fonts/<source> with font_to_py into vendor/fonts/font_<id>.py, and writes
# the editor's metrics/bitmap JSON (editor/src/gui/fonts/<id>.json). Font data loaded from a .mpy stays in
# RAM, so keep the set small. Atkinson Hyperlegible (SIL OFL 1.1), chosen by Mike from a look test.
FONT_SOURCES: dict[str, str] = {
    "body": "AtkinsonHyperlegible-Regular.ttf",
    "digits": "AtkinsonHyperlegible-Bold.ttf",
}
FONT_CHARSETS: dict[str, str] = {
    "body": "".join(chr(c) for c in range(32, 127)) + "\u00b0\u00b1\u00b5",  # printable ASCII + degree, plus-minus, micro
    "digits": "0123456789.-+:% ",
}
FONT_SIZES: dict[str, list[int]] = {
    "body": [12, 16, 20, 24],
    "digits": [16, 24, 32, 48, 64],
}


def font_ids() -> list[str]:
    """Every font id in the set, e.g. "font_body16"."""
    return [f"font_{cs}{size}" for cs in sorted(FONT_SIZES) for size in FONT_SIZES[cs]]


DEPENDENCIES += [{"name": fid, "files": [(f"fonts/{fid}.py", f"{fid}.py")], "requires": []} for fid in font_ids()]

# What runtimes before 7.0.0 pushed into the board's root (the old VENDOR_FILES). The root comes
# before /lib on sys.path, so a stale root copy would silently win over the library Deploy installs.
# A runtime install deletes these (and their .mpy twins). A fixed historical list: new libraries
# never go to the root.
LEGACY_ROOT_FILES: list[str] = [
    "threadsafe_event.py", "mqtt_as.py", "events.py", "delay_ms.py", "st7789py.py", "ssd1306.py", "bme280_float.py",
]
