#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/stage.py
#
# Lays out exactly the files a custom image freezes, in the same names the board would see them
# under /lib and its root. One source of truth: device-runtime/runtime_manifest.py, the same list a
# runtime install reads. Nothing here is a second copy of that list.
#
# The staged tree is what manifest.py freezes and what gen_deps_index.mjs hashes, so an image can
# never disagree with the runtime it ships.
#
# Usage: python3 stage.py <out_dir>

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "device-runtime", "src")
VENDOR = os.path.join(SRC, "vendor")

sys.path.insert(0, os.path.join(REPO, "device-runtime"))
import runtime_manifest as m  # noqa: E402


def main(argv):
    if len(argv) != 2:
        print("usage: stage.py <out_dir>", file=sys.stderr)
        return 2
    out = argv[1]
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    for name in m.CORE_FILES:
        shutil.copyfile(os.path.join(SRC, name), os.path.join(out, name))
    # The listener is staged under its real module name, not main.py: a frozen module can't be the
    # boot script, so /main.py on the filesystem imports this (see main.py next to this file).
    shutil.copyfile(os.path.join(SRC, m.LISTENER_FILE), os.path.join(out, "listener.py"))

    staged = set(m.CORE_FILES) | {"listener.py"}
    for dep in m.DEPENDENCIES:
        for src_name, dest_name in dep["files"]:
            if dest_name in staged:
                raise SystemExit("stage: %s staged twice (dependency %s)" % (dest_name, dep["name"]))
            shutil.copyfile(os.path.join(VENDOR, src_name), os.path.join(out, dest_name))
            staged.add(dest_name)

    print("staged %d modules in %s" % (len(staged), out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
