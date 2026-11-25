# Resolves the flow's WiFi and MQTT broker configs into the properties ts_mqtt.ensure_client() needs. A custom
# node's Python only sees a network config's name, not its secrets; the hook gets them in ctx['referencedConfigs'].
# A trimmed copy of the core MQTT nodes' derivation (editor/src/node-library/core-packages/compile-hooks.ts):
# hooks can only import the sandbox's built-in modules.


def _resolved(ctx, config_type, what):
    configs = [c for c in ctx['flow']['configs'] if c['type'] == config_type]
    if len(configs) != 1:
        return None, 'will_test needs exactly one %s config in the flow (it has %d)' % (what, len(configs))
    cfg = (ctx.get('referencedConfigs') or {}).get(configs[0]['id'])
    if cfg is None:
        return None, 'will_test: pick the %s in its properties' % what
    return cfg, None


def compile(ctx, properties):
    wifi, err = _resolved(ctx, 'thingstudio/config/wifi', 'WiFi')
    if err:
        return {'errors': [err]}
    broker, err = _resolved(ctx, 'thingstudio/config/mqtt-broker', 'MQTT broker')
    if err:
        return {'errors': [err]}
    security = wifi.get('security')
    if security == 'unmanaged':
        return {'errors': ['will_test: MQTT manages the WiFi connection, so the WiFi config cannot be "unmanaged"']}
    if security != 'open':
        security = 'password'
    topic = str(properties.get('topic') or '').strip()
    if not topic:
        return {'errors': ['will_test needs an availability topic']}
    host = str(broker.get('broker') or '').strip()
    if not host:
        return {'errors': ['will_test: the broker config has no broker hostname']}
    return {'properties': {
        'topic': topic,
        'ssid': str(wifi.get('ssid') or '').strip(),
        'wifiPassword': str(wifi.get('password') or ''),
        'security': security,
        'broker': host,
        'port': int(broker.get('port') or 1883),
        'username': str(broker.get('username') or ''),
        'brokerPassword': str(broker.get('password') or ''),
    }}
