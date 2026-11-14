# ThingStudio-overhead flows

Pending. These are the flows that run the same workloads through the
ThingStudio runtime, so the device baseline in `../device/bench.py` can be
compared with the flow path:

- `timer-gpio.flow.json` — timer at 1 ms toggling a marker pin.
- `interrupt-gpio.flow.json` — external IRQ to a marker pin through the
  `interrupt` node and its `ThreadSafeEvent` handoff.
- `adc-node.flow.json` — ADC node at poll 0 and 1 ms, with and without a sink.
- `chain-5.flow.json`, `chain-10.flow.json` — the same source and sink with
  no-op transform nodes between them, to measure per-hop dispatch cost.
- `bus-concurrency.flow.json` — UART, I²C and SPI chains plus marker pins, for
  the "multiple channels at once" measurement.

Each flow is deployed with `test-flows/device_cli.py flow deploy`, and the
marker pins are captured with the Pico LA (sibling repo) or a scope. The
generated code is one coroutine per chain with inline node calls, so the
interesting number is the slope across chain lengths, not a single flow.

Do not add a flow here without a corresponding row in `../README.md` and a
pin note; an unlabelled marker pin is not a measurement.
