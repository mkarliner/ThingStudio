# Brief: start MVP work

You're picking up ThingStudio MVP work. Read `docs/road-to-mvp.md` first; it is the agreed scope. This brief says where to start.

## The goal in one line

Someone who isn't Mike goes from download to a blinking LED on a supported board in 15 minutes or less, using only the app and its docs, with no terminal.

## Fixed decisions (don't reopen)

- **Users:** makers, MicroPython users, probably Node-RED users.
- **Chips:** ESP32, ESP32-C3, ESP32-S3, RP2040, RP2350. Users bring a board with MicroPython already installed; installing MicroPython is a documentation item only.
- **Delivery:** a downloadable app. The headless back end runs locally and the editor opens in the browser, like Node-RED. No Electron.
- **Install routes:** `curl | sh` and Homebrew for macOS/Linux; PowerShell one-liner and winget/scoop for Windows; a zip per OS. Every route bundles the back end's language runtime.
- **Connect:** no attempt to guarantee connects on every board. Failures give a clear message and suggested workarounds (standing order).
- **Displays:** framebuffer only (ST7789-family incl. M5Stack, SSD1306). Partial blit and GUI are post-MVP.
- **Docs:** change in the same commit as the code they describe.

## MVP work items

1. Runtime install from the editor: detect a board with MicroPython but no runtime, and offer to install it (replaces the manual `deploy_runtime.py` step and the `SyntaxError` on connect).
2. Clear connect and device errors in the editor, with workaround suggestions.
3. Board-aware compile: replace the hardcoded Xtensa `-march` so viper code works on RP2040/RP2350.
4. Sensible defaults per chip family (pins, SPI speed).
5. Property panel shows every node property (`colorOrder`, `invertColors`, `dataLatchOrder` are missing today).
6. WiFi transport between editor and board, alongside serial.
7. Packaging and the install routes above.
8. Docs: getting-started tutorial, task guides, a page per node, per chip family and per display, MicroPython install routes, troubleshooting.

## Suggested first session

Start with items 1 and 2. They sit directly on the path to first blink and touch the connect flow, which WiFi transport will reuse later. Before coding, read the current connect and deploy path and `deploy_runtime.py`, then propose a short plan to Mike.

## Questions to raise with Mike before building WiFi transport

- Plain RP2040 and RP2350 boards have no WiFi (the Pico W / Pico 2 W variants do). Is serial the fallback there?
- Does first-time setup (runtime install, WiFi credentials) always happen over USB serial?
- How does the editor find a board on the network: mDNS, an IP entered by hand, or both?
