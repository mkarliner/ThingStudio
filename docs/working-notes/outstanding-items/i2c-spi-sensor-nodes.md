# I2C/SPI sensor nodes — not started at all

Not started at all. Tier 1 item 3, gated on having actual sensor hardware on hand
(`tier1-sensors-network-briefing.md`).

Also carries its own unresolved fault-handling question, flagged by Mike 2026-08-16
(`mikes-questions-and-points.md`): does a stuck/unresponsive I2C device hang the node's coroutine indefinitely, and
does that need the same bounded-timeout treatment §5 requires for network I/O? Per `CLAUDE.md`'s engineering
priority, this should be resolved while building the first I2C sensor node, not deferred past it.

Also gates on the I2C/SPI slave-mode spike for witness-rig adversarial testing — `witness_firmware.py`'s
`I2C_SLAVE_EMULATE` is still a stub.
