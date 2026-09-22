# Road to MVP

2026-09-22

## What "true MVP" means

The MVP is done when someone who is not Mike can go from a fresh computer and a supported board to a working flow on hardware, using only the product and its docs.

MVP users are makers and MicroPython users, and probably Node-RED users. Assume they know their board and basic electronics, but not this project.

Test for it with a real newcomer:

- **No terminal.** Install, board setup and deploy all happen through the product.
- **No hand-holding.** Every question they hit is answered in the docs, or it becomes an MVP item.
- **No silent failure.** When something goes wrong, they are told what happened and what to do next.
- **A first success in minutes.** Time to first blink of 15 minutes or better, from download to a blinking LED.

## 1. Easy installation

Installation should be one obvious path with no command line, from download to a board that is ready to deploy to.

1. **One download installs everything.** A downloadable app containing the back end and the editor. The back end runs headless on the user's machine and the editor opens in the browser, as with Node-RED, so no Electron or similar wrapper. It ships for macOS, Linux and Windows on day one, by these routes:
   - **macOS and Linux:** a `curl … | sh` one-liner, and a Homebrew tap
   - **Windows:** a PowerShell one-liner, and `winget` or `scoop`
   - **All three:** a zip file per OS, unpack and run
   - **Every route bundles the back end's language runtime**, so there are no prerequisites to install first
2. **Runtime install from the editor.** Users bring a board with MicroPython already on it. The editor detects a board with no runtime and offers to install it. Today this is a manual `deploy_runtime.py` step, and missing it shows only a confusing `SyntaxError` on connect.
3. **Sensible defaults per supported chip.** ESP32, ESP32-C3, ESP32-S3, RP2040 and RP2350 each get working defaults for pins, SPI speed and the like, so users don't discover limits by crashing.
4. **Clear connect failures, not guaranteed connects.** Users will plug in boards with unknown reset behaviour, so reliable connection everywhere isn't achievable. When a connect fails, say what happened and suggest workarounds, such as pressing reset or changing the DTR/RTS setting.
5. **Acceptance test.** A fresh machine and a fresh board reach a blinking LED in 15 minutes or less, by a first-time test user following only the docs. Mike identifies the initial test users.

## 2. Complete, accurate, human-centred documentation

The docs should be written around what a person is trying to do, and should never disagree with the product.

**Human-centred**

- **Getting started tutorial.** Install, blink an LED, read a sensor, draw on a display. Each step shows what success looks like.
- **Task guides before reference.** "Show a temperature on an SSD1306 display" before the `display_spi` property list.
- **User docs kept apart from project docs.** `learnings/` and `decisions/` are for contributors; users should never need them.

**Complete**

- **Installing MicroPython.** For the MVP this is documentation only: list the ways to get MicroPython onto each supported chip (official firmware and `esptool`, Thonny, the RP2 drag-and-drop UF2), with links to the official instructions.
- **Every node has a page** covering inputs, outputs, message shape, properties and a worked example.
- **Every supported board has a page** covering each chip family's defaults and known caveats, plus a page per supported display module.
- **Troubleshooting from real failures.** Runtime not installed, SPI too fast, `MemoryError` from allocating per message. Each has cost real debugging time already.

**Accurate**

- **Docs change in the same change as code**, as the project already does for node pages.
- **Editor and docs agree.** `colorOrder`, `invertColors` and `dataLatchOrder` exist in flow files but not in the property panel; the docs must not describe one while the UI shows the other.
- **Examples are tested.** Every example flow in the docs deploys and runs on real hardware before release.

## Other candidates

| Item | Why it matters | Placement |
| --- | --- | --- |
| Clear device errors in the editor | Crashes like the SPI boot loop only showed in a serial log | MVP |
| Property panel shows every node property | Some settings can only be changed by editing flow files | MVP |
| Board-aware compile (`-march`) | Hardcoded to Xtensa; viper code such as `display_spi` gs4 will break on RP2040/RP2350 | MVP |
| Displays: framebuffer only | ST7789-family SPI (incl. M5Stack) and SSD1306 via `display_spi`/`display_i2c`, full-frame push | MVP |
| WiFi transport between editor and board | Deploy and monitor without a USB cable, alongside serial; sidesteps unknown USB reset behaviour once a board is set up | MVP |
| Display partial-blit path | Needed for a responsive GUI, not for a first flow | Post-MVP |
| GUI view and widgets | Large feature; not needed to prove the core idea | Post-MVP |

## Open questions

None at the moment.
