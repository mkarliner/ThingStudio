# ST LSM6DS3TR-C / LSM6DS3 6-axis IMU, interrupt-driven: the chip watches for an event and signals
# it on INT1, so the board need not poll. Same wiring defaults as the polled st/lsm6ds3 node
# (Seeed XIAO nRF52840 Sense: I2C 0, SCL 27, SDA 7, power 40, INT1 11).
#
# Read on the signal, not a clock: choose the event in the node's `mode` property.
#   data_ready  a fresh accel/gyro/temperature sample is ready
#   wake        movement above `thresholdMg`
#   single_tap / double_tap
#   free_fall
#
# payload is the sample {ax,ay,az} in g and {gx,gy,gz} in deg/s; msg['temperature'] is the chip's °C;
# msg['event'] names the event that fired.
#
# The interrupt line is bridged into asyncio with the vendored ThreadSafeEvent (the only
# non-allocating call safe in the hard-IRQ handler): the handler only sets the flag. reading the
# chip's status register (below) then clears the latched interrupt.
#
# NOTE (hardware-in-the-loop): the data-ready path is the well-trodden one; the wake/tap/free-fall
# register settings are the datasheet's and want confirmation on a real board. Double-tap in particular
# needs a high accel ODR (>= 416 Hz, ST AN5130) and the SINGLE_DOUBLE_TAP bit -- both set below.

import machine
import struct
import time
from threadsafe_event import ThreadSafeEvent

_WHO_AM_I = 0x0F
_CTRL1_XL = 0x10
_CTRL2_G = 0x11
_CTRL3_C = 0x12
_INT1_CTRL = 0x0D
_OUT_TEMP_L = 0x20  # temp, gyro x/y/z, accel x/y/z: 7 little-endian int16s from here
_WAKE_UP_SRC = 0x1B
_TAP_SRC = 0x1C
_TAP_CFG = 0x58
_TAP_THS_6D = 0x59
_INT_DUR2 = 0x5A
_WAKE_UP_THS = 0x5B
_FREE_FALL = 0x5D
_MD1_CFG = 0x5E

# full scale -> (FS bits for CTRL1_XL, g per LSB)
_ACCEL = {'2': (0b00, 0.061e-3), '4': (0b10, 0.122e-3), '8': (0b11, 0.244e-3), '16': (0b01, 0.488e-3)}
# full scale -> (FS bits for CTRL2_G, dps per LSB)
_GYRO = {'250': (0b00, 8.75e-3), '500': (0b01, 17.5e-3), '1000': (0b10, 35e-3), '2000': (0b11, 70e-3)}
_ODR_104HZ = 0x40
_ODR_416HZ = 0x60  # tap detection needs a high accel ODR (ST AN5130)

_bus = int(properties['bus'])
_scl = properties['scl']
_sda = properties['sda']
_addr = int(properties['address'], 16)
_int = properties['intPin']
_where = 'I2C %d (SCL %s, SDA %s) at 0x%02X' % (_bus, _scl, _sda, _addr)

if str(properties['accelRange']) not in _ACCEL:
    raise ValueError('lsm6ds3_int: unknown accel range "%s"' % str(properties['accelRange']))
_xl_bits, _xl_scale = _ACCEL[str(properties['accelRange'])]
_g_bits, _g_scale = _GYRO['500']
_xl_fs_g = float(str(properties['accelRange']))

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
    raise OSError('lsm6ds3_int: no reply on %s. Check pins, address, power pin. [%s]' % (_where, e))
if _id not in (0x6A, 0x69):
    raise OSError('lsm6ds3_int: chip on %s is not an LSM6DS3 (WHO_AM_I 0x%02X)' % (_where, _id))

# A raw threshold in mg -> the chip's 6-bit threshold (threshold = THS * FS / 64).
def _threshold(bits):
    ths = int(round((int(properties['thresholdMg']) / 1000.0) * 64.0 / _xl_fs_g))
    return max(1, min((1 << bits) - 1, ths))

