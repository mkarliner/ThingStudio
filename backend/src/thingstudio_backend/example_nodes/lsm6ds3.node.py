# ST LSM6DS3TR-C (and LSM6DS3) 6-axis IMU over I2C.
# payload: {'ax','ay','az'} in g and {'gx','gy','gz'} in degrees/s. msg['temperature'] is the chip's own
# temperature in °C. Defaults suit the Seeed XIAO nRF52840 Sense's built-in IMU (I2C 0, SCL 27, SDA 7, power 40).
# For a breakout board, set its bus and pins, and power pin -1.

import machine
import struct
import time

_WHO_AM_I = 0x0F
_CTRL1_XL = 0x10
_CTRL2_G = 0x11
_CTRL3_C = 0x12
_OUT_TEMP_L = 0x20  # temp, gyro x/y/z, accel x/y/z: 7 little-endian int16s from here

# full scale -> (FS bits for CTRL1_XL, g per LSB)
_ACCEL = {'2': (0b00, 0.061e-3), '4': (0b10, 0.122e-3), '8': (0b11, 0.244e-3), '16': (0b01, 0.488e-3)}
# full scale -> (FS bits for CTRL2_G, dps per LSB)
_GYRO = {'250': (0b00, 8.75e-3), '500': (0b01, 17.5e-3), '1000': (0b10, 35e-3), '2000': (0b11, 70e-3)}
_ODR_104HZ = 0x40

_bus = int(properties['bus'])
_scl = properties['scl']
_sda = properties['sda']
_addr = int(properties['address'], 16)
_where = 'I2C %d (SCL %s, SDA %s) at 0x%02X' % (_bus, _scl, _sda, _addr)

if str(properties['accelRange']) not in _ACCEL or str(properties['gyroRange']) not in _GYRO:
    raise ValueError('lsm6ds3: unknown accel or gyro range')
_xl_bits, _xl_scale = _ACCEL[str(properties['accelRange'])]
_g_bits, _g_scale = _GYRO[str(properties['gyroRange'])]

_pwr = properties['powerPin']
if _pwr is not None:
    _p = runtime.shared('pin', _pwr, ('out', 'none'), lambda: machine.Pin(_pwr, machine.Pin.OUT))
    _p.value(1)
    time.sleep_ms(50)  # turn-on time is up to 35 ms

# Same settings as Thingstudio's own I2C nodes, so an i2c bus config node with these pins shares the bus.
_i2c = runtime.shared('i2c', _bus, (_scl, _sda, 400000),
                      lambda: machine.I2C(_bus, scl=machine.Pin(_scl), sda=machine.Pin(_sda), freq=400000))


def _write(reg, value):
    _i2c.writeto_mem(_addr, reg, bytes((value,)))


try:
    _id = _i2c.readfrom_mem(_addr, _WHO_AM_I, 1)[0]
except OSError as e:
    raise OSError('lsm6ds3: no reply on %s. Check pins, address, power pin. [%s]' % (_where, e))
if _id not in (0x6A, 0x69):
    raise OSError('lsm6ds3: chip on %s is not an LSM6DS3 (WHO_AM_I 0x%02X)' % (_where, _id))

_write(_CTRL3_C, 0x01)  # software reset
time.sleep_ms(10)
_write(_CTRL3_C, 0x44)  # block data update, register auto-increment
_write(_CTRL1_XL, _ODR_104HZ | (_xl_bits << 2))
_write(_CTRL2_G, _ODR_104HZ | (_g_bits << 2))
_buf = bytearray(14)


async def emit(properties):
    try:
        _i2c.readfrom_mem_into(_addr, _OUT_TEMP_L, _buf)
    except OSError as e:
        raise OSError('lsm6ds3: read failed on %s [%s]' % (_where, e))
    t, gx, gy, gz, ax, ay, az = struct.unpack('<7h', _buf)
    msg = {
        'payload': {
            'ax': ax * _xl_scale, 'ay': ay * _xl_scale, 'az': az * _xl_scale,
            'gx': gx * _g_scale, 'gy': gy * _g_scale, 'gz': gz * _g_scale,
        },
        'topic': '',
    }
    msg['temperature'] = 25 + t / 256
    return msg
