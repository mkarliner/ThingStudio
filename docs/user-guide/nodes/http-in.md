# http in

Starts (or joins) a small HTTP server on the device and fires a message for each matching incoming request.

## Properties

- **port** — the TCP port to listen on (1–65535).
- **path** — the exact path to match, e.g. `/status`. **No named parameters yet** (no `/user/:id` — see "Not yet supported" below).
- **method** — `GET` or `POST`. No other methods are supported.
- **response timeout (ms)** — how long to wait for a paired `http_response` node to actually reply before the request times out with a 500. Default 10000ms.

## Behavior

Any number of `http_in` nodes can share one `port` — each one claims its own exact `(method, path)` pair, and the device runs one shared server per port, routing each incoming request to whichever `http_in` node matches. Two `http_in` nodes claiming the same `(method, path)` on the same port is a compile error.

Fires once per matching request. The message carries `req.method` and `req.path`; **`payload` is always `None`** — v1 doesn't parse the request body (see "Not yet supported" below). Pair every `http_in` with a downstream [`http_response`](http-response.md) node to actually answer the request — a request whose flow never reaches one gets a 500 automatically once the response timeout above elapses, rather than hanging the client forever.

A second request to the *same* route while an earlier one is still being processed queues behind it (this node processes one request at a time). Requests to *different* routes — even on the same port — are handled concurrently.

Uses the flow's `wifi_status` node for its WiFi connection, same as every other network node — the device needs a station interface up to have anything to listen on.

## Not yet supported

Two real gaps, not oversights — both tracked as follow-up work:

- **No named path parameters.** Node-RED's `/user/:name` style, with the captured value showing up on `msg.req.params`, isn't implemented yet — `path` matches one exact string.
- **No request body parsing.** `msg.payload` never reflects a `POST`/`PUT` body in v1 — a request's body is read off the wire (so it doesn't corrupt the next request on the same connection) but discarded.

No explicit cap on how many requests can be in flight at once, either — this relies on the device's own memory/socket limits, fine for a handful of well-behaved clients, not something to expose to untrusted traffic.