_write(_CTRL3_C, 0x01)  # software reset
time.sleep_ms(10)
_write(_CTRL3_C, 0x44)  # block data update, register auto-increment

_mode = str(properties['mode'])
# Tap recognition needs a high accel ODR (>= 416 Hz, ST AN5130); 104 Hz is enough for the rest.
_xl_odr = _ODR_416HZ if _mode in ('single_tap', 'double_tap') else _ODR_104HZ
_write(_CTRL1_XL, _xl_odr | (_xl_bits << 2) | 0x02)
_write(_CTRL2_G, _ODR_104HZ | (_g_bits << 2))  # gyro at 104 Hz

if _mode == 'data_ready':
    _status_reg, _event = None, 'data_ready'
    _write(_INT1_CTRL, 0x01)  # INT1_DRDY_XL
elif _mode == 'wake':
    _status_reg, _event = _WAKE_UP_SRC, 'wake'
    _write(_TAP_CFG, 0x81)                 # INTERRUPTS_ENABLE + latched (LIR)
    _write(_WAKE_UP_THS, _threshold(6))    # WK_THS[5:0], single-tap bit 0
    _write(_MD1_CFG, 0x20)                 # INT1_WU
elif _mode in ('single_tap', 'double_tap'):
    _status_reg, _event = _TAP_SRC, _mode
    _write(_TAP_CFG, 0x8E)                 # INTERRUPTS_ENABLE + tap on X/Y/Z
    _write(_TAP_THS_6D, _threshold(5))     # TAP_THS[4:0]
    _write(_INT_DUR2, 0x7F)                # tap duration / quiet / shock
    _write(_WAKE_UP_THS, 0x80 if _mode == 'double_tap' else 0x00)  # SINGLE_DOUBLE_TAP on
    _write(_MD1_CFG, 0x08 if _mode == 'double_tap' else 0x40)      # INT1_DOUBLE_TAP / INT1_SINGLE_TAP
elif _mode == 'free_fall':
    _status_reg, _event = _WAKE_UP_SRC, 'free_fall'
    _write(_TAP_CFG, 0x81)   # INTERRUPTS_ENABLE + LIR
    _write(_FREE_FALL, 0x33)  # FF_DUR / FF_THS
    _write(_MD1_CFG, 0x10)   # INT1_FF
else:
    raise ValueError('lsm6ds3_int: unknown event "%s"' % _mode)

# INT1 as a keyed singleton (shares the pin with a built-in interrupt node), an IRQ handler that only
# sets the event, and the registration. Active high, so a rising edge.
_evt = ThreadSafeEvent()
_int_pin = runtime.shared('pin', _int, ('in', 'none'), lambda: machine.Pin(_int, machine.Pin.IN))


def _irq_handler(_pin):
    _evt.set()


_int_pin.irq(trigger=machine.Pin.IRQ_RISING, handler=_irq_handler)
_buf = bytearray(14)


async def wait(properties):
    await _evt.wait()
    _evt.clear()


async def emit(properties):
    if _status_reg is not None:
        try:
            _i2c.readfrom_mem(_addr, _status_reg, 1)  # reading status clears the latched interrupt
        except OSError as e:
            raise OSError('lsm6ds3_int: status read failed on %s [%s]' % (_where, e))
    try:
        _i2c.readfrom_mem_into(_addr, _OUT_TEMP_L, _buf)
    except OSError as e:
        raise OSError('lsm6ds3_int: read failed on %s [%s]' % (_where, e))
    t, gx, gy, gz, ax, ay, az = struct.unpack('<7h', _buf)
    msg = {
        'payload': {
            'ax': ax * _xl_scale, 'ay': ay * _xl_scale, 'az': az * _xl_scale,
            'gx': gx * _g_scale, 'gy': gy * _g_scale, 'gz': gz * _g_scale,
        },
        'topic': '',
        'event': _event,
    }
    msg['temperature'] = 25 + t / 256
    return msg
