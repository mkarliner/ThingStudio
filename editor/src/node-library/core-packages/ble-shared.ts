// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-shared.ts
//
// Shared compile-hook Python for the BLE packages (2026-11-03, BLE phase 2: docs/working-notes/ble-nodes-scoping.md).
// One copy, so the rules can't drift between nodes:
//   - _ble_name(ctx): the flow's one `ble` config (optional), giving the advertised name;
//   - _ble_uuid(text): a 16-bit or 128-bit UUID in ts_ble's canonical form, or None;
//   - _ble_gatt(ctx): the whole flow's GATT service table, built from every characteristic and UART node.
// The board registers its services once (MicroPython's gatts_register_services takes the whole table), so every GATT
// node gets the same table from the compiler and the first to start registers it. The table is sorted, so it compares
// equal however the flow's nodes are ordered.

export const BLE_CONFIG_TYPE = "thingstudio/config/ble";

export const BLE_NAME_DERIVATION = `import re

_BLE_NAME_DEFAULT = 'thingstudio'
_BLE_NAME_MAX = 26


def _ble_name(ctx):
    configs = [c for c in ctx['flow']['configs'] if c['type'] == '${BLE_CONFIG_TYPE}']
    if len(configs) > 1:
        return None, 'this flow has %d BLE configs, but a board has one radio -- keep one (any ble node\\'s BLE field)' % len(configs)
    name = _BLE_NAME_DEFAULT
    if configs:
        name = str(configs[0]['properties'].get('name') or '')
    if len(name.encode()) > _BLE_NAME_MAX:
        return None, 'BLE name "' + name + '" is ' + str(len(name.encode())) + ' bytes; ' + str(_BLE_NAME_MAX) + ' is the most an advertisement holds'
    return name, None


def _ble_uuid(text):
    t = str(text or '').strip().lower()
    if t.startswith('0x'):
        t = t[2:]
    hexs = t.replace('-', '')
    if len(hexs) not in (4, 32) or re.match('^[0-9a-f]+$', hexs) is None:
        return None
    if len(hexs) == 4:
        return hexs
    return hexs[0:8] + '-' + hexs[8:12] + '-' + hexs[12:16] + '-' + hexs[16:20] + '-' + hexs[20:32]
`;

export const BLE_GATT_DERIVATION = `${BLE_NAME_DERIVATION}
_NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
_NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
_NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
_F_READ = 0x02
_F_WRITE_NR = 0x04
_F_WRITE = 0x08
_F_NOTIFY = 0x10
_CHAR_IN = 'thingstudio/ble_characteristic_in'
_CHAR_OUT = 'thingstudio/ble_characteristic_out'
_UART = ('thingstudio/ble_uart_in', 'thingstudio/ble_uart_out')
ENCODINGS = ('bytes', 'text', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'float32')


def _ble_gatt(ctx):
    flags = {}
    encoding = {}
    writer = {}
    errors = []
    uart = False
    for n in ctx['flow']['nodes']:
        t = n['type']
        p = n['properties']
        if t in _UART:
            uart = True
            continue
        if t not in (_CHAR_IN, _CHAR_OUT):
            continue
        svc = _ble_uuid(p.get('serviceUuid'))
        char = _ble_uuid(p.get('charUuid'))
        if svc is None or char is None:
            continue  # that node's own hook names the bad UUID
        key = (svc, char)
        enc = p.get('encoding', 'bytes')
        if key in encoding and encoding[key][0] != enc:
            errors.append(
                'ble characteristic nodes ' + encoding[key][1] + ' and ' + n['id'] + ' share ' + char + ' but encode it as ' +
                encoding[key][0] + ' and ' + enc + ': give them the same encoding')
        encoding.setdefault(key, (enc, n['id']))
        f = flags.get(key, 0)
        if t == _CHAR_IN:
            f |= _F_WRITE | _F_WRITE_NR
        else:
            f |= _F_READ
            if p.get('notify', True):
                f |= _F_NOTIFY
            if key in writer:
                errors.append(
                    'ble characteristic out nodes ' + writer[key] + ' and ' + n['id'] + ' both set ' + char +
                    ': a characteristic has one value, so use one node')
            writer[key] = n['id']
        flags[key] = f
    if uart:
        flags[(_NUS, _NUS_RX)] = flags.get((_NUS, _NUS_RX), 0) | _F_WRITE | _F_WRITE_NR
        flags[(_NUS, _NUS_TX)] = flags.get((_NUS, _NUS_TX), 0) | _F_NOTIFY
    services = {}
    for (svc, char), f in flags.items():
        services.setdefault(svc, {})[char] = f
    table = [[svc, [[char, services[svc][char]] for char in sorted(services[svc])]] for svc in sorted(services)]
    return table, errors
`;

