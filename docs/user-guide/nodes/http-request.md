# http request

Makes one HTTP request per incoming message and returns the response.

## Properties

- **url** — `http://host[:port]/path`. **HTTPS isn't supported.**
- **method** — `GET` or `POST`. No other methods are supported.
- **timeout (ms)** — how long to wait for the whole request/response exchange. Default 5000ms.

## Behavior

For a `POST`, the incoming message's payload becomes the request body (a string is UTF-8 encoded; other types are converted). The first request goes out when the first message arrives, so a timer's first tick (one full interval after start) is the first request. The response comes back as the message's payload (the decoded body, as a string) and a `status` field (the HTTP status code).

**When it goes wrong.** A response with any status (404, 500, ...) is still sent on, with `status` set to that number (an integer), so test `msg['status'] == 200` yourself. If the connection fails, the request times out or the reply can't be read, nothing is sent on: the node raises an error that shows in the debug log, and the next message tries again. To act on a failure, add a [timer](timer.md)-driven check or watch the log; there is no failure output.

A few real limitations worth knowing: no HTTPS/TLS, no chunked transfer-encoding (the server needs to send `Content-Length`), no redirect following, and the response body must be valid UTF-8 — anything else raises rather than silently mangling it. Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi node).
