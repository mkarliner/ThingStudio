# test/hil

Hardware-in-the-loop tests: witness firmware, pin-map config, and test scripts driving the two-ESP32 witness+DUT rig — see `docs/working-notes/validation/mvp-validation-plan.md`.

Placeholder. Not run in CI (needs physical hardware) — stays a manual, documented local gate. The I2C/SPI slave-mode spike flagged in the validation plan hasn't been run yet, so witness firmware for sensor-node testing isn't started; witness firmware for GPIO/PWM/timer edge-capture is the first useful piece to build here.
