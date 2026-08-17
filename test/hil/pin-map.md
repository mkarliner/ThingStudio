# Witness+DUT rig: pin map

Operationalizes `docs/working-notes/validation/mvp-validation-plan.md`'s
"Hardware-in-the-loop rig: witness + DUT" section — that section
specifies the six *roles* that need wiring (DUT GPIO out ↔ witness edge
capture, etc.) but not concrete pin numbers. This doc assigns real GPIO
numbers for two LuatOS CORE-ESP32-C3 boards specifically (same board
class as POC-A/D, per that section's "for continuity" note) and explains
why each was picked or avoided. Config, not code — the witness firmware
that actually reads these pins is part of
`docs/working-notes/fault-isolation-briefing.md`'s task, not this doc.

**Verify against your actual boards before wiring.** The pin-avoidance
reasoning below is corroborated two ways — the ESP32-C3 chip's own
strapping-pin behavior (public, chip-level, not board-specific) and this
specific board's documented LED/UART pins (matches what POC-A/D already
exercised successfully: GPIO12/13 LEDs, GPIO9 BOOT, GPIO20/21 UART0) —
but if your two boards are a different revision or a different
LuatOS/third-party ESP32-C3 board entirely, cross-check its silkscreen
against its own pinout doc rather than assuming this table still applies
verbatim.

## Pin table

