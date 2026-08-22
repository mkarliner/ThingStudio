# TCP send / TCP listen-receive — never built

`udp-tcp-nodes-implementation-briefing.md` scoped four new node types; only UDP send/receive landed (confirmed
hardware-tested via `test-flows/udp-echo-tester.flow.json`, per `config-node-and-palette-implementation-briefing.md`).

TCP send (needs a new lazy-expiry connection cache) and TCP listen-receive (needs a real callback-to-coroutine
bridge design, `uasyncio.start_server`'s per-connection handler into this project's one-coroutine-per-source model,
plus a per-connection read timeout) are both still open design + implementation work, tracked in
`mvp-feature-priorities.md` Tier 1 item 5 point 3.
