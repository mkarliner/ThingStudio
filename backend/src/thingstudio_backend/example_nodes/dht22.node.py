# Example custom node: reads a DHT22 temperature and humidity sensor.
# payload is the temperature in °C; msg['humidity'] is the relative humidity in %.
# Edit or delete this file freely. See the Writing custom nodes page in the docs.

import dht
import machine

# runtime.shared() gives every node on this pin the same Pin object, and stops the flow with a clear error
# if another node has set the pin up differently.
_pin = properties['pin']
_sensor = dht.DHT22(runtime.shared('pin', _pin, ('dht22',), lambda: machine.Pin(_pin)))

async def emit(properties):
    _sensor.measure()
    msg = {'payload': _sensor.temperature(), 'topic': ''}
    msg['humidity'] = _sensor.humidity()
    return msg