| Role (per validation plan) | DUT pin | Witness pin | Notes |
|---|---|---|---|
| `gpio_out` node validation: DUT drives, witness edge-captures | DUT **GPIO12** (out) | Witness **GPIO3** (in, IRQ + `ticks_us()`) | DUT side reuses POC-A/D's exact LED pin (GPIO12) on purpose — the onboard LED gives a free visual sanity check alongside the witness's timestamped capture |
| `interrupt` node validation: witness drives a known signal (clean edges and, via `DRIVE_BOUNCE`, simulated bounce), DUT reads | DUT **GPIO4** (in) | Witness **GPIO5** (out) | Role/wiring unchanged since this table was first laid out — only the DUT-side node changed (2026-08-17: `gpio_in`, poll-based, removed; `interrupt`, edge-triggered, took over this same pair — mvp-feature-priorities.md item 5) |
| PWM duty-cycle/frequency measurement | DUT **GPIO6** (PWM out) | Witness **GPIO7** (in, edge-capture across N cycles) | |
| I2C sensor-node protocol testing (pending the slave-mode spike) | DUT **GPIO6=SCL, GPIO7=SDA** — ⚠ **conflicts with the PWM row above, see note** | Witness **GPIO18=SDA, GPIO19=SCL** (slave mode) | See "I2C pin conflict" below — do not wire both rows as written until resolved |
| Fault-injection soak test liveness | DUT **GPIO10** (heartbeat, continuous toggle) | Witness **GPIO0** (in, `HEARTBEAT_WATCH`) | Independent of the DUT's own printed heartbeat, per the validation plan's own reasoning (POC-D's worst bug took the printed heartbeat down with the rest of the event loop) |
| Common reference | DUT **GND** | Witness **GND** | Required even though both boards also share USB ground through the host — explicit jumper per the validation plan's own note ("easy to forget, breaks everything subtly if missed") |

### I2C pin conflict — needs a decision before wiring both

Laying this table out surfaced a real clash the validation plan's
role-level table didn't have to deal with: I initially assigned DUT
GPIO6/GPIO7 to *both* the PWM row and the I2C row. That's wrong — fix
before wiring, don't route both to the same two pins. Two clean options:

- **Move I2C to different DUT pins** (e.g. DUT GPIO1=SDA, GPIO11=SCL —
  see the free-pin list below) and keep GPIO6/7 as PWM-only. Simplest
  fix, no functional trade-off.
- **Don't wire I2C at all yet.** The validation plan already treats the
  I2C slave-mode spike as gated/optional ("if this doesn't pan out
  cleanly, it's not a blocker, just a scope limit") — since the digital
  GPIO/PWM/timer rows don't depend on it, it's reasonable to wire only
  the first three rows now and add the I2C pair once the spike is
  actually scheduled.

Recommendation: wire GPIO/PWM/heartbeat now (independent of the spike),
decide the I2C pins when that spike actually starts rather than
reserving pins for it today. Using DUT GPIO1/GPIO11 for I2C SDA/SCL and
Witness GPIO1/GPIO11 to match (I2C needs a matched pair regardless of
which physical numbers, so keeping the two boards' numbering symmetric
here is just for wiring clarity) is the concrete fallback if you want to
wire it now anyway.

## Pins deliberately avoided, and why

Same rationale applies to both boards (identical board class):

| Pin(s) | Why avoided |
|---|---|
| GPIO2, GPIO8, GPIO9 | ESP32-C3 strapping pins (chip-level, not board-specific). GPIO9 specifically is this board's BOOT button — confirmed in both POC-A/D (`harness.py`'s comments) and the board vendor's own docs: "the BOOT (IO09) pin cannot be pulled down before power-on, or the ESP32 will enter download mode." Wiring anything here risks the rig itself accidentally forcing a board into bootloader mode on reset. |
| GPIO14–GPIO17 | Flash SPI bus pins (SPICLK/SPICS0/SPID/SPIQ) on this board's DIO-mode flash wiring. GPIO12/GPIO13 (SPIHD/SPIWP) are confirmed *not* connected to flash in this board's DIO mode — which is why they're safe to reuse for the LED/rig role above — but 14–17 are still live flash-bus pins and must not be repurposed. |
| GPIO20, GPIO21 | UART0 (U0RXD/U0TXD) — already committed to each board's own USB-to-UART bridge, i.e. the independent host connection both the DUT and witness need per the rig's whole design. Reusing these for rig wiring would fight the same board's own serial link to your machine. |

**Free pins, not used above, available if the rig grows more roles
later:** GPIO1, GPIO11, GPIO18, GPIO19 (GPIO18/19 also unused here since
this board uses a USB-to-UART bridge chip rather than the ESP32-C3's
native USB peripheral — confirm this holds for your specific board
before assuming GPIO18/19 are free, since a native-USB variant would
need them for its host link instead).

## Wiring diagram

```
                     ┌─────────────────────────┐        ┌─────────────────────────┐
                     │      DUT board           │        │    Witness board        │
                     │  (LuatOS CORE-ESP32-C3)  │        │ (LuatOS CORE-ESP32-C3)  │
                     │                           │        │                          │
   USB to host  ─────┤ UART0 (GPIO20/21)         │        │ UART0 (GPIO20/21) ├───── USB to host
   (runtime/         │  [reserved, not rewired]  │        │ [reserved, not rewired]  │  (witness commands/
   listener traffic) │                           │        │                          │   readings)
                     │                           │        │                          │
                     │  GPIO12 (out, +LED) ●─────┼────────┼─────● GPIO3 (in, IRQ)     │  gpio_out validation
                     │                           │        │                          │
                     │  GPIO4  (in)        ●─────┼────────┼─────● GPIO5 (out)         │  interrupt validation
                     │                           │        │                          │
                     │  GPIO6  (PWM out)   ●─────┼────────┼─────● GPIO7 (in, capture) │  PWM measurement
                     │                           │        │                          │
                     │  GPIO10 (heartbeat) ●─────┼────────┼─────● GPIO0 (watch)       │  soak-test liveness
                     │                           │        │                          │
                     │  GND                ●─────┼────────┼─────● GND                │  common reference
                     │                           │        │                          │
                     │  (I2C: see conflict note   │        │  (I2C: see conflict      │
                     │   above before wiring)     │        │   note above)            │
                     └─────────────────────────┘        └─────────────────────────┘
```

## Open items this doc doesn't resolve

- The I2C pin conflict above — pick one of the two options before that
  pair gets wired.
- The witness firmware itself (`WATCH_EDGES`, `MEASURE_PWM`,
  `DRIVE_GPIO`, `HEARTBEAT_WATCH`, and — pending the spike —
  `I2C_SLAVE_EMULATE`) doesn't exist yet; this doc is pins only. See
  `docs/working-notes/fault-isolation-briefing.md`.
- External I2C pull-ups (~4.7kΩ) — the validation plan already flags
  these as "may be needed... worth checking bus signal integrity once
  the spike is running, not assuming it's fine," unchanged by this doc.
