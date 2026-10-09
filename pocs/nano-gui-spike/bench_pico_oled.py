# bench_pico_oled.py -- nano-gui spike, small-GUI check: Pico W + 128x64 SSD1306 (I2C).
# Copy the spike files to the board first (see README.md), then:
#   mpremote connect <port> run bench_pico_oled.py
# Optional: set WIFI_SSID/WIFI_PASS to measure with networking up, as a real flow would be.
import gc
gc.collect()
_m0 = gc.mem_free()
import time, machine

SDA, SCL, I2C_ID, ADDR = 4, 5, 0, 0x3C   # change to match your wiring
WIFI_SSID, WIFI_PASS = '', ''


def mem(label, before):
    gc.collect()
    now = gc.mem_free()
    print('RAM  %-34s %7d bytes   (free now %d)' % (label, before - now, now))
    return now


print('--- nano-gui spike bench, Pico + SSD1306 ---')
print('free at start', _m0)
m = _m0
if WIFI_SSID:
    import network
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(WIFI_SSID, WIFI_PASS)
    for _ in range(100):
        if wlan.isconnected():
            break
        time.sleep_ms(100)
    print('wifi connected:', wlan.isconnected())
    m = mem('wifi up', m)

from ssd1306 import SSD1306_I2C
i2c = machine.I2C(I2C_ID, sda=machine.Pin(SDA), scl=machine.Pin(SCL), freq=400_000)
oled = SSD1306_I2C(128, 64, i2c, addr=ADDR)   # the driver IS the framebuffer (MONO_VLSB)
m = mem('ssd1306 driver + 1KB framebuffer', m)

import gui.core.nanogui, gui.core.writer, gui.widgets.label, gui.widgets.meter, gui.widgets.led
m = mem('nano-gui core + Label/Meter/LED', m)
import state_widgets as sw
m = mem('spike state widgets', m)
import digits24
m = mem('font digits24 (subset .-0..9)', m)
import body10
m = mem('font body10 (ASCII + degree)', m)

from gui.core.writer import Writer
from gui.widgets.label import Label
t = sw.THEMES['mono']
big = Writer(oled, digits24, verbose=False)
small = Writer(oled, body10, verbose=False)
RECTS = {'title': (0, 0, 128, 12), 'readout': (0, 16, 108, 26), 'bar': (112, 14, 16, 48),
         'led': (2, 52, 10, 10), 'led_lbl': (16, 52, 60, 10)}
title = Label(small, 1, 2, 100, bdcolor=False, fgcolor=t['title_fg'], bgcolor=t['accent'])
readout = sw.Readout(big, small, RECTS['readout'], '°C', t)
bar = sw.Bar(small, RECTS['bar'], t, 950, 1050)
led = sw.StatusLED(small, RECTS['led'], t)
led_lbl = Label(small, 52, 16, 60, bdcolor=False, fgcolor=t['fg'], bgcolor=t['bg'])
m = mem('widget objects', m)


def draw(state):
    for wd, v in ((readout, 21.5), (bar, 1013), (led, True)):
        wd.set(v, state)
    oled.fill(0)
    oled.fill_rect(0, 0, 128, 12, t['accent'])
    title.value('Living room', invert=True)  # plain Writer ignores colours: invert instead
    readout.show(); bar.show(); led.show()
    led_lbl.value('MQTT')


for name, st in (('known', sw.KNOWN), ('unknown', sw.UNKNOWN), ('stale', sw.STALE)):
    t0 = time.ticks_us()
    draw(st)
    d = time.ticks_diff(time.ticks_us(), t0) / 1000
    t0 = time.ticks_us()
    oled.show()
    p = time.ticks_diff(time.ticks_us(), t0) / 1000
    print('TIME %-8s draw page %6.1f ms, push (I2C 400kHz) %6.1f ms' % (name, d, p))
    time.sleep(2)

N = 20
t0 = time.ticks_us()
for i in range(N):
    readout.set(20 + i / 10, sw.KNOWN)
    readout.show()
print('TIME readout redraw %.2f ms' % (time.ticks_diff(time.ticks_us(), t0) / 1000 / N))
gc.collect()
print('free at end', gc.mem_free())
print('--- done. Paste everything above into the chat. ---')
