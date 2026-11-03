// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-uart-in.ts
//
// ble_uart_in (2026-11-03, BLE phase 2: docs/working-notes/ble-nodes-scoping.md). The receive side of the Nordic UART
// Service, which phone terminal apps speak: one message per line a phone sends (or per write, with lines off). Any
// UART node adds the service to the flow's GATT table (ble-shared.ts).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_CONFIG_FIELD, BLE_GATT_DERIVATION } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_uart_in",
  kind: "source",
  eventSource: true,
  paletteId: "ble_uart_in",
  label: "ble uart in",
  group: "network",
  priority: 64,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 96,
  description:
    "Receives text from a phone over Bluetooth LE, through the Nordic UART Service that terminal apps (nRF Connect, " +
    "Serial Bluetooth Terminal) use. One message per line. The board accepts connections from anyone in range.",
  requires: { capabilities: ["ble"] },
  ports: {
    outputs: [{ name: "msg", type: "string" }],
  },
  properties: [
    { name: "lines", label: "one message per line", kind: "boolean", default: true, help: "Off: one message per write the phone makes, as it arrives." },
    BLE_CONFIG_FIELD,
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${BLE_GATT_DERIVATION}

def compile(ctx, properties):
    name, err = _ble_name(ctx)
    table, errors = _ble_gatt(ctx)
    if err:
        errors.insert(0, err)
    if errors:
        return {'errors': errors}
    return {'properties': {'bleName': name, 'gattTable': table}}
`;

export const python = `import ts_ble

_node_id = properties['nodeId']
_lines = bool(properties['lines'])
_gatt = ts_ble.radio().gatt(properties['gattTable'], properties['bleName'])
_writes = _gatt.on_writes(_node_id, ts_ble.NUS_SERVICE, ts_ble.NUS_RX)
_partial = {}  # conn -> bytes of a line not yet ended
_ready = []  # (bytes, conn) waiting to be sent
_LINE_MAX = 512
_msg = None


def _split(data, conn):
    if not _lines:
        _ready.append((data, conn))
        return
    buf = _partial.get(conn, b'') + data
    while b'\\n' in buf:
        line, buf = buf.split(b'\\n', 1)
        _ready.append((line.rstrip(b'\\r'), conn))
    if len(buf) > _LINE_MAX:  # a phone that never sends a newline: pass the text on rather than grow without bound
        _ready.append((buf, conn))
        buf = b''
    _partial[conn] = buf


async def wait(properties):
    nonlocal _msg
    while True:
        while not _ready:
            data, conn = await _writes.next()
            _split(data, conn)
        data, conn = _ready.pop(0)
        try:
            text = data.decode()
        except UnicodeError:
            runtime._report_error(_node_id, ValueError('ble_uart_in: a phone sent %d bytes that aren\\'t UTF-8 text' % len(data)))
            continue
        _msg = {'payload': text, 'topic': '', 'conn': conn}
        return


async def emit(properties):
    await asyncio.sleep_ms(0)
    return _msg
`;
