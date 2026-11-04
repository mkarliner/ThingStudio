# Tutorial flows

If you'd rather not build the tutorial flows from scratch, or you get stuck, their finished flow files are in the
tutorials folder, [below](#where-the-folder-is). Open one with **File → Open…**. Each entry below says what the flow shows
and what to change first.

You'll need to change the flow to match your WiFi setup, and the actual pins that devices, like LEDs, are connected to on
your board. If your board is one of those that already have a definition file made for it, you can set it in the **Board**
drop-down ([Boards and processors](boards.md#picking-the-board)).

## Where the folder is

Every install has a `tutorials` folder. Where it is depends on how you installed:

| Install | Examples folder |
| --- | --- |
| Installer script, macOS and Linux | `~/.local/share/thingstudio/current/tutorials` |
| Installer script, Windows | `%LOCALAPPDATA%\Thingstudio\versions\thingstudio-VERSION-windows-x86_64\tutorials` |
| Package | `tutorials`, inside the folder you unpacked |
| From source | `tutorials`, in the repository folder |

The Windows path contains the version, so it changes when you upgrade.

## Before you deploy

- **Pins are examples.** Set your board's pin in the property panel. **Pins…** next to the **Board** menu lists the
  pins your board has.
- **A flow with a WiFi or MQTT node holds no passwords.** The network name, password and broker address are kept in a
  saved credential on your computer, never in the flow file. Open the node's **WiFi** or **MQTT Broker** field and
  click ✎: fill in your own details and save, or pick one you have already saved from the drop-down. See
  [The Thingstudio folder](thingstudio-folder.md#credentials).

## The flows

In the order that builds up. Each entry lists what to try changing first, and where to read about the node.

### `blink.flow.json`

A `timer` counts, a `function` turns the count into on and off, and `gpio out` drives the LED. Walked by
[Blink an LED](first-flow.md).

- **pin** on [gpio out](nodes/gpio-out.md): your LED's GPIO number. The file has 15.
- **interval (ms)** on [timer](nodes/timer.md): each tick toggles the LED, so the blink rate follows.
- The [function](nodes/function.md) node's **code**, which keeps the count's parity with `% 2`.

### `two-more-blinks.flow.json`

The same blink with the state kept elsewhere. This file reads the LED's pin back with `machine.Pin` to decide the
next level. Walked by [Two more blinks](tutorials/two-more-blinks.md), which also swaps in the `context` version.

- The pin number, in two places: the [gpio out](nodes/gpio-out.md) node's **pin** and the function's
  `machine.Pin(15)`. They have to agree.
- The [function](nodes/function.md) node's **code**: replace it with the `context` version from the tutorial.

### `http-blink.flow.json`

The same LED, toggled from a browser. An `http in` node serves `/toggle` on port 9999, a `function` flips the LED
and builds the reply, and `http response` answers the browser. `wifi status` and `debug` show the connection. It
needs a WiFi network of yours. Walked by [Web Blink](tutorials/blink-from-your-network.md).

- **path** and **port** on [http in](nodes/http-in.md).
- The reply text in the function's **code** (`'LED on'` and `'LED off'`).
- **poll interval (ms)** on [wifi status](nodes/wifi-status.md).

### `blink-from-anywhere.flow.json`

The same LED through an MQTT broker. Clicking `inject` publishes `pressed` to a `button` topic, and `mqtt subscribe`
on an `led` topic feeds a `function` that turns `on`, `1` or `true` into true for `gpio out`; `debug` prints what
arrives. It needs a WiFi network and a broker of yours. Its topics start
`thingstudio/change-this-number/`: replace that number in both before you deploy, because the broker is public. Walked
by [Blink from anywhere](tutorials/blink-from-anywhere.md).

- The number in both **topic** fields, on [mqtt publish](nodes/mqtt-publish.md) and
  [mqtt subscribe](nodes/mqtt-subscribe.md).
- **host** and **port** in the broker form, to use a broker on your own network.
- The [function](nodes/function.md) node's **code**, which decides which messages count as on.

The repository's `test-flows/` folder holds more flows, written for trying one node at a time on a board. They aren't
installed.

## Flows written by an AI assistant

An assistant can write a flow file for you to open the same way. See [Writing flows with an AI assistant](ai-authoring.md).
