# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/manifest.py
#
# FROZEN_MANIFEST for the classic-ESP32 image: freeze the whole staged tree, which stage.py lays
# out from runtime_manifest.py -- the runtime core, the listener, every vendored library and font
# set the editor can deploy, under their on-board module names.
#
# Freezing all of them (rather than a per-flow subset) is what makes one generic image work for
# every flow on this chip: a flow that doesn't import a library never touches its flash.
#
# The stage directory comes from the build script (build.sh sets THINGSTUDIO_FROZEN_STAGE); the
# fallback keeps a hand-run `make` working from this directory.

import os

# The port's own frozen modules first: _boot.py, flashbdev.py, inisetup.py. Without these there is
# nothing at boot to mount or format the filesystem, so "/" simply doesn't exist ("could not find
# module '_boot.py'", os.mkdir -> ENODEV) -- a manifest *replaces* the port default, it doesn't add
# to it.
include("$(PORT_DIR)/boards/manifest.py")

_stage = os.environ.get("THINGSTUDIO_FROZEN_STAGE")
if not _stage:
    _stage = os.path.join(manifest_path, "build", "stage")

if not os.path.isdir(_stage):
    raise Exception(
        "frozen stage missing at %s -- run firmware/classic-esp32/build.sh (it stages from "
        "device-runtime/runtime_manifest.py), or set THINGSTUDIO_FROZEN_STAGE" % _stage
    )

freeze(_stage)
