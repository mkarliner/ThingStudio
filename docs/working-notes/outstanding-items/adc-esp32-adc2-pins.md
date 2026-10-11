# ADC2 pins: move the ESP32 map into the board definitions

Status: open, 2026-10-11. The `adc` node (`editor/src/node-library/adc.ts`) refuses an ESP32 ADC2 pin when the
flow uses WiFi (ADC2 is unusable while the radio is on). The pin map (`ADC2_PINS`) is hardcoded in the node, keyed
by processor definition id — a stopgap.

It belongs in the processor definitions (`editor/src/definitions/processors/*.json`), next to `gpio`/`reserved`,
so a user's own processor file can carry it and the node doesn't encode chip data. Add an `adc2` pin list to the
ESP32-family files, parse it in `definitions.ts` (`ProcessorDef` + `PROCESSOR_KEYS`), and have `adc.ts` read
`ctx.target.processor.adc2`. Until then, a new ESP32 variant with a different ADC2 set would be wrong in the node.

Values now (from each chip's datasheet): classic ESP32 `0, 2, 4, 12-15, 25-27`; ESP32-S2/S3 `11-20`; ESP32-C3 `5`.

Related: `outstanding-items/board-processor-reference-data.md` (keeping the definition folder current).
