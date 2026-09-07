# Debugging & troubleshooting

## Console and compiled source

The **console** panel shows everything the connected board reports: deploy results, node errors, and anything a `debug` node prints. Clear it with the button in its corner.

The **source preview** panel shows the actual MicroPython the current canvas compiles to — useful for seeing exactly what a flow does, or for confirming a fix landed where you expected.

## Reading a node error

When a node raises an exception on the device, the board reports which node and what went wrong. Every network node (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) follows the same convention for its own errors: the operation and the host/port it was talking to are named directly in the message, not left for you to guess from a bare exception. If you see a raw, unattributed error with no context from a network node, that's worth reporting — every network node in this project is meant to wrap its own errors before they reach you.

## Known platform limitation: WiFi/MQTT connect ordering

If a flow has both a `wifi_status` node and an MQTT node (`mqtt_publish`/`mqtt_subscribe`), you may occasionally see a WiFi connection error at deploy time on ESP32 boards — the WiFi driver refusing a second connect attempt while the first is still settling. This is fixed on RP2040; on ESP32 it's narrowed but not fully eliminated. If you hit it, redeploying usually succeeds on the retry. It's a known platform timing issue, not a mistake in your flow.
