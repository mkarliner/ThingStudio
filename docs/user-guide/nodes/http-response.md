# http response

Completes a request that arrived via a matching [`http in`](http-in.md) node.

## Properties

None — everything comes off the message at runtime, same field names Node-RED uses:

- **`msg.statusCode`** — the HTTP status code to send. Defaults to `200` if not set.
- **`msg.payload`** — the response body. A string is UTF-8 encoded; other types are converted; `None` sends an empty body.

## Behavior

Must fire on a message that originated from an `http in` node — firing it on any other message (one built from scratch, or one whose originating request already got its response) raises a clear error rather than failing silently.

The response is sent as plain bytes/text with no `Content-Type` header. Add one on the client side if you need to interpret the body as JSON.
