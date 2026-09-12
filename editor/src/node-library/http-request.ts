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
// **Was NOT migrated to config nodes for a long time** (outstanding-
// items.md's "Network / config nodes" section; explicitly out of scope
// for redeploy-cleanup-and-network-fault-detection-briefing.md's Problem
// 2b) -- this node used to keep reading raw `ssid`/`password` off its own
// `properties` directly, passing `wifiSetupStatement()` a fixed `"open"`
// security as a compatibility shim.
//
// **Migrated, 2026-09-04**, as part of Mike's own real-hardware finding
// (wifi-status.ts's header has the full story): rather than gain its own
// independent `wifiConfigId` property the way udp-send.ts/udp-receive.ts
// once did, this node goes straight to the flow-wide derivation those two
// (and mqtt-shared.ts) were updated to use the same day --
// `resolveFlowWifiCredentials()` (wifi-status.ts), which requires exactly
// one `wifi_status` node in the flow and uses ITS resolved WiFi config.
// No `wifiConfigId`/raw ssid/password property of its own at all, ever --
// this node had no canvas presence to migrate away from (still registry-
// only, outstanding-items.md's "canvas-presence-gaps" -- unaffected by
// this change). The old `"open"` compatibility shim is gone along with
// it: security now comes through as whatever the flow's wifi_status node
// actually has configured (`"password"`/`"open"`/`"unmanaged"`), same as
// every other migrated network node type.
//
// **Given real canvas presence, 2026-09-05** (`ports` below) --
// previously registry-only per outstanding-items/http-request-config-
// node-gap.md and canvas-presence-gaps.md; wired onto the canvas
// following mqtt-publish.ts's own worked example (Rete node class in
// nodes.ts, palette entry in palette.ts, PropertyPanel.vue section). A
// transform kind (both an input and an output port), same shape as
// function.ts, not a source/sink like every other network node type here.
//
// **Loud network errors added, 2026-09-05** (redeploy-cleanup-and-
// network-fault-detection-briefing.md's Problem 2a, same pattern udp-
// send.ts/udp-receive.ts already had): an OSError from either the initial
// `open_connection()` or anywhere in the request/response exchange is now
// re-raised with this operation's own host:port folded into the message,
// before it reaches runtime.py's NodeError/_guarded machinery -- same
// motivation as udp-send.ts's own header on this: a bare `OSError: -202`
// gives no way to tell which node/target actually failed without opening
// generated source.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { flowHasMqttNodes, resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";

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
  // input/output `msg` type `any` -- the inbound payload can be
  // anything (str/bytes/other, POST-body-encoded per the switch in
  // codegenTransform below), and the response body is decoded to a
  // plain string but riding on the same generic `msg` shape every other
  // transform/sink node's `any` port already assumes (function-node.ts,
  // udp-send.ts) -- no narrower static type to declare here either.
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
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
try:
    _reader, _writer = await asyncio.wait_for(asyncio.open_connection(${hostLit}, ${port}), ${timeoutS})
except OSError as _e:
    raise OSError("http_request to %s:%s: connect failed: %r" % (${hostLit}, ${port}, _e))
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
except OSError as _e:
    raise OSError("http_request to %s:%s: request failed: %r" % (${hostLit}, ${port}, _e))
finally:
    _writer.close()
return msg`.trim();

    const { ssid, password, security } = resolveFlowWifiCredentials(ctx, "http_request");

    return {
      imports: ["import network"],
      // deferToMqtt (2026-09-11, decisions/redeploy-network.md): keeps this in sync with
      // wifi-status.ts's OWN wifiSetupStatement() call for the same reason -- compile.ts's
      // mergeSetup dedups the shared "wifi-sta" key by first-writer-wins, so whichever node
      // happens to compile first must make the SAME defer-to-mqtt decision, or an ordering
      // accident could silently undo wifi_status's own deferral.
      statements: [wifiSetupStatement(ssid, password, security, flowHasMqttNodes(ctx))],
      functionName: ctx.uniqueName("http_request"),
      functionBody,
    };
  },
};
