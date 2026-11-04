# http request

Makes one HTTP request per incoming message and returns the response.

## Properties

- **url** — `http://host[:port]/path`. **HTTPS isn't supported.**
- **method** — `GET` or `POST`. No other methods are supported.
- **timeout (ms)** — how long to wait for the whole request and response. Default 5000.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow.

## Wiring

**Input** — any message. For a `POST`, `payload` is the request body: a string is UTF-8 encoded, and other types are
converted.

**Output** — the response:

- `payload` — the decoded body, as a string.
- `status` — the HTTP status code, an integer.

A response with any status (404, 500, …) is sent on. Test `msg['status'] == 200` yourself.

## Behavior

The first request goes out when the first message arrives, so with a [timer](timer.md) it is one full interval after
the flow starts.

The server must send `Content-Length`: chunked transfer-encoding isn't supported. Redirects aren't followed. The body
must be valid UTF-8.

## Errors

If the connection fails, the request times out or the reply can't be read, nothing is sent on. The console shows the
error, and the next message tries again. There is no failure output. To act on a failure, watch the console.

- A body that isn't valid UTF-8 raises an error.
- The whole body is read into memory at once. A response larger than the board's largest free block fails with
  `MemoryError`. Request a smaller response, or use a board with PSRAM.
