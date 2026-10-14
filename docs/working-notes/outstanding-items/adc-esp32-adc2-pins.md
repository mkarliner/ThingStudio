# ADC2 pins: move the ESP32 map into the board definitions

Status: resolved, 2026-10-14. The `adc` node (`editor/src/node-library/adc.ts`) refuses an ESP32 ADC2 pin when
the flow uses WiFi (ADC2 is unusable while the radio is on). The pin map was hardcoded in the node
(`ADC2_PINS`), keyed by processor definition id -- a stopgap.

Now built: each ESP32-family processor file carries an `adc2` pin list, `definitions.ts` parses it into
`ProcessorDef.adc2` (validated as a subset of `gpio`), and `adc.ts` reads `ctx.target.processor.adc2`. A user's
own processor file can set it, and the node encodes no chip data. Values (from each chip's datasheet): classic
ESP32 `0, 2, 4, 12-15, 25-27`; ESP32-S2/S3 `11-20`; ESP32-C3 `5`.

Related: `outstanding-items/board-processor-reference-data.md` (keeping the definition folder current).
