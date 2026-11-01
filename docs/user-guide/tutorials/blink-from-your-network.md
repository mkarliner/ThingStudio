# Blink from your network

The same LED, driven from a browser: an `http in` node runs a web server on the board, and each request toggles the
LED. The tutorial covers telling the board which WiFi network to join, finding it from your computer, and what an
open port on it means.

It builds on [Two more blinks](two-more-blinks.md) and starts from the flow that tutorial ends with: timer, function,
gpio out. To start from the finished flow instead, open
[http-blink.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/examples/http-blink.flow.json), in the
[examples folder](../installation-details.md#example-flows), with **File → Open…**. Open the file; don't copy it
from this page. It names a WiFi network, `tutorial wifi`, that your computer doesn't have: the **WiFi** field's ✎
form says so, and saving it with your network's details creates it.

If a step misbehaves on the way, start at [Debugging & troubleshooting](../debugging.md).

## Build the flow

On the network the request is the event, so the timer goes and the LED holds the level you last asked for.

1. Delete the **timer**.
2. Drag an **http in** onto the canvas. Set **port** to `9999` and **path** to `/toggle`. Leave **method** as `GET`.
3. Select the **function**. Set **outputs** to `2` and replace its **code** with:

    ```python
    on = not context.get('on', False)
    context.set('on', on)
    msg['payload'] = on
    reply = dict(msg)
    reply['payload'] = 'LED ' + ('on' if on else 'off')
    return [msg, reply]
    ```

4. Drag an **http response** onto the canvas.
5. Wire **http in** → **function**. Wire the function's first output to **gpio out** and its second output to
   **http response**.
6. Drag a **wifi status** and a **debug** onto the canvas. Tick **full message** on the **debug** node and wire
   **wifi status** → **debug**.
7. On the **http in** node, click **+** next to **WiFi**. The form asks for a name, the SSID and the password, and
   saves them on this computer, not in the flow ([The Thingstudio folder](../thingstudio-folder.md#credentials)).
   A flow has one WiFi network, so the **WiFi** field on **wifi status** shows the same one.

If compile stops with "needs a WiFi network", a **WiFi** field is empty. See
[Why does compile fail with "needs a WiFi network"?](../faq.md#why-does-compile-fail-with-needs-a-wifi-network).

## Name the board, then deploy

1. Connect the board over USB, as in [Connect your board](../connecting.md), and choose **Tools → Board settings…**.
   Give the board a network name, such as `blink`. A name lets your computer find the board without an IP address.
2. Click **Compile → Deploy**. The board swaps in the flow and joins your WiFi.

A few seconds after the deploy, the console prints the **wifi status** message, with a `payload` of `true`, and the
node's dot shows connected (see [node status](../working-in-the-editor.md#node-status) when the dot is something else). The LED is dark:
nothing drives the pin until a request does.

## Find the board

- **By name:** open `http://blink.local:9999/toggle` in your browser. The name is the one from Board settings plus
  `.local`; port 9999 and path `/toggle` are the **port** and **path** of the `http in` node.
- **By IP:** the `debug` node prints the whole **wifi status** message, which includes `ip`. The fields are listed
  under [wifi status](../nodes/wifi-status.md#behavior). Open `http://<ip>:9999/toggle`.

`.local` names don't resolve on every network, and never across a VPN. The IP address always works.

Each request flips the LED, and the page answers `LED on` or `LED off`. The first answer after an idle stretch is
slower, because the board's WiFi wakes on the request (see
[Why do http in requests take a second to answer?](../faq.md#why-do-http-in-requests-take-a-second-to-answer)).

## How it works

Each request is handled on its own. Between requests the LED holds its level, which the function keeps in
`context`.

The function has two outputs. The first carries the new state to **gpio out**. The second carries `reply` to
[http response](../nodes/http-response.md), which answers the browser. `return [msg, reply]` routes one message to
each output, as in Node-RED; see the [function node](../nodes/function.md).

## The server is open

`http in` runs an unauthenticated server on the board: whatever reaches that network can call every path. Keep those
routes non-sensitive, or keep the board off shared networks. See [http in](../nodes/http-in.md) for what the server
does and doesn't do.

## Next

- [http in](../nodes/http-in.md) — routes, methods, timeouts and the server's limits.
- [mqtt publish](../nodes/mqtt-publish.md) and [mqtt subscribe](../nodes/mqtt-subscribe.md) — the same LED over a
  broker. `examples/basic-mqtt.flow.json`, in the [examples folder](../installation-details.md#example-flows), is a
  starting flow.
- [Connecting over WiFi](../wifi-connection.md) — the board as an editor peer on your network, not just a web
  server.
