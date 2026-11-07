// SPDX-License-Identifier: Apache-2.0
// firmware/targets/esp32-s3/board/mpconfigboard.h
//
// Stock generic-S3 settings (boards/ESP32_GENERIC_S3/mpconfigboard.h). The MCU name stays the stock one, so
// HELLO's chipType still matches the esp32-s3 processor definition.

#ifndef MICROPY_HW_BOARD_NAME
#define MICROPY_HW_BOARD_NAME "Thingstudio ESP32-S3 (generic)"
#endif
#define MICROPY_HW_MCU_NAME "ESP32-S3"

// Modules with a USB-serial chip on UART0 need the UART REPL; native-USB modules (the Freenove ESP32-S3-WROOM
// among them) also speak over the USB serial/JTAG CDC, as the stock generic module does.
#define MICROPY_HW_ENABLE_UART_REPL (1)
