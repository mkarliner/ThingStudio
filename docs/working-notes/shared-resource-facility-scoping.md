# Shared-resource / bus facility — scoping

Status: **built 2026-10-16 — Option 2, core-only, `bme280` converted** (see §9). The next deliverable named in
`builtins-as-packages-phase4-briefing.md`; part of the node-format-parity work (`decisions/node-authoring.md`,
`builtins-as-packages-scoping.md` §16). Read those first.

## 1. The gap, precisely

Flipping `i2c`/`delay`/`gpio_out`/`debug` proved the package path for nodes that touch no shared hardware. `bme280`
stopped the same exercise: its codegen calls `resolveI2cBus` (`i2c-shared.ts`), which does three things a package
descriptor cannot express today.

1. **Compile-time validation.** A missing bus config, or one with no SCL/SDA pin, is a `CompileError`; the pins are
   `checkPin`'d (`pin-check.ts`), refused if the same pin is both SCL and SDA, and `checkI2c`'d (the bus exists on
   the target, the pins can serve it).
2. **Conflict detection.** Two in-use I2C configs claiming the same bus number is a `CompileError`
   (`i2c-shared.ts`'s cross-node scan); two devices on one pin with different settings is a `CompileError` via
   `claimResource` (`hardware-shared.ts`).
3. **Setup dedup.** One shared `_i2c_bus_N = runtime.shared(...)` statement, keyed so a display and a sensor emit
   one `machine.I2C`.

A package today can already: claim a **raw** pin through a `pin` field's `pinUse`/`pinPull` (context parity, phase
2a); inline a config's properties through a `configRef` field (the bus's `{bus, scl, sda, freq}` dict); and share an
object **on the device** via `runtime.shared(...)`. It cannot validate a config as a bus, claim a bus or a
non-pin device resource, detect the two-configs-one-bus conflict, or (see §4) dedup a setup statement.

Net: the whole hardware family is blocked — `bme280`, `adc`, `encoder`, `neopixel`, `eswitch`, `ebutton`,
`interrupt`, `touch_i2c`, `display_i2c`, `display_spi`.

## 2. Inventory — what each hardware node actually needs

| Node | Validation | Claims | Object build |
|---|---|---|---|
| `i2c`, `bme280`, `display_i2c`, `touch_i2c` | `resolveI2cBus`: bus int ≥ 0; SCL/SDA set, `checkPin`, `checkI2c`, SCL ≠ SDA; two-config conflict | `GPIO scl "I2C bus N SCL"`, `GPIO sda "I2C bus N SDA"` | `runtime.shared('i2c', N, ...)`, built in Python |
| `display_spi` | `checkSpi`: bus exists, pins valid for it, baudrate within chip/pin limits; `checkPin` on every line | `SPI bus N "SCK .., MOSI .. at .. Hz"`, `GPIO sck/mosi "SPI bus N .."`, `dc "display DC"`, `cs "SPI CS"`, `reset`/`backlight "output"` | `runtime.shared('spi', N, ...)` + per-pin `runtime.shared('pin', ...)` |
| `adc` | `checkPin` input; ADC2-vs-WiFi guard | `GPIO p "ADC input"`, `GPIO p aadc "relative .., sense .., poll .."` | `runtime.shared('adc', p, ...)` |
| `encoder` | `checkPin` in+pull ×2, x ≠ y | two input pins, `GPIO x,y encoder "<args>"` | `runtime.shared('pin', ..)` ×2 |
| `neopixel` | `checkPin` output | `GPIO p "output"`, `GPIO p neopixel "count .., order .."` | `runtime.shared('pin', ..)` |
| `eswitch`, `ebutton`, `interrupt` | `checkPin` input (+pull) | `GPIO p "input, .."`, `GPIO p <device> "<settings>"` | `runtime.shared('pin', ..)` |
| `pwm_out` | `checkPin` output | `GPIO p "PWM at N Hz"` | `runtime.shared('pwm', p, ...)` |

Three reusable shapes fall out: **a bus from a config** (I2C), **a bus from properties** (SPI), and **a pin (or pin
pair) with a role/use text plus an optional derived device claim**.

## 3. Design options

**Option 1 — general `resources[]` + per-kind resolvers, objects passed into the package closure.** The descriptor
declares each resource and a Python expression to build it; generic codegen validates, claims, dedups and passes the
built object into the package's per-instance closure. Most complete; needs a Python-expression template (a mini-DSL)
or a `packageCodegen` wrapper change to thread object args; most interface surface.

