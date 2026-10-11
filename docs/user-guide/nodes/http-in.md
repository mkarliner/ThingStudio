# http in

Starts (or joins) an HTTP server on the device and fires a message for each matching incoming request.

## Properties

- **port** — the TCP port to listen on (1–65535).
- **path** — the exact path to match, e.g. `/status`. No named parameters: `path` matches one exact string (no `/user/:id`).
- **method** — `GET` or `POST`. No other methods are supported.
- **response timeout (ms)** — how long to wait for a paired `http response` node to actually reply before the request times out with a 500. Default 10000ms.

## Behavior

Any number of `http in` nodes can share one `port` — each one claims its own exact `(method, path)` pair, and the device runs one shared server per port, routing each incoming request to whichever `http in` node matches. Two `http in` nodes claiming the same `(method, path)` on the same port is a compile error.

Fires once per matching request. The message carries `req.method` and `req.path`; **`payload` is always `None`** — the request body isn't parsed (see "Limitations" below). Pair every `http in` with a downstream [`http response`](http-response.md) node to actually answer the request — a request whose flow never reaches one gets a 500 automatically once the response timeout above elapses, rather than hanging the client forever.

A second request to the *same* route while an earlier one is still being processed queues behind it (this node processes one request at a time). Requests to *different* routes — even on the same port — are handled concurrently.

Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi node).

## Limitations

- **No named path parameters.** `path` matches one exact string, not Node-RED's `/user/:name` style.
- **No request body parsing.** `payload` is always `None`; a `POST`/`PUT` body is read off the wire so it doesn't
  corrupt the next request, then discarded.
- **No cap on requests in flight.** The device's own memory and socket limits apply, so this suits a handful of
  well-behaved clients rather than untrusted traffic.
