import ts_mqtt
import ts_wifi
import tswill

ts_wifi.ensure_station(properties['ssid'], properties['wifiPassword'], properties['security'], True)

_client = ts_mqtt.ensure_client(
    properties['broker'], properties['port'], properties['ssid'], properties['wifiPassword'],
    properties['security'], properties['username'], properties['brokerPassword'])
_announcer = tswill.Announcer(_client, properties['nodeId'], properties['topic'])


async def wait(properties):
    await _announcer.wait_connect()


async def emit(properties):
    return {'payload': 'online #%d' % _announcer.count, 'topic': properties['topic']}
