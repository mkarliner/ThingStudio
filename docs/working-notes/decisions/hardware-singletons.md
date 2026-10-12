# Hardware resources are keyed singletons

Status: decision. Mike, 2026-09-08 (first asked), restated 2026-10-12 after finding `interrupt` and four other pin
nodes still building their own `machine.Pin`.

## The rule

Every unique hardware resource on the board -- a GPIO pin, an ADC channel, an I2C or SPI bus, a PWM output -- is a
**keyed singleton**, after Peter Hinch's `functor_singleton` pattern:
<https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md>.
The first user of a resource builds the one object for it; every later user gets that same object. Nodes never
construct `machine.Pin`, `machine.ADC`, `machine.I2C`, `machine.SPI` or `machine.PWM` directly.

Two halves, both required for any node that touches hardware:

1. **Compile time: claim it.** Call `claimResource(ctx, resource, use, who)` (`editor/src/node-library/
   hardware-shared.ts`) for each pin and bus. `use` says how the node sets it up ("input, pull-up", "output", "I2C
   bus 0 SCL"). The same use from two nodes is fine: they share. A different use is a `CompileError` naming both
   nodes. This is what stops two nodes quietly fighting over a pin.
2. **On the board: share it.** Get the object through `runtime.shared(kind, key, signature, factory)`
   (`device-runtime/src/runtime.py`), e.g. `runtime.shared('pin', 5, ('in', 'up'), lambda: machine.Pin(5, ...))`.
   Kinds in use: `pin`, `pwm`, `i2c`, `spi`. A function or custom node fetches the same object with
   `runtime.shared('pin', 5)`.

## How ours differs from Hinch's, on purpose

- **Keyed.** Hinch's decorator gives one instance per class; ours gives one per `(kind, key)`, e.g. one per pin.
- **Arguments are checked, not dropped.** Hinch's singleton silently ignores a later caller's arguments (his README's
  `MySingleton()` example). Ours compares the later caller's `signature` with the first and raises `ValueError`
  naming both if they differ, and the compile-time claim catches the same thing before deploy. A pin set up two
  ways is a wiring bug, and it must fail legibly (AGENTS.md: fault handling over happy path).
- **Cleared on redeploy** (`cancel_running()`), so a new flow with new pins builds afresh.
- **Not a functor.** Later calls don't reconfigure the object (Hinch's functor `__call__`). Reconfiguring shared
  hardware from one node behind another's back is the bug this rule exists to prevent.

## Drivers on a pin

A driver built on a shared pin (ESwitch, EButton, an `irq()` handler, a display) is claimed too, as its own resource
(`"GPIO 5 eswitch"`, use = its settings). Two nodes with the same settings share the driver; different settings are a
compile error, replacing the old silent "first node's settings win".

## Custom nodes

The compiler can't see inside a custom node's Python. Custom node authors should get pins with `runtime.shared()`;
the example `dht22` package does. The runtime check then catches a custom node and a built-in node setting the same
pin up differently.

## History

- 2026-09-08: Mike's note ("GPIO, ADC and other hardware config nodes ... should be singleton nodes with no palette
  presence. This will also handle the issue of nodes conflicting in their use of pins") was triaged into
  `outstanding-items.md` as a [P3] "investigate" item, not recorded here as a rule. So `eswitch`/`ebutton` (2026-09-17)
  were built without it, like `interrupt` before them.
- 2026-09-25/26: built for WiFi (singleton config) and the I2C bus (keyed config + `runtime.shared()`,
  `config-nodes-tier1-scope.md`). GPIO left as "the obvious next user" and never scheduled.
- 2026-10-12: rule recorded here and in AGENTS.md; every built-in pin, PWM and SPI user moved onto it. No per-pin
  config objects in the flow file: the compile-time claim gives the same conflict check from the pin number each
  node already stores, without a second copy of it to keep in step.
- 2026-10-12 (later): the `adc`, `encoder` and `neopixel` nodes -- built 2026-10-11 on a side branch, before this
  infrastructure landed -- moved onto it too when that branch merged. `sharedAdc()` added (`runtime.shared('adc',
  <pin>, ...)`) for the ADC channel; both encoder pins and the neopixel data pin via `sharedPin()`; each driver
  claimed as its own resource (`GPIO <pin> aadc`, `GPIO <x>,<y> encoder`, `GPIO <pin> neopixel`).
