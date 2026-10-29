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
        return None, 'this flow has %d WiFi configs, but a flow can only have one -- pick the network in the WiFi field of any node to keep just that one' % len(configs)
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

/**
 * MQTT derivation for mqtt_publish/mqtt_subscribe (2026-10-19, ts_mqtt). Resolves the referenced broker config and
 * combines it with the flow's WiFi settings into the keys the package Python and ts_mqtt read. `label` is the node
 * type, so an error says which node rejected it (the package hook has no other place to name it).
 *
 * The WiFi password is renamed to `wifiPassword`: a broker password is a separate secret on the same node, and both
 * were called `password` before the hook flattened them into one dict.
 */
export const MQTT_DERIVATION = `${WIFI_DERIVATION}
def _ts_mqtt_broker(ctx, properties, label):
    # One broker per flow (2026-10-29), like WiFi: the flow's one config, whatever the node's own brokerConfigId says.
    configs = [c for c in ctx['flow']['configs'] if c['type'] == 'thingstudio/config/mqtt-broker']
    if not configs:
        return None, label + ' needs an MQTT broker -- set "MQTT Broker" in its properties (every MQTT node in a flow shares one)'
    if len(configs) > 1:
        return None, 'this flow has %d MQTT broker configs, but a flow can only have one -- pick the broker in the MQTT Broker field of any MQTT node to keep just that one' % len(configs)
    cfg = (ctx.get('referencedConfigs') or {}).get(configs[0]['id'])
    if cfg is None:
        return None, 'could not resolve the MQTT broker config -- reopen the flow in the editor'
    broker = str(cfg.get('broker') or '').strip()
    if not broker:
        return None, label + "'s referenced broker config has no \\"broker\\" hostname/IP set"
    try:
        port = int(cfg.get('port') or 1883)
    except (TypeError, ValueError):
        port = 0
    if port < 1 or port > 65535:
        return None, label + "'s referenced broker config has an invalid port -- must be 1-65535"
    return {
        'broker': broker,
        'port': port,
        'username': str(cfg.get('username') or ''),
        'brokerPassword': str(cfg.get('password') or ''),
    }, None

def _ts_mqtt(ctx, properties, label):
    wifi, err = _ts_wifi(ctx)
    if err:
        return None, err
    if wifi['security'] == 'unmanaged':
        return None, label + "'s WiFi config has security \\"unmanaged\\", which is not supported here -- mqtt_as manages its own WiFi connection and needs real credentials to do so"
    broker, err = _ts_mqtt_broker(ctx, properties, label)
    if err:
        return None, err
    settings = dict(wifi)
    settings['wifiPassword'] = settings.pop('password')
    settings.update(broker)
    return settings, None
`;
