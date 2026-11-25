# Project-led posts (draft for the marketing plan)

Status: draft, 2026-11-24, from a chat with Mike. Destined for ThingStudioMarketing (`marketing-plan.md`); kept in
working notes until Mike moves it. The product notes it refers to are alongside it in working notes.

## The idea

Promote ThingStudio through projects, not product posts. The post is about something worth building; ThingStudio
appears in the "how" and in a "Built with ThingStudio" line. People share projects; they rarely share product pitches.

## Rules for a project-led post

- **The project is the subject.** Problem, result, parts list, wiring. It should stand on its own for a reader who
  never installs anything.
- **ThingStudio is in the how.** Screenshots of the flows (seeing them is the pitch), and a short "Built with
  ThingStudio" line and link at the end. No feature list.
- **One-click flows.** "Open this flow in your browser" links straight into ThingStudio Web. A reader looks at the
  real flow with nothing to install. This is the hook.
- **Honest about limits.** What didn't work, what needed a custom image, what it costs.
- **Real hardware, run for real.** Built and used (e.g. a week on Mike's own door) before it's written up.
- **Mike's voice.** Per the voice list: the openings and the story are his.

## Where they go

Hackaday tips, Hackster, r/esp32, r/micropython, r/homeassistant, the Node-RED forum, the MicroPython Discussions
show-and-tell. A project tip can be sent again for each new project, unlike the one-shot product launch tip held in
reserve (marketing plan §9), so project posts don't spend it.

## First candidates

1. **The door camera that learns your visitors.** An ESP32 camera triggered by a PIR sends pictures to a local
   server (Frigate + CompreFace/Double Take), which learns regular visitors; a second board announces who's there,
   and as a stretch says the name out loud (Piper TTS + I2S speaker). Angles: two boards, one editor; faces never
   leave your house; plays with Home Assistant. Product notes: `visitor-camera-annunciator-scoping.md`.
2. **The Pi + Pico box: flow programming all the way down.** Node-RED on a Pi Zero 2 W, ThingStudio on a Pico for
   the real-time pin work, the ThingStudio App hosted on the Pi. Angle: generous to Node-RED, each layer doing what
   it's good at. Strong fit for the Node-RED forum. Product notes: `pi-plus-pico-appliance-scoping.md`.

Possible later: the HA wall panel (`home-assistant-integration-scoping.md`), a USB macro pad (HID nodes on a Pico).

## Measuring

Count per post: visits to the post, clicks on "Open this flow", and ThingStudio Web sessions in the days after
(GoatCounter). Feeds the plan's "trying it" target.

## Open questions

1. A home for the posts: the docs site, a blog on the landing site, or external (Hackster, dev.to)?
2. A "Projects" section with every flow openable in ThingStudio Web?
3. Cadence: one project a month?
