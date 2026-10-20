// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/http-in.ts
//
// http_in as a core package (2026-10-20). The hook builds and validates the port's whole route table from
// `ctx['nodesOfType']` (every http_in node in the flow), so duplicate (method, path) is still a compile error. The
// Python registers a per-node queue and gets one shared ts_http_server.Server per port through runtime.shared;
// the server routes a request to the matching node's queue and waits for http_response (or the node's timeout).
//
// Same v1 scope as the built-in: exact (method, path), GET/POST, no body parsing, no :params.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/http_in",
  kind: "source",
  eventSource: true,
  paletteId: "http_in",
  label: "http in",
  group: "network",
  priority: 40,
  color: "#a67c1f",
  bgcolor: "#4a3a1f",
  icon: "↙",
  width: 120,
  description:
    "Exact path match only -- no \":name\" path parameters yet. Fires once per matching inbound request; pair with " +
    "an http_response node to actually reply (a request that never reaches one times out with a 500). One WiFi " +
    "network per flow: every WiFi node shares this setting.",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "port", label: "port", kind: "number", default: 8080, min: 1, max: 65535 },
    { name: "path", label: "path", kind: "text", default: "/", placeholder: "/status" },
    {
      name: "method",
      label: "method",
      kind: "select",
      default: "GET",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
      ],
    },
    { name: "responseTimeoutMs", label: "response timeout (ms)", kind: "number", default: 10000, min: 1 },
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${WIFI_DERIVATION}
def _http_route(node):
    props = node.get('properties') or {}
    try:
        port = int(props.get('port'))
    except (TypeError, ValueError):
        return None, 'http_in node %s: port must be a number between 1 and 65535' % node.get('id')
    if port < 1 or port > 65535:
        return None, 'http_in node %s: port must be a number between 1 and 65535' % node.get('id')
    path = str(props.get('path') or '')
    if not path.startswith('/'):
        return None, 'http_in node %s: path "%s" must start with "/"' % (node.get('id'), path)
    method = str(props.get('method') or 'GET').upper()
    if method not in ('GET', 'POST'):
        return None, 'http_in node %s: method "%s" must be "GET" or "POST"' % (node.get('id'), props.get('method'))
    raw_timeout = props.get('responseTimeoutMs')
    if raw_timeout is None:
        raw_timeout = 10000
    try:
        timeout = int(raw_timeout)
    except (TypeError, ValueError):
        timeout = 0
    if timeout <= 0:
        return None, 'http_in node %s: responseTimeoutMs must be a positive number' % node.get('id')
    return {'id': node.get('id'), 'port': port, 'path': path, 'method': method, 'timeoutS': timeout / 1000}, None

def compile(ctx, properties):
    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}

    own, err = _http_route(ctx['node'])
    if err:
        return {'errors': [err]}
    port = own['port']

    siblings = ctx.get('nodesOfType') or [n for n in ctx['flow']['nodes'] if n['type'] == ctx['node']['type']]
    routes = []
    seen = {}
    for sibling in siblings:
        route, err = _http_route(sibling)
        if err:
            return {'errors': [err]}
        if route['port'] != port:
            continue
        key = route['method'] + ' ' + route['path']
        if key in seen:
            return {'errors': ['http_in: nodes %s and %s both claim %s on port %d -- exact (method, path) must be unique per port' % (seen[key], route['id'], key, port)]}
        seen[key] = route['id']
        routes.append(route)
    routes.sort(key=lambda r: r['id'])

    out = dict(wifi)
    out['port'] = port
    out['routes'] = routes
    return {'properties': out}
`;

export const python = `import runtime
import ts_wifi
import ts_http_server

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])

_port = int(properties['port'])
_routes = properties['routes']
_queues = runtime.shared('http_in_queues', _port, 'v1', lambda: {})
_queue = ts_http_server.Queue()
_queues[properties['nodeId']] = _queue
_server = runtime.shared('http_server', _port, 'v1', lambda: ts_http_server.Server(_port, _routes, _queues))


class _In:
    def __init__(self):
        self.msg = None

    async def wait(self):
        await _server.ensure()
        self.msg = await _queue.get()

    def emit(self):
        return self.msg


_in = _In()


async def wait(properties):
    await _in.wait()


async def emit(properties):
    return _in.emit()
`;
