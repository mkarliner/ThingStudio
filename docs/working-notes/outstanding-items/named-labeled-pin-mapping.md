# Named/labeled pin mapping — Mike's ask, not scoped
> **2026-10-30 sweep:** Update: partially covered since writing — board files' named `pins` labels landed with the
  2026-09-23 definitions and surface in the pin field (`PinField.vue`). What remains open is the
  per-node dropdown of user-defined aliases.


Define human-readable names for pins once, reuse them in every pin-selection dropdown, instead of remembering "sensor X is on GPIO14" by hand. Related to but distinct from the config-node work already done.
