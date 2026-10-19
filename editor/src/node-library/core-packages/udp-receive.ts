// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/udp-receive.ts
//
// udp_receive as a core package (2026-10-19). The hook validates port/pollMs and derives WiFi; the Python binds a
// non-blocking socket shared per port through runtime.shared and returns one msg per datagram, with the built-in's
// EAGAIN retry loop and port-qualified errors. The loop yield stays the fixed 10 ms; pollMs is the internal retry.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/udp_receive",
  kind: "source",
  paletteId: "udp_receive",
  label: "udp receive",
  group: "network",
  priority: 20,
  color: "#3b8a6e",
  bgcolor: "#1f4a3a",
  icon: "↓",
  width: 110,
  description: "One WiFi network per flow: every WiFi node shares this setting.",
  ports: {
    outputs: [{ name: "msg", type: "bytes" }],
  },
  properties: [
    { name: "port", label: "port", kind: "number", default: 9998, min: 1, max: 65535 },
    { name: "pollMs", label: "poll interval (ms)", kind: "number", default: 20, min: 1 },
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
  ],
};

export const compileHook = `${WIFI_DERIVATION}
def compile(ctx, properties):
    try:
        port = int(properties.get('port'))
    except (TypeError, ValueError):
        return {'errors': ['udp_receive port must be a valid port number (1-65535)']}
    if port <= 0 or port > 65535:
        return {'errors': ['udp_receive port must be a valid port number (1-65535)']}
    try:
        poll = int(properties.get('pollMs', 20))
    except (TypeError, ValueError):
        return {'errors': ['udp_receive pollMs must be a positive number']}
    if poll <= 0:
        return {'errors': ['udp_receive pollMs must be a positive number']}

    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}
    # The loop yield is the fixed mandatory 10 ms; pollMs is the EAGAIN retry inside emit().
    wifi['intervalMs'] = 10
    return {'properties': wifi}
`;

export const python = `import socket
import errno
import ts_wifi

_port = int(properties['port'])
_poll = int(properties.get('pollMs', 20))


def _make_sock():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setblocking(False)
    s.bind(('0.0.0.0', _port))
    return s


_sock = runtime.shared('udp_receive_sock', _port, ('udp', _port), _make_sock)
runtime.register_cleanup('udp-receive-%d' % _port, lambda: _sock.close())

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])


async def emit(properties):
    while True:
        try:
            _data, _addr = _sock.recvfrom(1472)
            break
        except OSError as _e:
            if _e.errno != errno.EAGAIN:
                raise OSError("udp_receive on port %d failed: %r" % (_port, _e))
            await asyncio.sleep_ms(_poll)
    return {'payload': _data, 'topic': '', 'host': _addr[0], 'port': _addr[1]}
`;
