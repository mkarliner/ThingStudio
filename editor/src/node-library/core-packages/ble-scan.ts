// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-scan.ts
//
// ble_scan as a core package (2026-11-03, BLE phase 1: docs/working-notes/ble-nodes-scoping.md). An event source: it
// waits for an advertisement that passes its filters and sends one message per advertisement. The radio, the shared
// scan and the per-node queue are ts_ble's (device-runtime/src/vendor/thingstudio_ble/ts_ble.py); this file is only
// the descriptor, the compile-time checks and the glue.
//
// The hook normalises the filters (so the board does no parsing of user text) and refuses scan settings that differ
// between two ble_scan nodes: the board has one scan, and a silent first-wins would hide the second node's settings.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_scan",
  kind: "source",
  eventSource: true,
  paletteId: "ble_scan",
  label: "ble scan",
  group: "network",
  priority: 60,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 96,
  description:
    "Listens for Bluetooth LE advertisements and sends one message per advertisement that passes the filters. " +
    "msg.payload is the advertising data (bytes); msg.addr, msg.rssi, msg.name, msg.mfrId, msg.mfr, msg.svcData " +
    "and msg.services say who sent it and what it holds.",
  requires: { capabilities: ["ble"] },
  ports: {
    outputs: [{ name: "msg", type: "bytes" }],
  },
  properties: [
    { name: "namePrefix", label: "name starts with", kind: "text", default: "", help: "Only devices whose name starts with this. Many devices send their name only to an active scan." },
    { name: "addr", label: "address", kind: "text", default: "", placeholder: "aa:bb:cc:dd:ee:ff", help: "Only this device." },
    { name: "mfrId", label: "manufacturer id", kind: "text", default: "", placeholder: "0x0499", help: "Only advertisements with this manufacturer id: hex with 0x, or decimal." },
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "fcd2", help: "Only advertisements that list this service or carry data for it (fcd2 is BTHome)." },
    { name: "active", label: "active scan", kind: "boolean", default: false, help: "Also ask each device for its scan response, which usually holds its name." },
    { name: "repeatMs", label: "repeat window (ms)", kind: "number", default: 1000, min: 0, help: "Drops an advertisement identical to the last one from the same device within this time. 0 sends every one." },
    { name: "scanIntervalMs", label: "scan interval (ms)", kind: "number", default: 320, min: 2.5, max: 10240, step: 0.625, help: "How often the radio starts listening. Every ble scan node in a flow shares one scan." },
    { name: "scanWindowMs", label: "scan window (ms)", kind: "number", default: 30, min: 2.5, max: 10240, step: 0.625, help: "How long it listens each time. A longer window misses fewer advertisements and leaves WiFi less time." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `import re


def _addr(text):
    hexs = ''.join(c for c in str(text).lower() if c not in ':-. ')
    if len(hexs) != 12 or re.match('^[0-9a-f]+$', hexs) is None:
        return None
    return ':'.join(hexs[i:i + 2] for i in range(0, 12, 2))


def _uuid(text):
    t = str(text).strip().lower()
    if t.startswith('0x'):
        t = t[2:]
    hexs = t.replace('-', '')
    if len(hexs) not in (4, 32) or re.match('^[0-9a-f]+$', hexs) is None:
        return None
    return hexs


def _num(properties, name, default):
    try:
        return float(properties.get(name, default))
    except (TypeError, ValueError):
        return None


def _scan_settings(properties):
    return (_num(properties, 'scanIntervalMs', 320), _num(properties, 'scanWindowMs', 30), bool(properties.get('active', False)))


def compile(ctx, properties):
    errors = []
    out = {}

    addr = str(properties.get('addr') or '').strip()
    if addr:
        a = _addr(addr)
        if a is None:
            errors.append('ble_scan address "' + addr + '" is not a Bluetooth address: six bytes, like aa:bb:cc:dd:ee:ff')
        out['addr'] = a or ''
    else:
        out['addr'] = ''

    mfr = str(properties.get('mfrId') or '').strip()
    out['mfrId'] = None
    if mfr:
        try:
            v = int(mfr, 16) if mfr.lower().startswith('0x') else int(mfr)
        except ValueError:
            v = -1
        if v < 0 or v > 0xFFFF:
            errors.append('ble_scan manufacturer id "' + mfr + '" must be 0-65535, or hex like 0x0499')
        else:
            out['mfrId'] = v

    svc = str(properties.get('serviceUuid') or '').strip()
    out['serviceUuid'] = ''
    if svc:
        u = _uuid(svc)
        if u is None:
            errors.append('ble_scan service UUID "' + svc + '" must be 16-bit (fcd2) or 128-bit hex')
        else:
            out['serviceUuid'] = u

    repeat = _num(properties, 'repeatMs', 1000)
    if repeat is None or repeat < 0:
        errors.append('ble_scan repeat window must be 0 or more milliseconds')
    out['repeatMs'] = int(repeat or 0)

    interval, window, active = _scan_settings(properties)
    if interval is None or not (2.5 <= interval <= 10240):
        errors.append('ble_scan scan interval must be 2.5-10240 ms (Bluetooth limits)')
    elif window is None or not (2.5 <= window <= interval):
        shown = str(int(interval)) if interval == int(interval) else str(interval)
        errors.append('ble_scan scan window must be 2.5 ms up to the scan interval (' + shown + ' ms)')

    mine = _scan_settings(properties)
    for other in ctx['nodesOfType']:
        if other['id'] != ctx['node']['id'] and _scan_settings(other['properties']) != mine:
            errors.append(
                'ble_scan nodes ' + ctx['node']['id'] + ' and ' + other['id'] + ' ask for different scan settings '
                '(interval, window, active): the board has one scan, so give them the same settings')
            break

    out['scanIntervalMs'] = interval
    out['scanWindowMs'] = window
    out['active'] = active
    out['namePrefix'] = str(properties.get('namePrefix') or '')
    if errors:
        return {'errors': errors}
    return {'properties': out}
`;

export const python = `import ts_ble

_scanner = ts_ble.radio().scan(
    properties['nodeId'], properties['scanIntervalMs'], properties['scanWindowMs'], properties['active'],
    name_prefix=properties['namePrefix'], addr=properties['addr'], mfr_id=properties['mfrId'],
    svc_uuid=properties['serviceUuid'], repeat_ms=properties['repeatMs'])
_msg = None


async def wait(properties):
    nonlocal _msg
    _msg = await _scanner.next()


async def emit(properties):
    # A burst of queued advertisements would otherwise run back to back with no yield.
    await asyncio.sleep_ms(0)
    return _msg
`;
