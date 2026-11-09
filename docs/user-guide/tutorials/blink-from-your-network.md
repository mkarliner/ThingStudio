# Web Blink

If you've worked through [Two more blinks](two-more-blinks.md), you have a board whose LED blinks on a timer. Here the
timer goes, and a web browser does the switching. You'll put the board on your WiFi network, find it from your
computer, and see what it means for a board to have an open port.

The blink flow was a **timer** → **function** → **gpio out**. The **timer** gives way to an **http in** node, which
runs a web server on the board, and the **function** gains a second output for the reply that goes back to the
browser.

You can build the flow step by step, or start from the finished flow,
[http-blink.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/tutorials/http-blink.flow.json), in the
[tutorials folder](../tutorial-flows.md#where-the-folder-is), with **File → Open…**.
[Tutorial flows](../tutorial-flows.md#before-you-deploy) says what to change before you deploy.

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

## The board joins WiFi

The board joins the network named in the flow — so tell the flow which network. Flow files hold no
passwords or other secrets: the WiFi details live in the `.thingstudio` folder in your home directory
(`~/.thingstudio/credentials/`), as **credentials**. Each credential is named, and you can keep
several — one per network — and pick the right one per flow. See
[The ThingStudio folder](../thingstudio-folder.md#credentials).

1. On the `http in` node's property panel, click **+** next to the **WiFi** field to make a new credential (✎
   edits an existing one). Give the credential a name, your network's SSID and its password, and save.
2. The **WiFi** field on the `http in` node (and on the `wifi status` node) picks that credential — one WiFi
   network per flow, shared by every WiFi node in it.

Compile stops with a one-line error if the flow's WiFi has no saved network behind it; the FAQ's
[needs-a-WiFi-network](../faq.md#why-does-compile-fail-with-needs-a-wifi-network) entry is that error.

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
- **By IP:** the `debug` node prints the whole **wifi status** message, which includes `ip`. (In the example file,
  tick **full message** on the `debug` node first; it prints only the payload otherwise.) The fields are listed
  under [wifi status](../nodes/wifi-status.md#wiring). Open `http://<ip>:9999/toggle`.

If `.local` names don't resolve on your network (they don't everywhere, and they don't across VPN tunnels at all —
multicast doesn't pass), the IP address is the dependable one.

The page answers `LED on` or `LED off`, and the LED does what it says. Expect the first answer after an idle stretch
to take up to a second: the board's WiFi wakes on the request (see
[Why do http in requests take a second to answer?](../faq.md#why-do-http-in-requests-take-a-second-to-answer)).

## How it works

The request is the only event this flow gets, and each one is handled on its own: between requests the LED holds its
level, remembered in the `context` toggle from the last tutorial.

The function has two outputs. The first carries the new state to **gpio out**. The second carries `reply` to
[http response](../nodes/http-response.md), which answers the browser. `return [msg, reply]` routes one message to
each output, as in Node-RED; see the [function node](../nodes/function.md).

## The server is open

`http in` runs an unauthenticated server on the board: whatever reaches that network can call every path. Keep those
routes non-sensitive, or keep the board off shared networks. See [http in](../nodes/http-in.md) for what the server
does and doesn't do.

## Next

- [http in](../nodes/http-in.md) — routes, methods, timeouts and the server's limits.
- [Blink from anywhere](blink-from-anywhere.md) — the next tutorial: the same LED through an MQTT broker.
- [mqtt publish](../nodes/mqtt-publish.md) and [mqtt subscribe](../nodes/mqtt-subscribe.md) — the nodes behind it.
- [Connecting over WiFi](../wifi-connection.md) — the board as an editor peer on your network, not just a web
  server.
