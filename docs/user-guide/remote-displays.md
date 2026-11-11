Remote displays

!!! note "Custom firmware"

    Remote displays need the board to serve a web page and keep a WebSocket open, which is comfortable on a
    custom firmware image with the runtime and remote libraries frozen. A stock install on a small ESP32 is below
    the feature's floor — the hardware notes at the bottom name the documented case. The editor warns when the
    selected board or image has not been measured for remote displays.

A remote display is your flow's UI on a phone: the board serves the page from its own web server, the phone lays
it out on its own screen, and input — taps, form submits, a slider — comes back to the flow. The board holds no
pixels, so a board with no display hardware at all can still have a good UI.

## What you build

1. A **WiFi network** — the usual [WiFi](wifi-connection.md) config; every node in a flow shares one.
2. A **web server** config — the port the board listens on (80 is ordinary). Create it from the gui screen's
   web server field (+ in the field's picker).
3. A **[gui screen](nodes/gui.md#gui-screen)** with **display kind: remote**, wired to the web server config in
   its properties. Lay out its pages with rows and columns; the phone stretches each row/column's share to its
   own viewport and scrolls when a page is taller than the screen. Nothing here is sized in pixels.
4. The **widgets** the page shows: [readouts](nodes/gui.md#gui-readout), [bars](nodes/gui.md#gui-bar),
   [lights](nodes/gui.md#gui-light), [histograms](nodes/gui.md#histogram), [labels](nodes/gui.md#gui-label),
   [trends](nodes/gui.md#trend), [buttons](nodes/gui.md#buttons) — whatever you'd put on a panel — plus the
   phone-only widgets on the same page: a [number field](nodes/gui.md#number-field),
   a [text field](nodes/gui.md#text-field), a [submit button](nodes/gui.md#submit-button) and a
   [slider](nodes/gui.md#slider).
5. Feed the widgets from your flow: wire the value nodes as usual (the input chains are no different from a
   panel's).

Deploy as normal. The library the board needs (`ts_remote`, and the page itself) is installed with the flow.

## What the user does

The board's console prints one line when the server starts — the URL:

- On the LAN the URL is `http://<board's IP>:<port>/ts/remote/`.
- Opening it on the phone shows a login. The password is the **board's password** (the same one the editor's
  own WiFi transport uses — [where it's set](wifi-connection.md#set-the-password-and-name)). A board with no
  password refuses login: set one.
- The page then shows the screen: live values tick, taps press [buttons](nodes/gui.md#buttons), form submits
  write settings.
- One viewer at a time: the newest login wins, and the older phone is told why and sent back to the login
  screen. Nothing ever locks you out: log in again and you have the screen back.

## Settings that survive a restart

A [number field](nodes/gui.md#number-field) and a [text field](nodes/gui.md#text-field) read from and write
`runtime.settings` — the board's own persistent key/value store for your flow. Type a value into the field, press
the [submit](nodes/gui.md#submit-button) with the same *form* name, and the value survives a reboot (including
showing it again on the phone after a restart). A submit writes its form as one act: an unconvertible value
refuses the whole form, nothing half-applies.

## Remote control with a failsafe

A [slider](nodes/gui.md#slider) is continuous input at roughly 20 messages a second, latest value wins — for
driving something, not picking a setting. Remote control of anything mechanical needs the failure handled like
the ordinary case: set the screen's **lost link means: safe** and its **deadman after (ms)**, and structure the
flow so the slider's messages reach whatever drives the motor only through a wiring that *turns it off* when the
flow's link-down signal arrives. The board sends that signal when the phone stops answering its pings (~3
seconds of silence), and again — without needing the network — when fresh slider input stops for the deadman
time.

## Where to see the numbers

The page's own console prints the phone↔board round-trip each second (prefixed `[rd]`): open the phone's browser
remote debugger — `chrome://inspect` on Android, Safari > Develop on iOS — and read the numbers there.

## Hardware notes

Remote displays ship as part of a custom firmware image: the runtime and the remote libraries are frozen at build
time, and the image is measured so the heap headroom is known.

A stock ESP32-C3 is below this feature's floor: the board's *system* memory runs out under the phone's connection
(the board answers one page, then stops moving packets). If you select a stock install or an untested board, the
compile warns that remote displays are not verified for that image. An ESP32-S3 with octal PSRAM and a custom
firmware image is the working combination — [custom firmware](custom-firmware.md) builds it.

## Related pages

- [gui screen](nodes/gui.md#gui-screen) — the display kinds and every property.
- [gui nodes](nodes/gui.md) — the page widgets, including the phone-only inputs.
- [Board settings](wifi-connection.md#set-the-password-and-name) — setting the board's password over USB.
- [Debugging](debugging.md) — the same transport the remote display logs in with.
