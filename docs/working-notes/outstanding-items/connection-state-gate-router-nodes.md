# Connection-state gate/router nodes — neither shape built

Neither shape built. A pass-or-drop WiFi/MQTT-status gate (cheap, no compiler change) and a real two-output status
router (needs a genuine multi-output-port contract in the compiler/graph model) are both flagged, neither started.
The router shape connects to a bigger, recurring need — "route by a condition" — worth designing as a generic
switch/router primitive rather than wifi/mqtt-specific, per `mvp-feature-priorities.md`'s own reasoning.
