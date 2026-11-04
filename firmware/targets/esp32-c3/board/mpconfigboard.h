// SPDX-License-Identifier: Apache-2.0
// firmware/targets/esp32-c3/board/mpconfigboard.h
//
// Stock generic-C3 settings (boards/ESP32_GENERIC_C3/mpconfigboard.h). The MCU name stays the stock one, so
// HELLO's chipType still matches the esp32-c3 processor definition.

#ifndef MICROPY_HW_BOARD_NAME
#define MICROPY_HW_BOARD_NAME "Thingstudio ESP32-C3 (generic)"
#endif
#define MICROPY_HW_MCU_NAME "ESP32-C3"

// Boards with a USB-serial chip on UART0 (the LuatOS ESP32C3-CORE's CH343) need the UART REPL; native-USB boards
// get the USB serial/JTAG REPL as well.
#define MICROPY_HW_ENABLE_UART_REPL (1)
