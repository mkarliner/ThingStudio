# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_ble/ts_ble/central.py
#
# ts_ble's GATT client (BLE phase 3): one connection per ble peer config, on one path -- finding, connecting,
# discovering, connected -- each step bounded, a failure reported once and retried after RETRY_MS. A part of the
# ts_ble package (2026-11-04), imported only by flows with ble read/write/notify nodes.

import bluetooth
import runtime
from micropython import const

from ts_ble import Scanner, Writes, addr_str, decode, norm_addr, norm_uuid, norm_uuid_for_ble, DEFAULT_MTU as _DEFAULT_MTU

_IRQ_MTU_EXCHANGED = const(21)


_IRQ_PERIPHERAL_CONNECT = const(7)
_IRQ_PERIPHERAL_DISCONNECT = const(8)
_IRQ_GATTC_SERVICE_RESULT = const(9)
_IRQ_GATTC_SERVICE_DONE = const(10)
_IRQ_GATTC_CHARACTERISTIC_RESULT = const(11)
_IRQ_GATTC_CHARACTERISTIC_DONE = const(12)
_IRQ_GATTC_DESCRIPTOR_RESULT = const(13)
_IRQ_GATTC_DESCRIPTOR_DONE = const(14)
_IRQ_GATTC_READ_RESULT = const(15)
_IRQ_GATTC_READ_DONE = const(16)
_IRQ_GATTC_WRITE_DONE = const(17)
_IRQ_GATTC_NOTIFY = const(18)
_IRQ_GATTC_INDICATE = const(19)
_CENTRAL_EVENTS = (7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)

_PROP_NOTIFY = const(0x10)
_PROP_INDICATE = const(0x20)
_CCCD = 0x2902

_STEP_MS = 5000  # each discovery, read or write step
RETRY_MS = 10000  # after a failed step or a lost connection, before finding the peer again


class PeerError(Exception):
    """A step that failed, worded for the console: the peer, the step, what to do."""


