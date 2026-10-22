# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/board/mpconfigboard.cmake
#
# Build.sh copies this directory to <micropython>/ports/esp32/boards/thingstudio_classic_esp32 and
# builds with BOARD=thingstudio_classic_esp32. The filesystem, driver and MicroPython feature set
# stay stock (boards/sdkconfig.base + ble, the same pair ESP32_GENERIC uses); only flash size, the
# partition table and size-optimised code differ.

set(SDKCONFIG_DEFAULTS
    boards/sdkconfig.base
    boards/sdkconfig.ble
    ${CMAKE_CURRENT_LIST_DIR}/sdkconfig.board
)

# The frozen set. build.sh copies manifest.py next to this file, so the path resolves inside the
# port's board directory. Setting it here rather than passing FROZEN_MANIFEST on the make command
# line matters: a command-line variable propagates into the recursive mpy-cross build, which then
# tries to freeze modules into mpy-cross itself and fails ("assert mod_defs").
set(MICROPY_FROZEN_MANIFEST ${CMAKE_CURRENT_LIST_DIR}/manifest.py)
