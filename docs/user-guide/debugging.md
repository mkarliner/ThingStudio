# Debugging & troubleshooting

## Console and compiled source

The **console** panel shows everything the connected board reports: deploy results, node errors, and anything a `debug` node prints. Clear it with the button in its corner.

The **source preview** panel shows the actual MicroPython the current canvas compiles to — useful for seeing exactly what a flow does, or for confirming a fix landed where you expected.

## Board won't connect

When **Connect**, **Check status** or **Install runtime…** gets no proper reply, the console says what the board sent instead. Each case has a next step.

| Console says | What it means | What to do |
| --- | --- | --- |
| The board didn't reply at all | Usually no MicroPython on the board | [Install MicroPython](installing-micropython.md). If it's already there, press reset and try again. |
| MicroPython but not the Thingstudio runtime | MicroPython is fine; the runtime is missing | Click **Install runtime…**. |
| The board is in its bootloader | An ESP32 is in download mode | Press reset without holding BOOT. |
| Running CircuitPython, or other firmware | Not MicroPython | [Install MicroPython](installing-micropython.md). |
| The runtime is starting up | It's still booting | Wait a few seconds, then click **Check status**. |

The raw error from the backend stays in the message in brackets. Include it if you report a problem.

## Reading a node error

When a node raises an exception on the device, the board reports which node and what went wrong. Every network node (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) follows the same convention for its own errors: the operation and the host/port it was talking to are named directly in the message, not left for you to guess from a bare exception. If you see a raw, unattributed error with no context from a network node, that's worth reporting — every network node in this project is meant to wrap its own errors before they reach you.

## Native arch (the "Native arch" dropdown)

A few nodes (currently `display_spi`'s `gs4`/`gs2`/`mono` frame formats) compile part of their code to native machine code, not portable bytecode. That needs the right target architecture for your board's chip.

The **Native arch** dropdown in the toolbar defaults to **Auto**, which reads your board's chip type from its HELLO response. If you haven't connected yet, or Auto picks the wrong one, choose your board's chip directly from the list instead.

If Deploy fails with an architecture or native-module error, that's the sign to check this dropdown — pick your board's chip explicitly and redeploy.

## Known platform limitation: WiFi/MQTT connect ordering

If a flow has both a `wifi_status` node and an MQTT node (`mqtt_publish`/`mqtt_subscribe`), you may occasionally see a WiFi connection error at deploy time on ESP32 boards — the WiFi driver refusing a second connect attempt while the first is still settling. This is fixed on RP2040; on ESP32 it's narrowed but not fully eliminated. If you hit it, redeploying usually succeeds on the retry. It's a known platform timing issue, not a mistake in your flow.
