# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_wifi/ts_wifi.py
#
# Thingstudio's shared WiFi station bring-up, a flow dependency rather than part of the runtime (so a flow
# without WiFi never carries it). It exists so a package and the built-in network nodes can share one
# idempotent call: the compiler's old "wifi-sta" setup dedup only worked between built-ins, and a package's
# per-instance setup cannot see another node's generated statement. Calling this twice is harmless when the
# settings agree; a genuine disagreement is a loud ValueError, not a silent first-wins.
#
# Behaviour matches wifi-status.ts's old wifiSetupStatement():
#   - "unmanaged" security: just bring the interface up, no connect().
#   - defer_to_mqtt: mqtt_as owns reconnection; join once at import on ESP32 if not already connected.
#   - otherwise: connect() if not already connected.

import network
import sys

_sta = None
_settings = None


def ensure_station(ssid, password, security="password", defer_to_mqtt=False):
    global _sta, _settings
    settings = (ssid, password, security, bool(defer_to_mqtt))
    if _settings is not None:
        if settings != _settings:
            raise ValueError(
                "ts_wifi: two nodes asked for different WiFi settings (%r vs %r) -- every WiFi node in a flow must share one network" % (_settings, settings)
            )
        return _sta

    _settings = settings
    _sta = network.WLAN(network.STA_IF)
    _sta.active(True)

    if security != "unmanaged":
        if defer_to_mqtt:
            if ssid and sys.platform == "esp32" and not _sta.isconnected():
                _sta.connect(ssid, password)
        elif not _sta.isconnected():
            _sta.connect(ssid, password)
    return _sta
