# http in

Starts a web server on the board and sends a message for each request to a path.

## Properties

- **port** — the TCP port to listen on (1–65535). Default 8080.
- **path** — the exact path to match, such as `/status`. It must start with `/`. A pattern such as `/user/:id` isn't
  supported.
- **method** — `GET` or `POST`. Default `GET`.
- **response timeout (ms)** — how long to wait for an [http response](http-response.md) node before the client gets a
  500. Default 10000.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow.

## Wiring

**Output** — one message per matching request:

| Field | Value |
| --- | --- |
| `payload` | `None`. The request body isn't read. |
| `topic` | an empty string |
| `req.method` | `GET` or `POST` |
| `req.path` | the path requested, without any query string |

Every chain that starts here must end at an [http response](http-response.md) node. The message carries a hidden link
to the client's connection, and http response uses it. A node that returns a new message instead of the one it
received, such as a [function](function.md) node, drops the link.

## Behavior

Several http in nodes can share one port. Each claims its own method and path. Two nodes claiming the same method and
path on one port is a compile error.

A request that matches no node gets a 404: that includes a method other than `GET` or `POST`. A query string is
dropped, so `/status?x=1` matches `/status`, and the value isn't available to the flow. Request headers are ignored.

If no http response node replies within the response timeout, the client gets a 500 with the body
`Internal Server Error: no response`. The connection closes after each reply.

The server speaks plain HTTP and has no login. It limits neither the number of requests in flight nor their size, apart
from the board's own memory and sockets. Use it on a network you trust.

## Errors

These stop the compile:

- the port isn't a number from 1 to 65535
- the path doesn't start with `/`
- the response timeout isn't a positive number
- two nodes claim the same method and path on one port. The error names both.

A client that doesn't finish sending its request line and headers within 5 seconds gets a 400.
