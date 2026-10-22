# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/main.py
#
# The board's boot script for a custom image, written to the image's filesystem by install.sh.
#
# A frozen module can't be the boot script -- MicroPython runs /main.py from the filesystem -- so
# this is the one piece of boot code that stays a file: it imports the frozen listener and hands
# over. A stock install copies listener.py to /main.py instead (runtime_manifest.py), and both
# entry points run the same main().
#
# Anything written here is on flash, not in the image: a board with this image and no /main.py
# boots to the REPL, which is also the way back to a prompt when the listener misbehaves.

import listener

listener.main()
