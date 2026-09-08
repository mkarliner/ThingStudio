# http response

Completes a request that arrived via a matching [`http_in`](http-in.md) node.

## Properties

None — everything comes off the message at runtime, same field names Node-RED uses:

- **`msg.statusCode`** — the HTTP status code to send. Defaults to `200` if not set.
- **`msg.payload`** — the response body. A string is UTF-8 encoded; other types are converted; `None` sends an empty body.

## Behavior

Must fire on a message that originated from an `http_in` node — firing it on any other message (one built from scratch, or one whose originating request already got its response) raises a clear error rather than failing silently.

No per-node Content-Type property yet — the response is always sent as plain bytes/text with no `Content-Type` header set. Add one on the client/consuming side if you need to interpret the body as JSON.
