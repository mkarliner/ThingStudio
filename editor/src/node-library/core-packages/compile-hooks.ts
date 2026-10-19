// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/compile-hooks.ts
//
// Shared Python source for the core network packages' compile hooks. The WiFi derivation (singleton config,
// security normalisation, SSID/password checks, mqtt deferral) was repeated in wifi_status, wifi_gate and
// udp_send; keeping one copy means the messages and rules cannot drift between them.
//
// Each hook starts with WIFI_DERIVATION, then calls _ts_wifi(ctx) and adds its own field checks.

export const WIFI_DERIVATION = `def _ts_wifi(ctx):
    configs = [c for c in ctx['flow']['configs'] if c['type'] == 'thingstudio/config/wifi']
    if not configs:
        return None, 'needs a WiFi network -- set "WiFi" in its properties (every WiFi node in a flow shares one)'
    if len(configs) > 1:
        return None, 'this flow has %d WiFi configs, but a flow can only have one -- reopen the flow in the editor to merge them' % len(configs)
    wifi = (ctx.get('referencedConfigs') or {}).get(configs[0]['id'])
    if wifi is None:
        return None, 'could not resolve the WiFi config -- reopen the flow in the editor'

    security = wifi.get('security')
    if security not in ('open', 'unmanaged'):
        security = 'password'
    ssid = str(wifi.get('ssid') or '').strip()
    password = str(wifi.get('password') or '')
    if security != 'unmanaged' and not ssid:
        return None, 'the WiFi config has no network name (SSID) -- pick a saved WiFi credential, or set security to "unmanaged"'
    if security == 'password' and not password:
        return None, 'WiFi config for ssid "' + ssid + '" has no password but security is "password"'

    mqtt = any(n['type'] in ('thingstudio/mqtt_publish', 'thingstudio/mqtt_subscribe') for n in ctx['flow']['nodes'])
    return {'ssid': ssid, 'password': password, 'security': security, 'deferToMqtt': mqtt}, None
`;
