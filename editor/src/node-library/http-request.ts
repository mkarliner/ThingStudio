// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/http-request.ts
//
// Tier 1 network batch (mvp-feature-priorities.md item 4). A transform
// node: triggered by an inbound msg, makes one HTTP request, returns a
// msg carrying the response. Hand-rolled minimal HTTP/1.1 client over
// `asyncio.open_connection` rather than a vendored library (contrast with
// mqtt-publish.ts/mqtt-subscribe.ts, which vendor mqtt_as) -- a plain
// GET/POST-over-a-socket client is genuinely small, unlike MQTT's
// reconnect/keepalive/QoS state machine, so CLAUDE.md's "prefer fewer
// dependencies... a small native implementation over pulling in a small
// utility package" points the other way here. See
// device-runtime/src/vendor/mqtt_as/README.md for the contrasting case.
//
// Real, honest v1 limitations, not silently glossed over:
//   - http:// only -- no TLS/HTTPS. Adding it later is a real lift (ssl
//     wrap_socket support varies by MicroPython port), not a small patch.
//   - No chunked transfer-encoding support -- only Content-Length or
//     read-until-close bodies. Most simple APIs and the validation plan's
//     own "local, controllable HTTP test server" bar don't need chunked.
//     Confirmed a real gap, not just a hypothetical one, while writing
//     node-http-request.test.ts: Node's own http module defaults to
//     chunked whenever a handler doesn't set Content-Length itself, so
//     even a "plain" local Node test server needed an explicit
//     Content-Length header to be usable against this client -- worth
//     remembering when standing up any other local test server against
//     this node later, not just a one-off test-authoring footnote.
//   - No redirect following.
//   - Response body decoded with plain `.decode()` (UTF-8, MicroPython's
//     only universally-supported encoding) -- a non-UTF-8 response raises
//     rather than silently mangling bytes; deliberately not
//     `.decode('utf-8', 'replace')`, since MicroPython's `bytes.decode()`
//     doesn't reliably support the `errors` argument across ports.
//   - Uses `await asyncio.open_connection(...)`/real non-blocking streams
//     (not a blocking socket), per compile.ts's async transform/sink
//     change -- everything here is `await`-bounded by `timeoutMs` via
//     `asyncio.wait_for`, so a slow/hung server can't stall the rest of
//     the flow's event loop indefinitely, just for up to that bound.
//
// Shares the flow's "wifi-sta" setup statement (wifi-status.ts) so an
// http_request node works even with no wifi_status node in the same flow
// -- whichever network node compiles first brings the station interface
// up under the shared dedup key.
//
// **Still NOT migrated to config nodes** (outstanding-items.md's "Network
// / config nodes" section; explicitly out of scope for
// redeploy-cleanup-and-network-fault-detection-briefing.md's Problem 2b)
// -- this node keeps reading raw `ssid`/`password` off its own
// `properties` directly, not `resolveWifiCredentials()`/`wifiConfigId`.
// Passes `wifiSetupStatement()` a fixed `"open"` `security` below
// specifically to preserve this node's pre-existing behavior unchanged
// now that `wifiSetupStatement()` validates password-required for
// `"password"`-security callers -- `"open"` skips that check regardless
// of whether `password` is actually empty, matching what this node
// always did before that check existed (connect with whatever password is
// set, empty or not, no validation). Not a claim that this node's network
// is actually open; a deliberate compatibility shim until this node gets
// the same config-node treatment udp-send.ts/udp-receive.ts/wifi-status.ts
// already have.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { wifiSetupStatement } from "./wifi-status.js";

interface ParsedUrl {
  host: string;
  port: number;
  path: string;
}

function parseHttpUrl(rawUrl: unknown): ParsedUrl {
  const url = String(rawUrl ?? "");
  const m = /^http:\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) {
    throw new CompileError(
      `http_request url "${url}" must be a plain http://host[:port][/path] URL -- https/TLS isn't supported in v1`,
    );
  }
  const host = m[1]!;
  const port = m[2] ? Number.parseInt(m[2], 10) : 80;
  const path = m[3] && m[3].length > 0 ? m[3] : "/";
  return { host, port, path };
}

export const httpRequestNode: NodeDefinition = {
  type: "thingstudio/http_request",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const { host, port, path } = parseHttpUrl(node.properties.url);

    const method = String(node.properties.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      throw new CompileError(`http_request method "${String(node.properties.method)}" must be "GET" or "POST" -- v1 supports no other methods`);
    }

    const timeoutMs = Math.round(Number(node.properties.timeoutMs ?? 5000));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new CompileError(`http_request timeoutMs "${String(node.properties.timeoutMs)}" must be a positive number`);
    }
    const timeoutS = timeoutMs / 1000;

    const hostLit = JSON.stringify(host);
    const pathLit = JSON.stringify(path);
    const methodLit = JSON.stringify(method);

    const functionBody = `
_reader, _writer = await asyncio.wait_for(asyncio.open_connection(${hostLit}, ${port}), ${timeoutS})
try:
    _payload = msg.get('payload')
    if ${methodLit} == 'POST':
        if isinstance(_payload, (bytes, bytearray)):
            _body = bytes(_payload)
        elif isinstance(_payload, str):
            _body = _payload.encode()
        else:
            _body = str(_payload).encode()
    else:
        _body = b''
    _req = (${methodLit} + ' ' + ${pathLit} + ' HTTP/1.1\\r\\nHost: ' + ${hostLit} + '\\r\\nConnection: close\\r\\nContent-Length: ' + str(len(_body)) + '\\r\\n\\r\\n').encode()
    _writer.write(_req)
    if _body:
        _writer.write(_body)
    await asyncio.wait_for(_writer.drain(), ${timeoutS})
    _status_line = await asyncio.wait_for(_reader.readline(), ${timeoutS})
    _status_parts = _status_line.split(b' ')
    _status = int(_status_parts[1]) if len(_status_parts) > 1 else 0
    _content_length = None
    while True:
        _hline = await asyncio.wait_for(_reader.readline(), ${timeoutS})
        if _hline in (b'\\r\\n', b'\\n', b''):
            break
        if _hline.lower().startswith(b'content-length:'):
            _content_length = int(_hline.split(b':', 1)[1].strip())
    if _content_length is not None:
        _resp_body = await asyncio.wait_for(_reader.readexactly(_content_length), ${timeoutS})
    else:
        _resp_body = b''
        while True:
            _chunk = await asyncio.wait_for(_reader.read(512), ${timeoutS})
            if not _chunk:
                break
            _resp_body += _chunk
    msg['payload'] = _resp_body.decode()
    msg['status'] = _status
finally:
    _writer.close()
return msg`.trim();

    return {
      imports: ["import network"],
      statements: [wifiSetupStatement(node.properties.ssid, node.properties.password, "open")],
      functionName: ctx.uniqueName("http_request"),
      functionBody,
    };
  },
};
