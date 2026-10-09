#!/bin/sh
# Copies the modules to freeze into mods/ under their board names. mqtt_as gets one spike-only patch: the unix
# port has no machine.unique_id, so it's stubbed (same change in the frozen and the .mpy copies).
set -e
here=$(cd "$(dirname "$0")" && pwd)
v="$here/../../device-runtime/src/vendor"
rm -rf "$here/mods" "$here/fs"; mkdir -p "$here/mods" "$here/fs"
cp "$v/mqtt_as/__init__.py" "$here/mods/mqtt_as.py"
sed -i.bak 's/^from machine import unique_id$/def unique_id(): return b"\\x01\\x02\\x03\\x04"  # SPIKE/' "$here/mods/mqtt_as.py" && rm "$here/mods/mqtt_as.py.bak"
cp "$v"/fonts/font_*.py "$here/mods/"
cp "$v/thingstudio_gui/gui.py" "$here/mods/thingstudio_gui.py"
for w in label readout bar led pagedots; do cp "$v/thingstudio_gui/$w.py" "$here/mods/tsgui_$w.py"; done
for f in "$here"/mods/*.py; do "${MPY_CROSS:-mpy-cross}" -o "$here/fs/$(basename "$f" .py).mpy" "$f"; done
