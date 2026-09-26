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
CORE_FILES: list[str] = ["errors.py", "cbor.py", "framing.py", "messages.py", "protocol.py", "runtime.py", "wifi_provision.py", "board_settings.py", "net_transport.py"]

# Installed as main.py so the board boots straight into it.
LISTENER_FILE: str = "listener.py"

# (path relative to device-runtime/src/vendor/, destination filename on-device). mqtt_as's own
# __init__.py needs to land flat as mqtt_as.py, not nested under an mqtt_as/ package dir --
# MicroPython's import system finds either shape, but a flat file is simpler for a one-file-at-a-
# time push and matches how generated code imports it (`import mqtt_as`, not a package import).
# st7789py.py/ssd1306.py added 2026-09-17 for display_spi/display_i2c -- same unconditional-push
# treatment as everything else here (outstanding-items.md's "VENDOR_FILES doesn't scale past a
# few controllers" tracks the real cost of that, not solved by this list existing).
VENDOR_FILES: list[tuple[str, str]] = [
    ("threadsafe_event/threadsafe_event.py", "threadsafe_event.py"),
    ("mqtt_as/__init__.py", "mqtt_as.py"),
    ("primitives_events/events.py", "events.py"),
    ("primitives_events/delay_ms.py", "delay_ms.py"),
    ("st7789py_mpy/st7789py.py", "st7789py.py"),
    ("ssd1306/ssd1306.py", "ssd1306.py"),
    ("bme280/bme280_float.py", "bme280_float.py"),
]
