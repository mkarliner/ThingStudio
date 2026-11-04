# Blink from anywhere

!!! note "Work in progress"

    This tutorial is still being checked on a board. The example flow compiles, but some steps may not match the editor.

If you've worked through [Web Blink](blink-from-your-network.md), you have a board on your WiFi that switches its LED
when a browser on your network asks. Here an MQTT broker sits in the middle. A broker passes messages between clients,
so your phone or laptop doesn't have to be on the board's network. You'll publish a message from the board, switch the
LED by sending one to it, and see why every topic here carries a number of your own.

This is a new flow, on an empty canvas, with two halves: **inject** → **mqtt publish** sends a message when you click
the button in the editor, and **mqtt subscribe** → **function** → **gpio out** switches the LED when a message
arrives on another topic. The board joins your WiFi with the saved credential from Web Blink.

You can build the flow step by step, or start from the finished flow,
[blink-from-anywhere.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/tutorials/blink-from-anywhere.flow.json),
in the [tutorials folder](../tutorial-flows.md#where-the-folder-is), with **File → Open…**. Before you deploy, replace
`change-this-number` in both topics (see below), and set the WiFi network and broker as
[Tutorial flows](../tutorial-flows.md#before-you-deploy) describes.

If a step misbehaves on the way, start at [Debugging & troubleshooting](../debugging.md).

## Pick a topic prefix

This tutorial uses `test.mosquitto.org`, a public broker. Anyone who knows or guesses a topic can read it and publish
to it, so every topic starts with a number nobody else will pick: a random one of six or seven digits. Here it is
written `4821937`; use your own.

- `thingstudio/4821937/button` is where the board publishes.
- `thingstudio/4821937/led` is where the board listens.

## Build the flow

Start with an empty canvas (**File → New flow**).

1. Drag an **inject** onto the canvas. Set **payload type** to `string` and **value** to `pressed`.
2. Drag an **mqtt publish**. Set **topic** to `thingstudio/4821937/button`. Click **+** next to **MQTT Broker**: the
   form asks for a name, a host, a port and an optional username and password. Name it `test-mosquitto`, set the host to
   `test.mosquitto.org` and the port to `1883`, and leave the rest blank. Wire **inject** → **mqtt publish**.
3. Drag an **mqtt subscribe**. Set **topic** to `thingstudio/4821937/led`. Its **MQTT Broker** field already shows the
   broker from step 2, because a flow has one.
4. Drag a **function** and replace its **code** with:

    ```python
    msg['payload'] = str(msg['payload']).lower() in ('on', '1', 'true')
    return msg
    ```

5. Drag a **gpio out** and set **pin** to your LED's GPIO number. Wire **mqtt subscribe** → **function** → **gpio out**.
6. Drag a **debug** and wire **mqtt subscribe** → **debug**, to see what arrives in the console.
7. On either MQTT node, pick your WiFi credential in the **WiFi** field: the one from
   [Web Blink](blink-from-your-network.md#the-board-joins-wifi), or make one with **+**. A flow has one
   WiFi network, so the other node shows the same one.

## Deploy

With the board connected, click **Compile → Deploy**. When **mqtt subscribe**'s dot turns green, the board is connected
to the broker. **mqtt publish**'s dot stays blank until its first message.

## Board to world

On your computer, subscribe to everything under your prefix:

```sh
mosquitto_sub -h test.mosquitto.org -t 'thingstudio/4821937/#' -v
```

Click the ▶ on the **inject** node. The terminal prints the topic and `pressed`. A phone does the same with any MQTT
client app: connect to `test.mosquitto.org` on port `1883` and subscribe to the same topic.

## World to board

Publish to the LED topic from the same terminal, or from the phone:

```sh
mosquitto_pub -h test.mosquitto.org -t 'thingstudio/4821937/led' -m on
mosquitto_pub -h test.mosquitto.org -t 'thingstudio/4821937/led' -m off
```

The LED follows, and the editor's console shows each message from the **debug** node. The function node is there because
`gpio out` treats any non-empty text as true, so `off` would switch the LED on. It turns `on`, `1` and `true` into true
and every other message into false.

## Nothing arrives?

- Check that the number in the topics matches everywhere, and that the last part is `button` on the publisher and `led`
  on the subscriber.
- A red dot on an MQTT node, or a console line starting `mqtt connect to`, means the board can't reach the broker. See
  [MQTT broker unreachable](../debugging.md#mqtt-broker-unreachable), which also covers networks that block port 1883.
- If compile stops with "needs a WiFi network", a **WiFi** field is empty. See
  [Why does compile fail with "needs a WiFi network"?](../faq.md#why-does-compile-fail-with-needs-a-wifi-network).

## How it works

A topic is a label on a message. **mqtt publish** sends each message that reaches it to its topic, and **mqtt
subscribe** emits each message that arrives on its topic, with the text as `payload` and the topic it came in on as
`topic`. The broker sits between them and between any other clients.

Both nodes use the flow's one broker, which is why the second node showed the first one's settings.

## The broker is public

Anyone who knows your topic can switch your LED, which is why the topic carries a number and why the messages here
carry nothing private. For anything that matters, use a broker on your own network with a password: set its address in
the broker form instead. The nodes work the same way.

## Next

- [mqtt publish](../nodes/mqtt-publish.md) and [mqtt subscribe](../nodes/mqtt-subscribe.md) — every property, including
  QoS and retain.
- [Tutorial flows](../tutorial-flows.md) — the finished flows for the tutorials, and what to change in each.
- [Tutorials](index.md) — the other tutorials.
