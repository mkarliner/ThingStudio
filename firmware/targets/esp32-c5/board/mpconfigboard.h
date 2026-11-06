// SPDX-License-Identifier: Apache-2.0
// firmware/targets/esp32-c5/board/mpconfigboard.h
//
// Stock generic-C5 settings (boards/ESP32_GENERIC_C5/mpconfigboard.h). The MCU name stays the stock one, so
// HELLO's chipType still matches the esp32-c5 processor definition.

#define MICROPY_HW_BOARD_NAME "Thingstudio ESP32-C5 (generic)"
#define MICROPY_HW_MCU_NAME "ESP32-C5"

#define MICROPY_PY_MACHINE_I2S (0)
// Boards with a USB-serial chip on UART0 (the ESP32-C5-340X's CH340E) need the UART REPL.
#define MICROPY_HW_ENABLE_UART_REPL (1)
