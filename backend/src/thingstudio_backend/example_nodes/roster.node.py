# roster: the latest message from each sender, by a key field, sent as a list when it changes.
# An example custom node: a MicroPython take on Mike's Node-RED roster node (github.com/mkarliner/node-red-roster),
# with three changes for a board: expired entries can be dropped (the default), so memory stays bounded however many
# senders come and go;
# a size cap; and it sends only when something changed, at most once per interval.
#
# Output: payload is a list of entries, sorted (sortBy, highest first; else most recently heard first). Each entry
# is the sender's latest message (merged, see below) plus rosterKey, rosterActive (False only in 'inactive' mode)
# and rosterAgeS (seconds since last heard). msg['count'] is the number of entries, msg['active'] the active ones.
#
# Memory: each entry keeps a whole message. 50 Bluetooth advertisements is a few KB; check free memory if your
# messages are large.

import time

_key = properties['key']
_timeout_ms = int(properties['timeoutS'] * 1000)
_drop = properties['expired'] == 'drop'
_merge = properties['merge']
_max = int(properties['maxEntries'])
_sort = properties['sortBy']
_min_ms = int(properties['minIntervalMs'])
_id = properties['id']
_asyncio = runtime.asyncio

_entries = {}  # key -> {'msg': dict, 'seen': ticks_ms, 'active': bool}
_dirty = False
_last_sent = None
_event = _asyncio.Event()
_bad_key_reported = False


def _key_of(msg):
    if _key.startswith('payload.'):
        payload = msg.get('payload')
        return payload.get(_key[8:]) if isinstance(payload, dict) else None
    return msg.get(_key)


def _expire():
    changed = False
    now = time.ticks_ms()
    for k in list(_entries):
        entry = _entries[k]
        if time.ticks_diff(now, entry['seen']) > _timeout_ms:
            if _drop:
                del _entries[k]
                changed = True
            elif entry['active']:
                entry['active'] = False
                changed = True
    return changed


def _make_room():
    # Inactive entries first, then whoever has been silent longest.
    victim = None
    for k, entry in _entries.items():
        rank = (entry['active'], -time.ticks_diff(time.ticks_ms(), entry['seen']))
        if victim is None or rank < victim[0]:
            victim = (rank, k)
    del _entries[victim[1]]


async def run(msg, properties):
    nonlocal _dirty, _bad_key_reported
    k = _key_of(msg)
    if k is None or k == '':
        if not _bad_key_reported:
            _bad_key_reported = True
            runtime.report_status(_id, 'error', 'a message had no %s' % _key)
        return
    old = _entries.get(k)
    if old is not None and _merge:
        stored = old['msg']
        for field, value in msg.items():
            if value is not None and value != '':
                stored[field] = value
    else:
        if old is None and len(_entries) >= _max:
            _make_room()
        stored = dict(msg)
    _entries[k] = {'msg': stored, 'seen': time.ticks_ms(), 'active': True}
    _dirty = True
    _event.set()


async def wait(properties):
    nonlocal _dirty
    while True:
        if _expire():
            _dirty = True
        if _dirty:
            if _last_sent is None:
                return
            gap = _min_ms - time.ticks_diff(time.ticks_ms(), _last_sent)
            if gap <= 0:
                return
            await _asyncio.sleep_ms(min(gap, 1000))
            continue
        _event.clear()
        try:
            await _asyncio.wait_for(_event.wait(), 1)  # wake at least once a second to expire entries
        except _asyncio.TimeoutError:
            pass


def _sort_value(item):
    value = item.get(_sort)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else -1e30


async def emit(properties):
    nonlocal _dirty, _last_sent
    _dirty = False
    now = time.ticks_ms()
    _last_sent = now
    items = []
    active = 0
    for k, entry in _entries.items():
        item = dict(entry['msg'])
        item['rosterKey'] = k
        item['rosterActive'] = entry['active']
        item['rosterAgeS'] = time.ticks_diff(now, entry['seen']) // 1000
        active += 1 if entry['active'] else 0
        items.append(item)
    if _sort:
        items.sort(key=_sort_value, reverse=True)
    else:
        items.sort(key=lambda item: item['rosterAgeS'])
    return {'payload': items, 'topic': '', 'count': len(items), 'active': active}