class _Op:
    """One awaited radio event: an IRQ sets `result` (or `status`) and the flag."""

    def __init__(self):
        self.flag = runtime.asyncio.ThreadSafeFlag()
        self.items = []
        self.status = None
        self.done = False

    def finish(self, status=0):
        self.status = status
        self.done = True
        self.flag.set()

    async def wait(self, ms, what):
        try:
            await runtime.asyncio.wait_for(self._wait(), ms / 1000)
        except runtime.asyncio.TimeoutError:
            raise PeerError("%s took over %d s" % (what, ms // 1000))

    async def _wait(self):
        while not self.done:
            await self.flag.wait()


class _Peer:
    """One peripheral this board connects to, and the one path to it: finding -> connecting -> discovering ->
    connected. Each step is bounded and fails with one line naming the peer and the step; a failure or a lost
    connection waits RETRY_MS and starts again from finding. Never a different peer, never a queue of requests."""

    def __init__(self, radio, key, addr, name_prefix, timeout_ms):
        self.radio = radio
        self.key = key
        self.addr = norm_addr(addr) if addr else ""
        self.name_prefix = name_prefix or ""
        self.timeout_ms = int(timeout_ms)
        self.label = self.addr or self.name_prefix
        self.needs = {}  # (svc, char) -> "notify" or "plain"
        self.nodes = []
        self.handles = {}  # (svc, char) -> value handle
        self.notify_queues = {}  # value handle -> [Writes]
        self.wants_notify = {}  # (svc, char) -> [Writes]
        self.state = "finding"
        self.conn = None
        self.mtu = _DEFAULT_MTU
        self.task = None
        self.op = None
        self.connect_op = None
        self.found = None
        self.find_op = None
        self.lost = None
        self.last_error = None
        self.lock = runtime.asyncio.Lock()

    # -- what the nodes ask for --

    def need(self, node_id, svc, char, notify=False):
        key = (norm_uuid(svc), norm_uuid(char))
        if notify:
            self.needs[key] = "notify"
        else:
            self.needs.setdefault(key, "plain")
        if node_id not in self.nodes:
            self.nodes.append(node_id)
        self._status_one(node_id)
        self.start()

    def notifications(self, node_id, svc, char):
        w = Writes(node_id)
        self.wants_notify.setdefault((norm_uuid(svc), norm_uuid(char)), []).append(w)
        self.need(node_id, svc, char, notify=True)
        return w

    def start(self):
        """Starts the connection task, once. Without a running event loop yet (setup runs at import on the board,
        where create_task just queues it), the first async call starts it instead."""
        if self.task is None:
            coro = self._run()
            try:
                self.task = runtime.asyncio.create_task(coro)
            except RuntimeError:  # no event loop yet (the editor's CPython tests): the first async call starts it
                coro.close()
                self.task = None

    def stop(self):
        if self.task is not None:
            self.task.cancel()
            self.task = None

    async def read(self, svc, char):
        self.start()
        async with self.lock:
            h = self._ready(svc, char, "read")
            op = self.op = _Op()
            self.radio.ble.gattc_read(self.conn, h)
            await op.wait(_STEP_MS, "%s: reading %s" % (self.label, char))
            if op.status:
                raise PeerError("%s: reading %s failed (status %d)" % (self.label, char, op.status))
            return b"".join(op.items)

    async def write(self, svc, char, data, response):
        self.start()
        async with self.lock:
            h = self._ready(svc, char, "write")
            if not response:
                self.radio.ble.gattc_write(self.conn, h, data, 0)
                return
            op = self.op = _Op()
            self.radio.ble.gattc_write(self.conn, h, data, 1)
            await op.wait(_STEP_MS, "%s: writing %s" % (self.label, char))
            if op.status:
                raise PeerError("%s: writing %s failed (status %d)" % (self.label, char, op.status))

    def _ready(self, svc, char, verb):
        if self.state != "connected":
            raise PeerError("%s isn't connected (%s): can't %s %s now" % (self.label, self.state, verb, char))
        return self.handles[(norm_uuid(svc), norm_uuid(char))]

    # -- status --

    def _status_one(self, node_id):
        if self.state == "connected":
            runtime.report_status(node_id, "connected", "connected to %s" % self.label)
        elif self.state in ("finding", "connecting", "discovering"):
            runtime.report_status(node_id, "connecting", "%s %s" % (self.state, self.label))
        else:
            runtime.report_status(node_id, "disconnected", "%s: %s" % (self.label, self.state))

    def _set(self, state):
        self.state = state
        for n in self.nodes:
            self._status_one(n)

    def _fail(self, message):
        self.state = "retrying in %d s" % (RETRY_MS // 1000)
        for n in self.nodes:
            runtime.report_status(n, "error", message)
        # The console gets a failure once, not every RETRY_MS while a peer stays off.
        if message != self.last_error:
            self.last_error = message
            runtime._report_error(self.nodes[0] if self.nodes else None, PeerError(message))

    # -- the path --

    async def _run(self):
        asyncio = runtime.asyncio
        while True:
            try:
                self.lost = _Op()
                await self._connect_once()
                self.last_error = None
                self._set("connected")
                await self.lost._wait()
                self._fail("%s disconnected" % self.label)
            except runtime.asyncio.CancelledError:
                raise  # a redeploy: not a failure
            except Exception as e:  # noqa: BLE001 -- the path must keep going; any step's failure is reported, then retried
                self._fail(str(e) if isinstance(e, PeerError) else "%s: %s failed (%r)" % (self.label, self.state, e))
                if self.conn is not None:
                    try:
                        self.radio.ble.gap_disconnect(self.conn)
                    except OSError:
                        pass
                    self.conn = None
            await asyncio.sleep_ms(RETRY_MS)

    async def _connect_once(self):
        self.handles = {}
        self.notify_queues = {}
        self.mtu = _DEFAULT_MTU
        self._set("finding")
        addr_type, addr = await self._find()
        self._set("connecting")
        await self._connect(addr_type, addr)
        self._set("discovering")
        await self._discover()

    async def _find(self):
        self.found = None
        op = self.find_op = _Op()
        s = Scanner(None, self.name_prefix, self.addr, None, "", 0)
        s.offer = self._offer  # match by address or name; keep the address type for connecting
        self.radio.scanners.append(s)
        started_own = False
        if not self.radio.scanning:
            try:
                self.radio.ble.gap_scan(self.timeout_ms, 30000, 30000, True)
            except OSError as e:
                # Seen on the C5 as OSError(-519) (HCI 0x07) just after a link dropped: the controller still busy.
                self.radio.scanners.remove(s)
                self.find_op = None
                raise PeerError("%s: the radio refused to scan for it (%r); trying again" % (self.label, e))
            started_own = True
        try:
            await op.wait(self.timeout_ms + 500, "finding %s" % self.label)
        except PeerError:
            raise PeerError("%s: not found in %d s -- is it on, in range and advertising?" % (self.label, self.timeout_ms // 1000))
        finally:
            self.radio.scanners.remove(s)
            self.find_op = None
            if started_own:
                try:
                    self.radio.ble.gap_scan(None)
                except OSError:
                    pass
        return self.found

    def _offer(self, addr_type, addr, adv_type, rssi, adv):
        if self.find_op is None or self.find_op.done:
            return
        if self.addr and addr_str(addr) != self.addr:
            return
        if self.name_prefix and not decode(adv)["name"].startswith(self.name_prefix):
            return
        self.found = (addr_type, bytes(addr))
        self.find_op.finish()

    def scan_done(self):
        pass  # a peer search's own scan ending is expected; finding times out on its own

    async def _connect(self, addr_type, addr):
        paused = self.radio.pause_scan()
        op = self.connect_op = _Op()
        try:
            self.radio.ble.gap_connect(addr_type, addr, self.timeout_ms)
            await op.wait(self.timeout_ms + 1000, "connecting to %s" % self.label)
        except OSError as e:
            raise PeerError("%s: the radio refused to connect (%r)" % (self.label, e))
        except PeerError:
            try:
                self.radio.ble.gap_connect(None)  # cancel the attempt still pending in the stack
            except OSError:
                pass
            raise
        finally:
            self.connect_op = None
            if paused:
                self.radio.resume_scan()
        try:
            self.radio.ble.gattc_exchange_mtu(self.conn)
        except (OSError, AttributeError):
            pass

    async def _step(self, start, what):
        op = self.op = _Op()
        start()
        await op.wait(_STEP_MS, "%s: %s" % (self.label, what))
        return op

    async def _discover(self):
        ble = self.radio.ble
        conn = self.conn
        services = (await self._step(lambda: ble.gattc_discover_services(conn), "finding services")).items
        for svc in sorted({k[0] for k in self.needs}):
            want = bluetooth.UUID(norm_uuid_for_ble(svc))
            rng = [(s, e) for s, e, u in services if u == want]
            if not rng:
                raise PeerError("%s: no service %s -- check the service UUID" % (self.label, svc))
            start, end = rng[0]
            chars = (await self._step(lambda: ble.gattc_discover_characteristics(conn, start, end), "finding characteristics of " + svc)).items
            for (s2, char), mode in sorted(self.needs.items()):
                if s2 != svc:
                    continue
                cwant = bluetooth.UUID(norm_uuid_for_ble(char))
                found = [c for c in chars if c[3] == cwant]
                if not found:
                    raise PeerError("%s: no characteristic %s in service %s -- check the UUID" % (self.label, char, svc))
                end_handle, value_handle, props, _u = found[0]
                self.handles[(svc, char)] = value_handle
                if mode == "notify":
                    await self._subscribe(svc, char, value_handle, end_handle, props)

    async def _subscribe(self, svc, char, value_handle, end_handle, props):
        if props & _PROP_NOTIFY:
            value = b"\x01\x00"
        elif props & _PROP_INDICATE:
            value = b"\x02\x00"
        else:
            raise PeerError("%s: characteristic %s doesn't notify or indicate" % (self.label, char))
        ble = self.radio.ble
        conn = self.conn
        # The start is the value handle itself: NimBLE (ble_gattc_disc_all_dscs) treats it as the characteristic's value
        # and searches after it. value_handle + 1 skipped the 0x2902 right after the value (found on the C5,
        # 2026-11-04: "has no notify switch" against a peer that has one).
        descs = (await self._step(lambda: ble.gattc_discover_descriptors(conn, value_handle, end_handle), "finding the notify switch of " + char)).items
        cccd = [h for h, u in descs if u == bluetooth.UUID(_CCCD)]
        if not cccd:
            raise PeerError("%s: characteristic %s has no notify switch (0x2902)" % (self.label, char))
        op = await self._step(lambda: ble.gattc_write(conn, cccd[0], value, 1), "turning on notifications for " + char)
        if op.status:
            raise PeerError("%s: turning on notifications for %s failed (status %d)" % (self.label, char, op.status))
        self.notify_queues[value_handle] = self.wants_notify.get((svc, char), [])

    # -- radio events --

    def irq(self, event, data):
        if event == _IRQ_PERIPHERAL_CONNECT:
            conn, _t, addr = data
            if self.connect_op is not None and self.found is not None and bytes(addr) == self.found[1]:
                self.conn = conn
                self.connect_op.finish()
            return
        if not data or data[0] != self.conn:
            return
        if event == _IRQ_PERIPHERAL_DISCONNECT:
            self.conn = None
            if self.op is not None and not self.op.done:
                self.op.finish(-1)
            if self.lost is not None:
                self.lost.finish()
        elif event == _IRQ_GATTC_SERVICE_RESULT and self.op is not None:
            _c, start, end, uuid = data
            self.op.items.append((start, end, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_CHARACTERISTIC_RESULT and self.op is not None:
            _c, end_handle, value_handle, props, uuid = data
            self.op.items.append((end_handle, value_handle, props, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_DESCRIPTOR_RESULT and self.op is not None:
            _c, handle, uuid = data
            self.op.items.append((handle, bluetooth.UUID(uuid)))
        elif event == _IRQ_GATTC_READ_RESULT and self.op is not None:
            self.op.items.append(bytes(data[2]))
        elif event in (_IRQ_GATTC_SERVICE_DONE, _IRQ_GATTC_CHARACTERISTIC_DONE, _IRQ_GATTC_DESCRIPTOR_DONE):
            if self.op is not None:
                self.op.finish(data[1])
        elif event in (_IRQ_GATTC_READ_DONE, _IRQ_GATTC_WRITE_DONE):
            if self.op is not None:
                self.op.finish(data[2])
        elif event in (_IRQ_GATTC_NOTIFY, _IRQ_GATTC_INDICATE):
            _c, h, value = data
            for w in self.notify_queues.get(h, ()):
                w.offer(bytes(value), self.conn)
        elif event == _IRQ_MTU_EXCHANGED:
            self.mtu = data[1]



def peer(radio, key, addr, name_prefix, timeout_ms):
    """The connection to one peer (a ble peer config, keyed by its id), shared by every node that names it."""

    def make():
        p = _Peer(radio, key, addr, name_prefix, timeout_ms)
        radio.peers.append(p)
        return p

    return runtime.shared("ble_peer", key, (addr, name_prefix, int(timeout_ms)), make)
