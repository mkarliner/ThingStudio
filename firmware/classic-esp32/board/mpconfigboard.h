// SPDX-License-Identifier: Apache-2.0
// firmware/classic-esp32/board/mpconfigboard.h
//
// The ESP32 port expects a board header; everything here is the stock generic-ESP32 naming
// (boards/ESP32_GENERIC/mpconfigboard.h), so `sys.implementation` and error messages identify the
// chip, not a Thingstudio-specific module.

#ifndef MICROPY_HW_BOARD_NAME
#define MICROPY_HW_BOARD_NAME "Thingstudio classic ESP32 (generic)"
#endif

#ifndef MICROPY_HW_MCU_NAME
#define MICROPY_HW_MCU_NAME "ESP32"
#endif
