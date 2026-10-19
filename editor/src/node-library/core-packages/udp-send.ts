// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/udp-send.ts
//
// udp_send as a core package (2026-10-19). The hook derives the flow's WiFi config and validates host/port/timeout
// at compile time; the Python sends with the same bounded, non-blocking retry loop the built-in used, over a
// shared socket (runtime.shared keyed by a fixed name), with ts_wifi for the link.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/udp_send",
  kind: "sink",
  paletteId: "udp_send",
  label: "udp send",
  group: "network",
  priority: 21,
  color: "#3b5c8a",
  bgcolor: "#1f2e4a",
  icon: "↑",
  width: 110,
  description: "One WiFi network per flow: every WiFi node shares this setting.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "host", label: "host", kind: "text", default: "" },
    { name: "port", label: "port", kind: "number", default: 9999, min: 1, max: 65535 },
    { name: "timeoutMs", label: "timeout (ms)", kind: "number", default: 2000, min: 1 },
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
  ],
};

export const compileHook = `${WIFI_DERIVATION}
def compile(ctx, properties):
    host = str(properties.get('host') or '').strip()
    if not host:
        return {'errors': ['udp_send requires a non-empty "host"']}
    try:
        port = int(properties.get('port'))
    except (TypeError, ValueError):
        return {'errors': ['udp_send port must be a valid port number (1-65535)']}
    if port <= 0 or port > 65535:
        return {'errors': ['udp_send port must be a valid port number (1-65535)']}
    try:
        timeout = int(properties.get('timeoutMs', 2000))
    except (TypeError, ValueError):
        return {'errors': ['udp_send timeoutMs must be a positive number']}
    if timeout <= 0:
        return {'errors': ['udp_send timeoutMs must be a positive number']}

    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}
    return {'properties': wifi}
`;

export const python = `import socket
import errno
import ts_wifi


def _make_sock():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setblocking(False)
    return s


_sock = runtime.shared('udp_send_sock', 'udp_send', (), _make_sock)
runtime.register_cleanup('udp-send-sock', lambda: _sock.close())

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])

_host = str(properties['host']).strip()
_port = int(properties['port'])
_timeout = int(properties.get('timeoutMs', 2000)) / 1000
_SEND_RETRY_MS = 10


async def run(msg, properties):
    _payload = msg.get('payload')
    if isinstance(_payload, (bytes, bytearray)):
        _body = bytes(_payload)
    elif isinstance(_payload, str):
        _body = _payload.encode()
    else:
        _body = str(_payload).encode()

    try:
        _target = socket.getaddrinfo(_host, _port)[0][-1]
    except OSError as _e:
        raise OSError("udp_send: could not resolve %s:%s: %r" % (_host, _port, _e))

    async def _send():
        while True:
            try:
                _sock.sendto(_body, _target)
                return
            except OSError as _e:
                if _e.errno != errno.EAGAIN:
                    raise OSError("udp_send to %s:%s failed: %r" % (_host, _port, _e))
                await asyncio.sleep_ms(_SEND_RETRY_MS)

    await asyncio.wait_for(_send(), _timeout)
`;