/** The configRef field every BLE node carries: the flow's one `ble` config, optional. */
export const BLE_CONFIG_FIELD = {
  name: "bleConfigId",
  label: "BLE",
  kind: "configRef" as const,
  configType: BLE_CONFIG_TYPE,
  // Not a singleton reference: that makes a missing config a compile error, and this one is optional. The config
  // type itself is a singleton (one per flow, config-types.ts), and the hooks read it from the flow (_ble_name).
  default: "",
  optional: true,
  help: "The board's Bluetooth name, shared by every ble node. Without one, the board is called thingstudio.",
};

/** Characteristic encodings, and the wire type each puts in msg.payload. */
export const ENCODING_OPTIONS = [
  { value: "bytes", label: "bytes, as they are" },
  { value: "text", label: "text (UTF-8)" },
  { value: "int8", label: "int8" },
  { value: "uint8", label: "uint8" },
  { value: "int16", label: "int16, little-endian" },
  { value: "uint16", label: "uint16, little-endian" },
  { value: "int32", label: "int32, little-endian" },
  { value: "uint32", label: "uint32, little-endian" },
  { value: "float32", label: "float32, little-endian" },
];
export const ENCODING_PORT_MAP: Record<string, "bytes" | "string" | "int" | "number"> = {
  bytes: "bytes",
  text: "string",
  int8: "int",
  uint8: "int",
  int16: "int",
  uint16: "int",
  int32: "int",
  uint32: "int",
  float32: "number",
};

// BLE phase 3 (2026-11-04): the device a central node connects to, one config per peer.
export const BLE_PEER_CONFIG_TYPE = "thingstudio/config/ble-peer";

export const BLE_PEER_FIELD = {
  name: "peerConfigId",
  label: "BLE peer",
  kind: "configRef" as const,
  configType: BLE_PEER_CONFIG_TYPE,
  default: "",
  help: "The device to connect to, by address or name. Nodes that name the same peer share one connection.",
};

/** _ble_peer(ctx, properties, label): the node's peer config, checked, as the keys the package Python reads. */
export const BLE_PEER_DERIVATION = `${BLE_NAME_DERIVATION}

def _ble_addr(text):
    hexs = ''.join(c for c in str(text or '').lower() if c not in ':-. ')
    if len(hexs) != 12 or re.match('^[0-9a-f]+$', hexs) is None:
        return None
    return ':'.join(hexs[i:i + 2] for i in range(0, 12, 2))


def _ble_peer(ctx, properties, label):
    pid = properties.get('peerConfigId') or ''
    cfg = (ctx.get('referencedConfigs') or {}).get(pid)
    if not pid or cfg is None:
        return None, label + ' needs a BLE peer: pick or add one in its "BLE peer" field (the device to connect to)'
    raw_addr = str(cfg.get('addr') or '').strip()
    prefix = str(cfg.get('namePrefix') or '').strip()
    addr = ''
    if raw_addr:
        addr = _ble_addr(raw_addr)
        if addr is None:
            return None, 'BLE peer address "' + raw_addr + '" is not a Bluetooth address: six bytes, like aa:bb:cc:dd:ee:ff'
    if not addr and not prefix:
        return None, 'the BLE peer config needs an address or a name to find the device by'
    try:
        timeout = int(cfg.get('timeoutMs') or 10000)
    except (TypeError, ValueError):
        timeout = -1
    if timeout < 1000 or timeout > 60000:
        return None, 'BLE peer timeout must be 1000-60000 ms'
    return {'peerKey': pid, 'peerAddr': addr, 'peerName': prefix, 'peerTimeoutMs': timeout}, None
`;
