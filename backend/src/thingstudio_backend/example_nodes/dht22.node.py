# Example custom node: reads a DHT22 temperature and humidity sensor.
# payload is the temperature in °C; msg['humidity'] is the relative humidity in %.
# Edit or delete this file freely. See the Writing custom nodes page in the docs.

import dht
import machine

_sensor = dht.DHT22(machine.Pin(properties['pin']))

async def emit(properties):
    _sensor.measure()
    msg = {'payload': _sensor.temperature(), 'topic': ''}
    msg['humidity'] = _sensor.humidity()
    return msg
