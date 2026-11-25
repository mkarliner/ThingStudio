# Visitor camera and talking annunciator — scoping

Status: musing, 2026-11-24, from a chat with Mike. Nothing decided or built. Mike: it's a personal project, a
showcase flow, and a blog post, all three. Related: `a-la-carte-images-scoping.md` (the camera driver needs a
custom image), `home-assistant-integration-scoping.md` (same audience, same MQTT conventions),
`gui-layout-widget-system-scoping.md` and `decisions/gui-layout.md` (the annunciator's display).

## The idea

An ESP camera takes pictures when it sees a person and sends them to a server, which learns regular visitors. A
second ESP is an annunciator that says who has arrived. Stretch goal: it speaks the name.

```
[PIR] -> camera board --JPEG over HTTP--> server (detect person, recognise face)
                                             |
                                    MQTT visitor/arrived {"name": ...}
                                             v
                                    annunciator board (display, chime, voice)
```

## Camera board

- **Hardware**: ESP32-CAM (AI-Thinker, classic ESP32 + 4 MB PSRAM, OV2640) works; an ESP32-S3 camera board (e.g.
  XIAO ESP32S3 Sense) has far more headroom. Prefer the S3.
- **Driver**: stock MicroPython has no camera module. Community C-module drivers exist (lemariva's
  `micropython-camera-driver`, cnadler86's `micropython-camera-API`); check which suits MicroPython v1.29.0 / IDF
  v5.5.2. Needs a custom image: a first real customer for à la carte images. A hand-built image is fine to start.
- **`camera` node** (new): capture a JPEG into PSRAM, emit it as a message.
- **Seeing a human**: on-board person detection is hard in MicroPython (ESP-DL on the S3 can, in C). Practical:
  a PIR sensor (plain digital input) triggers capture; the server decides whether it's a person.
- **Sending**: HTTP POST with a binary body (a JPEG is ~20-50 KB, awkward over MQTT with mqtt_as buffers). Check
  whether the current HTTP nodes can POST binary; if not, that's new work.

## Server

Off the shelf, not written by us: Frigate (person detection) plus CompreFace or Double Take (face learning). They
speak MQTT and fit Home Assistant. The server publishes e.g. `visitor/arrived {"name": "Peter"}` or
`{"name": "unknown"}`.

## Annunciator board

- Existing nodes: `mqtt_subscribe` → display (name) + buzzer or NeoPixel. A small GUI-system demo.

### Stretch: talking

- **Speech on the server** with Piper (local, offline TTS). Recognised visitor → "Peter's at the door" as a WAV.
- **Playback on the board**: an I2S amp (MAX98357A) and a small speaker; MicroPython's `machine.I2S` on ESP32 and
  RP2. Stream the WAV over HTTP in chunks so it never has to fit in RAM.
- **WAV, not MP3**: plain PCM needs no decoder; MP3 would need another C module.
- **Cache per person**: generate each phrase at enrolment, store in flash or on SD, so announcements are instant and
  work if the server is busy. Unknown visitors get a stock phrase.
- On-board speech is possible retro-style (SAM-type formant synths, in C), but sounds very 1982.
- **`audio out` node** (new): I2S, play a WAV from a URL or a file, plus an amp wiring guide. Reusable for
  doorbells, alarms, timers.

## New Thingstudio work

1. Camera driver in an image + `camera` node.
2. Binary HTTP POST, if missing.
3. `audio out` node (stretch).

Everything else exists or is off the shelf.

## Order (also the blog post's sections)

1. Camera image + `camera` node.
2. PIR → capture → POST to the server.
3. Server: Frigate + CompreFace/Double Take publishing `visitor/arrived`.
4. Annunciator: display + chime, ideally on the GUI system.
5. Stretch: Piper + I2S, the panel says the name.
6. Run it on Mike's own door for a week, then write it up.

## The blog post angle

- Two boards, one editor, joined by MQTT.
- The camera needs a custom image: a natural place to introduce à la carte images.
- Plays with what HA users run already.
- Faces stay on your own server: no cloud, no account. The privacy pitch lands best here.
- Ending: the panel says your visitor's name out loud.

## Notes

- Privacy: it records visitors' faces. If the camera sees beyond the property boundary, check the ICO's domestic
  CCTV guidance before running it, and say so in the post.

## Open questions

1. Camera board: ESP32-CAM or S3?
2. Which MicroPython camera driver?
3. Can the HTTP nodes POST binary today?
4. Frigate + CompreFace or Double Take, and on what server?
5. Annunciator board and display.
