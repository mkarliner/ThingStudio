# pwm out

Drives a PWM signal on a GPIO pin — for dimming an LED, driving a motor, or anything else that wants a variable duty cycle rather than a plain on/off.

## Properties

- **pin** — GPIO pin number (0–39).
- **frequency (Hz)** — the PWM frequency. Default 1000Hz.

## Behavior

The input is a duty fraction from `0.0` (always off) to `1.0` (always on). A value outside that range is clamped rather than rejected — a slightly-out-of-bounds computed value won't crash the flow.
