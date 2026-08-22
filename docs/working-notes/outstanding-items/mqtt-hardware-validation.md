# MQTT real-hardware validation + network follow-ups (in progress)

Mike's own direct request, takes priority over the sequencing below. Doesn't remove or reorder the rp2350 item — just goes first.

Scope: real-hardware validation of the MQTT WiFi-precheck fix and full MQTT functional pass (pub/sub, broker auth, qos 1,
retain, outage recovery — none run on real hardware yet), plus `http_request`'s still-open config-node/canvas migration
and hardware pass, plus extending Problem 2a's loud-network-error fix to `http_request`/`mqtt-shared.ts`.

Full brief: `mqtt-hardware-validation-and-network-followups-briefing.md`.
