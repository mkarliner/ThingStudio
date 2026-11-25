# Pi + Pico appliance: Node-RED on the Pi, Thingstudio on the Pico — scoping

Status: musing, 2026-11-24, from a chat with Mike. Nothing decided or built. Related:
`visitor-camera-annunciator-scoping.md` (a candidate first use), `a-la-carte-images-scoping.md`,
`home-assistant-integration-scoping.md`, the marketing plan in ThingStudioMarketing (Node-RED community framing).

## The idea

For heavier jobs, add a Raspberry Pi. Where the chat landed (Mike: "flow programming all the way down"):

- **Node-RED on the Pi** for the heavy, Linux-side work.
- **Thingstudio on a Pico** for the hard real-time, pin-level work.
- **The Thingstudio App hosted on the Pi**, so the box is self-contained: browse to it from any laptop on the LAN.

```
laptop browser --LAN--> Pi Zero 2 W
                         ├─ Node-RED        (Pi GPIO, dashboards, HA, TTS, server plumbing)
                         ├─ Mosquitto
                         └─ Thingstudio App --UART--> Pico (Thingstudio flow: PIO, timing, pins)
```

## Why this split

- **Scope cut.** No CPython runtime, no `machine` shim, no "Linux board" tier for Thingstudio to build. Node-RED
  already has Pi GPIO nodes, dashboards, HA, databases and thousands of contributed nodes.
- **Positioning.** "Node-RED on the Pi, Thingstudio on the Pico" complements Node-RED instead of competing; matches
  the marketing plan's generous-to-Node-RED framing.
- **Each layer does what it's good at.** Linux can't do nanosecond timing; the Pico's PIO does NeoPixels, encoders
  and precise pulses perfectly.

## Glue between the layers

1. **MQTT (works today).** Mosquitto on the Pi, a Pico W on WiFi. Both sides already speak it.
2. **Over the UART (nicer, later).** No WiFi needed. Snag: the Thingstudio backend owns the serial port for deploy
   and console. Clean answer: a **`node-red-contrib-thingstudio`** package whose nodes send and receive flow
   messages *through* the Thingstudio backend. Also a route into the Node-RED community. Exposing flow messages to
   an outside client is likely an interface change under `AGENTS.md`: needs a spec and Mike's permission.

## Hardware

- **Pi Zero 2 W** (quad A53, 512 MB). Not the original Zero W: single-core ARMv6, slow.
- **Pico on the Pi**: coprocessor HATs exist, e.g. 0xC0FFEE's RP2040 HAT / pHAT (Tindie), which give the Pi UART
  and SWD to the RP2040. Raspberry Pi's own Build HAT uses the same pattern (RP2040 coprocessor, LEGO-specific).
  Beware boards going the other way (StackyPi, SB Components RP2040 HAT Expansion: an RP2040 replacing the Pi to
  drive HATs). Mike has a Pi Arduino HAT already.
- **DIY**: a bare Pico on the Pi's UART (GPIO 14/15) plus SWD for reflashing from the Pi with OpenOCD: 4-6 wires.
  Over SWD the Pi could install MicroPython on the Pico itself: no BOOTSEL press.

## Checks before building

- **Memory on the Zero 2 W**: Node-RED + Thingstudio backend + Mosquitto in 512 MB. Probably fine; measure.
- **An arm64 Linux build of the App.** The install routes cover Linux; unclear whether arm64 is built today.
- **Pi GPIO belongs to Node-RED**, the Pico's pins to Thingstudio.

## Path of least effort

1. Zero 2 W running Node-RED, Mosquitto, the Thingstudio App (check arm64); a Pico W on MQTT. All existing.
2. Pico on the Pi's UART, deployed by the App on the Pi.
3. `node-red-contrib-thingstudio` over the backend (spec first).
4. Optional: the visitor project as the first real use (Node-RED for the face server plumbing and Piper TTS,
   the Pico for the annunciator's lights and buttons).

## Explored on the way (for the record)

**Bare metal on a Pi Zero W: rejected.** No maintained MicroPython bare-metal port; the Pi's WiFi chip is hard to
drive without Linux. Harder to support than an ESP32-S3, not much better at anything.

**A Thingstudio runtime on Linux: superseded by the Node-RED split**, but noted in case it returns.
- WiFi transport already deploys over TCP; the runtime already runs on the unix port; `machine` would need a
  shim over libgpiod, `/dev/i2c-*`, spidev, `/dev/serial0`.
- CPython instead of the unix port would bring numpy, OpenCV, Piper, TFLite, at the cost of fallbacks for viper and
  `.mpy`.

**Hardware on Linux** (applies to whatever runs on the Pi):
- GPIO via libgpiod; edge events have millisecond latency. Two hardware PWM channels (`pwm-2chan`); software PWM
  jitters. **No ADC**: an external chip such as an ADS1115.
- I2C/SPI/UART map cleanly; bus speed and pins are set at boot in `config.txt`.
- Bit-banging is the weak spot: NeoPixels via SPI/DMA (`rpi_ws281x`), 1-Wire via the kernel `w1-gpio` overlay,
  DHT flaky.
- **Audio**: no headphone jack on the Zero. I2S amp/DAC (MAX98357A) into ALSA; I2S MEMS mic (INMP441) for input.
  No USB sound card if the port is used as a gadget.
- Pattern: a board definition becomes `config.txt` overlays; deploy rewrites them and reboots only when they change.

**USB gadget mode** (`dwc2` overlay, configfs): the Zero's data port can be several devices at once: serial (CDC
ACM, so the editor's serial transport would work unchanged), HID keyboard/mouse/media keys, USB networking
(ECM/RNDIS), mass storage, MIDI, audio. Nodes would declare the functions; deploy writes configfs and re-enumerates;
serial always kept in the set. Not Pi-only: MicroPython's `machine.USBDevice` with micropython-lib's
`usb-device-hid` and MIDI packages does this on the RP2040/RP2350 (check the ESP32-S3). Safety default for HID:
a rate limit, and nothing typed until the flow has run a moment.

**OS image** for boot speed and robustness:
- Prototype on Alpine diskless (runs from RAM, power-cut safe) or Pi OS Lite with the read-only overlay.
- Then Buildroot (simpler and faster to build than Yocto, packages for CPython/numpy/OpenCV). Yocto
  (`meta-raspberrypi`) kept in reserve: capable but steep, hours-long builds, layer upkeep.
- A minimal image boots in a few seconds; Pi OS Lite more like 20-30 (estimates). Piper's onnxruntime is the
  awkward package for Buildroot/Yocto.

**Real-time kernel**: PREEMPT_RT is in mainline since Linux 6.12, arm64 included. Buildroot: the Raspberry Pi kernel
tree plus a `CONFIG_PREEMPT_RT=y` fragment. Bounded latency of tens of µs (about 100 µs worst case): good for servos,
interrupts, 1 kHz loops, audio. Not nanoseconds: NeoPixels still need SPI/DMA. Needs SCHED_FIFO, locked memory,
ideally an isolated core; Python GC pauses are the weak link; measure with `cyclictest`. Conclusion: the Pico does
hard real-time better, which led to the split above.

## Open questions

1. MQTT only at first, or go straight for the UART link?
2. Coprocessor: a bought RP2040 HAT, Mike's existing HAT, or a DIY Pico wiring?
3. Does `node-red-contrib-thingstudio` want a spec in `interfaces/`, and is exposing flow messages acceptable?
4. Ship it as a ready image (Pi OS + Node-RED + Mosquitto + App) via "Set up a board" or Raspberry Pi Imager?
5. First use: the visitor project?