**Option 2 — `resources[]` for validate + claim only; Python builds the object itself.** The descriptor names the
resource kind and where its key/settings come from; a shared generic resolver validates and claims (`checkPin` /
`checkI2c` / `checkSpi` + `claimResource`). The package's own Python calls `runtime.shared(...)`, exactly as
`core-packages/i2c.ts` already does. Dedup is the on-device singleton (`runtime.shared`), the same behaviour already
accepted for `gpio_out` (`builtins-as-packages-scoping.md` §14). No wrapper change; Python logic stays in Python.

**Option 3 — narrower: a `configRef` field gains a `resource: "i2c-bus"` hint.** Covers only bus configs (the
actually-blocked half). Raw-pin device claims stay on `pin` + `pinUse`, and the extra device-level claim (neopixel
count, encoder settings, ADC mode) is dropped or needs a second `claim` string on the node anyway. Smallest change,
but leaves the family half-covered.

## 4. Recommendation — Option 2, core-only first

**Mechanism.** A new optional canonical field `NodeDescriptor.resources?: ResourceSpec[]`. A small closed vocabulary
of kinds, each a data record naming the property/config it derives from:

- `{ kind: "i2c", config: "<configRef field name>" }` — resolves the config, validates (bus/pins/`checkI2c`,
  SCL ≠ SDA), claims both pins with the bus-role use texts, and runs the two-configs-one-bus conflict scan.
- `{ kind: "spi", bus, sck, mosi, baudrate: "<prop names>" }` — `checkPin` ×2, `checkSpi`, claims the bus and pins.
- `{ kind: "pin", property, direction, pull?, claimUse, claim? }` — `checkPin` with the direction/pull, claims the
  pin with `claimUse` (e.g. `"ADC input"`, `"PWM at 32 Hz"`), plus an optional derived `claim`
  (`{ resource: "{pin} neopixel", use: "count {count}, order {order}" }`, small `{property}` templates) for the
  device-level conflict.

The resolver is generic TS (`resource-check.ts`), shared by every core package — not per-node codegen. The package's
`.node.py` builds its object with `runtime.shared(...)` itself, reading the same config dict/property values it
already receives.

**Why Option 2.** It preserves every no-loss check (validation, claims, conflict detection) — the fault-handling-
over-happy-path priority — while staying the cheapest correct shape: no Python-expression DSL in data, no
`packageCodegen` wrapper change. The only dropped behaviour is compile-time setup-statement dedup, which is a code-
size optimisation with byte-identical on-device behaviour (the `runtime.shared` singleton), already documented and
accepted for `gpio_out` (§14). If the generated-code duplication ever matters, adding compile-time dedup later is
additive, not a breaking change.

**Why core-only first.** `resources` goes on the canonical `NodeDescriptor` and is read by the generic package
codegen, but is **not** added to `custom-node.schema.json` or `validateCustomNodeDescriptor` in this change. Custom
packages keep the phase-2 status quo (raw `pin` fields claim; buses use `runtime.shared` only). Rationale: the
resource DSL is a new, user-facing vocabulary, and users have written `.node.json` packages against the current
schema — prove the shape on core for a release, then expose it as a strict subset of the canonical vocabulary (the
one-vocabulary rule), a separate, deliberate call.

## 5. Interface changes required (need Mike's OK)

1. `editor/src/compiler/node-descriptor.ts`: add `NodeDescriptor.resources?` and the `ResourceSpec` union.
2. `interfaces/node-descriptor/SPEC.md`: document the field in §2 (canonical), noting core-only/not-in-schema.
3. **Not** changing `custom-node.schema.json` or the custom validator in this change.
4. **No** runtime API change (`runtime.shared` is unchanged) and **no** wire-protocol change.

Blast radius: no `device-runtime/src` change → no `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` bump; the field is
optional and absent from every existing descriptor, so saved flows and deployed boards are unaffected; custom
packages are unaffected (schema untouched). Only the editor compiler, the `SPEC.md`, and core packages change.

## 6. Test plan

- New `editor/test/resource-check.test.ts`: the resolver's errors — missing bus config, missing SCL/SDA, bad pin,
  SCL = SDA, bus not on target, two in-use configs on one bus, SPI bus/pin/baudrate, a conflicting device claim.
- `editor/test/core-packages.test.ts` extended: build `bme280`'s core definition, compile an
  `inject -> bme280 -> debug` flow, assert the shared `runtime.shared('i2c'` call, the driver use, the status
  report, and that the same compile-time errors the built-in raised still fire. No-loss is behavioural, not
  byte-identical (a package emits a per-instance setup; §14).
- Node tests retargeted per the settled recipe (`builtins-as-packages-phase4-briefing.md` §"per-node recipe").

## 7. Open questions for Mike

