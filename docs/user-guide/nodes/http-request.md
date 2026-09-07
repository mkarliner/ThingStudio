# http request

Makes one HTTP request per incoming message and returns the response.

## Properties

- **url** — `http://host[:port]/path`. **HTTPS isn't supported.**
- **method** — `GET` or `POST`. No other methods are supported.
- **timeout (ms)** — how long to wait for the whole request/response exchange. Default 5000ms.

## Behavior

For a `POST`, the incoming message's payload becomes the request body (a string is UTF-8 encoded; other types are converted). The response comes back as the message's payload (the decoded body, as a string) and a `status` field (the HTTP status code).

A few real limitations worth knowing: no HTTPS/TLS, no chunked transfer-encoding (the server needs to send `Content-Length`), no redirect following, and the response body must be valid UTF-8 — anything else raises rather than silently mangling it. Uses the flow's `wifi_status` node for its WiFi connection, same as every other network node.
