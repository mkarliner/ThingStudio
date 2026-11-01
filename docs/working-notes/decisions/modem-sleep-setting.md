# A modem-sleep setting on the WiFi config

Status: parked, 2026-11-01. Mike asked "should we have a modem-sleep wake setting in the wifi config? Can we?",
heard the trade, said **park** — record the decision and the scope so nobody re-derives it, and so the next
`ts_wifi`-touching runtime change picks it up.

## The known facts

A classic ESP32 (Wemos D1 R32) answering `http in` toggles took 0.16-1.2 s per request over WiFi+VPN, collapsing
to a steady 0.15-0.20 s once the radio was warm -- the idle board's modem-sleep wake
([the outstanding entry](../outstanding-items.md), 2026-11-01; the C3 lossy-pings item is the same class,
deferred 2026-09-25). Today that is documented, not fixed: the FAQ entry "Why do http in requests take a second
to answer?".

## What is true when it is built

- **Can: yes.** The hook is `vendor/thingstudio_wifi/ts_wifi.py`'s `ensure_station()`: after `_sta.active(True)`,
  a `power_save` option runs `_sta.config(pm=network.WLAN.PM_NONE)`. The option rides the flow's one WiFi config
  node — one network per flow, so one setting per flow — and the codegen threads it through `ensure_station`.
- **Shape:** a "Power save" select on the WiFi config, **"on" (modem sleep, the default) / "off" (the radio
  stays in receive; answers immediately, draws more current)**. Defaults unchanged: a battery board keeps the
  saving and the second of wake latency; a mains board pays current for immediacy.
- **Named limits:** the option honors the direct-connect path only. The `unmanaged` security (no connect at all)
  doesn't use it; the `defer_to_mqtt` path is `mqtt_as`'s own runtime, so the field's help text says what it does
  and does not do there rather than promising silently.
- **Version bump:** a codegen-visible new argument to `ensure_station` breaks a board running the old
  `ts_wifi.py` (the call has a new keyword), so the change is a **major** bump of `_RUNTIME_VERSION` /
  `EDITOR_TARGET_VERSION`, per the standing discipline.
- **Docs owed in the same change:** the WiFi config's entry in [Config nodes](../../user-guide/working-in-the-editor.md)
  and the flash-dial FAQ entry above gain the setting; the FAQ line's "documented, not fixed" wording retires when
  the setting exists.
