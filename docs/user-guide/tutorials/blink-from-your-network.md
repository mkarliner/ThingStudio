# Blink from your network

The same LED, driven from a browser: an `http in` node runs a web server on the board, and each request toggles
it. Along the way: telling the board which WiFi network to join, finding it from your computer, and what an open
port on it means.

It builds on [Two more blinks](two-more-blinks.md). If you're starting cold, download
[http-blink.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/examples/http-blink.flow.json)
and open it with **File → Open…** — it carries the whole tutorial's flow: the blink from that tutorial, the web
chain, and a wifi status node so the connection is visible.

If a step misbehaves on the way, start at [Debugging & troubleshooting](../debugging.md).

## First: the board joins WiFi

The board joins the network named in the flow — so first, tell the flow which network. Flow files hold no
passwords or other secrets: the WiFi details live in the `.thingstudio` folder in your home directory
(`~/.thingstudio/credentials/`), as **credentials**. Each credential is named, and you can keep
several — one per network — and pick the right one per flow. See
[The Thingstudio folder](../thingstudio-folder.md#credentials).

1. Connect the board over USB, as in [Connect your board](../connecting.md).
2. On the `http in` node's property panel, click **+** next to the **WiFi** field to make a new credential (✎
   edits an existing one). Give the credential a name, your network's SSID and its password, and save.
3. The **WiFi** field on the `http in` node (and on the `wifi status` node) picks that credential — one WiFi
   network per flow, shared by every WiFi node in it.

Compile stops with a one-line error if the flow's WiFi has no saved network behind it; the FAQ's
[needs-a-WiFi-network](../faq.md#why-does-compile-fail-with-needs-a-wifi-network) entry is that error.

## Name the board, then deploy

1. With the board still on USB, choose **Tools → Board settings…** and give the board a network name, say
   `blink`. A name is how your computer finds it later without an IP address.
2. Click **Compile → Deploy**. The board swaps in the flow and joins your WiFi.

A few seconds after the deploy, `wifi status`'s console line prints `true`, and its dot on the canvas shows
connected (see [node status](../working-in-the-editor.md#node-status) when the dot is something else).

## Find the board

- **By name:** open `http://blink.local:9999/toggle` in your browser. The name is the one from Board settings,
  plus `.local`; port 9999 and path `/toggle` are the `http in` node's **port** and **path**.
- **By IP:** tick **full message** on the `debug` node and read the `ip` from its next console line — the fields
  are listed under [wifi status](../nodes/wifi-status.md#behavior). Then `http://<that ip>:9999/toggle`.

If `.local` names don't resolve on your network (they don't everywhere), the IP address is the dependable one.

The page answers `LED on` or `LED off`, and the LED changes. The timer keeps its half-second blink from
[Two more blinks](two-more-blinks.md)! So the network is one more thing that flips the LED; each event
arrives and is handled on its own, and the `context` toggle from the last tutorial does the remembering.

## The two chains

One flow, two chains into one pin:

```python
on = not context.get('on', False)
context.set('on', on)
msg['payload'] = on
reply = dict(msg)
reply['payload'] = 'LED ' + ('on' if on else 'off')
return [msg, reply]
```

The `http in → function → gpio out` chain is the timer chain plus a reply: the web chain's function has two
outputs, and the second one carries `reply` to an [`http response`](../nodes/http-response.md) node, so the
browser gets an answer. `return [msg, reply]` is the [function node's](../nodes/function.md) output-1/output-2
routing, Node-RED style.

## One line on the open port

`http in` runs an unauthenticated server on the board: whatever reaches that network can call every path. Keep
those routes non-sensitive, or keep the board off shared networks. See [http in](../nodes/http-in.md#limitations)
for what the server does and does not do.

## Next, pick:

- [Tutorials](index.md) — what comes after the network: publish and subscribe over MQTT is next to be written.
- [http in](../nodes/http-in.md) — routes, methods, timeouts, and the server's limits.
- [Connecting over WiFi](../wifi-connection.md) — the board as an editor peer on your network, not just a web
  server.
