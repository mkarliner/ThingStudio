# http response

Sends the reply to a request that arrived through an [http in](http-in.md) node.

## Properties

None. The reply comes from the message.

## Wiring

**Input** — a message that started at an http in node:

| Field | Value |
| --- | --- |
| `payload` | the reply body. A string is sent as UTF-8, bytes as they are, and `None` as an empty body. Anything else is converted to text. |
| `statusCode` | the HTTP status, a whole number. Default 200. |

This node has no output.

## Behavior

The reply has no `Content-Type` header. A client that needs to know the body is JSON has to assume it.

Send one reply per request. Once a reply has gone, another for the same request does nothing. A reply that arrives
after the [response timeout](http-in.md#properties) is too late: the client has already received a 500.

## Errors

- **The message didn't come from an http in node.** The console shows
  `http_response: msg did not come from an http_in node (no request to respond to)`. The same happens when a node
  between the two built a new message and dropped the link. Change the message you received and pass it on.
- **`statusCode` isn't a whole number.** The node raises an error and the client gets the 500 after the timeout.