1. **Approach** — Option 2 (validate + claim; object built in Python from `runtime.shared`) as recommended, or
   Option 1 (generic codegen also emits/dedups the setup and passes the object in)?
2. **Scope** — core-only first (recommended), or expose `resources` in the custom schema in the same change?
3. **Claim templates** — is the small `{property}` string template for a derived device claim acceptable data, or
   would you rather each device conflict get its own named field?
4. **First node** — `bme280` (the node that surfaced the gap), then widen to the rest of the family?

## 8. Follow-on (unblocked, same session)

Once the facility is decided and built, the pure-software nodes that need no facility flip next with the settled
recipe: `filter`, `journal`, `wifi_gate`, `http_response`.

## 9. Built 2026-10-16 (Mike approved Option 2, core-only, `bme280` first)

- **`NodeDescriptor.resources?: ResourceSpec[]`** (`compiler/node-descriptor.ts`) — a closed union: `i2c` (from a
  `configRef` field name), `spi` (`bus`/`sck`/`mosi`/`baudrate` property names), `pin` (`property`, `direction`,
  `pull`, `use`, optional derived `claim` with `{pin}`/`{property}` templates).
- **`node-library/resource-check.ts`** — `checkResources(ctx, node, descriptor)`, called by the generic
  `packageCodegen` before the properties literal. `i2c` reuses `resolveI2cBus` (validation, both pins claimed,
  two-configs-one-bus refused); `spi` reuses `checkPin`/`checkSpi`/`sharedSpi`; `pin` reuses `checkPin` +
  `claimResource`.
- **`bme280` converted**: `core-packages/bme280.ts` (descriptor + a ported `.node.py` that fetches the shared bus
  through `runtime.shared('i2c', ...)`), `node-library/bme280.ts` deleted, `registry.ts`/`nodes.ts` flipped,
  `node-bme280.test.ts` retargeted (the fake bus is pre-seeded as the on-device singleton). New
  `editor/test/resource-check.test.ts` covers the `spi`/`pin` kinds and the direct errors. `tsc`/`vitest` clean.
- **Accepted difference** (per §4): compile-time setup-statement dedup is gone (the on-device `runtime.shared`
  singleton shares the object); the shared-bus test now asserts the shared key/signature, not one `machine.I2C(`.
- **Not in `custom-node.schema.json`** — core-only, as agreed. Exposing the vocabulary to custom packages is a
  separate call.
- **Still built-in, not converted:** the rest of the hardware family. Their `spi`/`pin` resources are expressible;
  converting them is per-node work, and two are blocked on facility gaps, not effort:
  - **Converted 2026-10-16 after `bme280`:** `pwm_out` and `neopixel` — both exercise the `pin` resource (direction
    + a role/use text; `neopixel` also a derived `{pin} neopixel` claim). The `pin` kind is no longer unit-test-only.
  - **Blocked:** `adc` needs a node-specific compile-time context query (its ESP32 ADC2-vs-WiFi guard reads
    `ctx.findNodesOfType`), which the package format can't express yet. `encoder` needs a claim on a *pin pair*
    (`GPIO x,y encoder`), expressible only via `{property}` interpolation of both pins — TODO/adjust the shape
    before converting.
  - **Complex, not yet attempted:** `display_i2c`/`touch_i2c` (i2c resource + touch-panel config) and
    `display_spi` (spi resource + many pins + viper codegen).
  - Also unconverted: `interrupt`, `eswitch`, `ebutton` (pin input + a derived device claim; event sources).
- **Pure-software nodes flipped the same session** (the settled recipe, no facility needed): `filter`,
  `journal`, `http_response` are core packages now (`core-packages/{filter,journal,http-response}.ts`; the TS
  files deleted). The accepted difference repeats: a package's per-instance closure holds state/helpers rather
  than the built-in's module-level shared statements, so two `filter`s/two `journal`s now each carry their own
  (e.g. `_Journal` is defined per instance, and the shared `_filter_num` is gone). Node tests and
  `gui-trend.test.ts` retargeted accordingly.
- **`wifi_gate` deferred, deliberately.** It is not pure software: its codegen needs `resolveFlowWifiCredentials`
  and `flowHasMqttNodes` (the `deferToMqtt` computation that fixed the WiFi-flapping bug), plus the
  `wifiSetupStatement` "wifi-sta" setup dedup. A package can't query the flow's node types yet, so a naive port
  would reintroduce the flapping bug — a real regression. It stays built-in until context parity grows a
  flow-query (or the wifi setup is exposed as a facility). This corrects the briefing's own "wifi_gate" listing as
  a no-facility port.
