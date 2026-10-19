// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/http-request.ts
//
// http_request as a core package (2026-10-19). The hook parses/validates the URL, method and timeout and derives
// WiFi; the Python is the built-in's bounded async client, unchanged in behaviour: connect, write, read headers,
// read the body (Content-Length or until close), decode to a string, put the status in msg.status.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/http_request",
  kind: "transform",
  paletteId: "http_request",
  label: "http request",
  group: "network",
  priority: 41,
  color: "#8a6e1f",
  bgcolor: "#4a3a1f",
  icon: "⇄",
  width: 130,
  description: "http:// only -- no TLS/HTTPS in v1. One WiFi network per flow: every WiFi node shares this setting.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "url", label: "url", kind: "text", default: "", placeholder: "http://host:port/path" },
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
    { name: "timeoutMs", label: "timeout (ms)", kind: "number", default: 5000, min: 1 },
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
  ],
};

export const compileHook = `${WIFI_DERIVATION}
import re

def compile(ctx, properties):
    url = str(properties.get('url') or '')
    match = re.match(r'^http://([^/:]+)(?::([0-9]+))?(/.*)?$', url)
    if not match:
        return {'errors': ['http_request url "' + url + '" must be a plain http://host[:port][/path] URL -- https/TLS is not supported in v1']}
    host = match.group(1)
    port = int(match.group(2)) if match.group(2) else 80
    path = match.group(3) if match.group(3) else '/'

    method = str(properties.get('method', 'GET')).upper()
    if method not in ('GET', 'POST'):
        return {'errors': ['http_request method "' + str(properties.get('method')) + '" must be "GET" or "POST" -- v1 supports no other methods']}
    try:
        timeout = int(properties.get('timeoutMs', 5000))
    except (TypeError, ValueError):
        return {'errors': ['http_request timeoutMs must be a positive number']}
    if timeout <= 0:
        return {'errors': ['http_request timeoutMs must be a positive number']}

    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}
    wifi['host'] = host
    wifi['port'] = port
    wifi['path'] = path
    wifi['method'] = method
    wifi['timeoutS'] = timeout / 1000
    return {'properties': wifi}
`;

export const python = `import ts_wifi

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])

_host = properties['host']
_port = int(properties['port'])
_path = properties['path']
_method = properties['method']
_timeout = float(properties['timeoutS'])


async def run(msg, properties):
    try:
        _reader, _writer = await asyncio.wait_for(asyncio.open_connection(_host, _port), _timeout)
    except OSError as _e:
        raise OSError("http_request to %s:%s: connect failed: %r" % (_host, _port, _e))
    try:
        _payload = msg.get('payload')
        if _method == 'POST':
            if isinstance(_payload, (bytes, bytearray)):
                _body = bytes(_payload)
            elif isinstance(_payload, str):
                _body = _payload.encode()
            else:
                _body = str(_payload).encode()
        else:
            _body = b''
        _req = (_method + ' ' + _path + ' HTTP/1.1\\r\\nHost: ' + _host + '\\r\\nConnection: close\\r\\nContent-Length: ' + str(len(_body)) + '\\r\\n\\r\\n').encode()
        _writer.write(_req)
        if _body:
            _writer.write(_body)
        await asyncio.wait_for(_writer.drain(), _timeout)
        _status_line = await asyncio.wait_for(_reader.readline(), _timeout)
        _status_parts = _status_line.split(b' ')
        _status = int(_status_parts[1]) if len(_status_parts) > 1 else 0
        _content_length = None
        while True:
            _hline = await asyncio.wait_for(_reader.readline(), _timeout)
            if _hline in (b'\\r\\n', b'\\n', b''):
                break
            if _hline.lower().startswith(b'content-length:'):
                _content_length = int(_hline.split(b':', 1)[1].strip())
        if _content_length is not None:
            _resp_body = await asyncio.wait_for(_reader.readexactly(_content_length), _timeout)
        else:
            _resp_body = b''
            while True:
                _chunk = await asyncio.wait_for(_reader.read(512), _timeout)
                if not _chunk:
                    break
                _resp_body += _chunk
        msg['payload'] = _resp_body.decode()
        msg['status'] = _status
    except OSError as _e:
        raise OSError("http_request to %s:%s: request failed: %r" % (_host, _port, _e))
    finally:
        _writer.close()
    return msg
`;
