# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_ble/ts_ble/server.py
#
# ts_ble's GATT server (BLE phase 2): the flow's service table, registered once, connectable advertising, writes
# queued per node, notifications per connection, and the Nordic UART Service. A part of the ts_ble package
# (2026-11-04), imported only by flows with characteristic or UART nodes, so a scan-only flow doesn't load it.

import bluetooth
import runtime
from micropython import const

from ts_ble import Writes, build_adv, norm_uuid, norm_uuid_for_ble, DEFAULT_MTU as _DEFAULT_MTU

# -- the GATT server (BLE phase 2) ---------------------------------------------------------------------------------

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_IRQ_MTU_EXCHANGED = const(21)

FLAG_READ = const(0x0002)
FLAG_WRITE_NO_RESPONSE = const(0x0004)
FLAG_WRITE = const(0x0008)
FLAG_NOTIFY = const(0x0010)

# The Nordic UART Service: what phone terminal apps (nRF Connect, Serial Bluetooth Terminal, Bluefruit) look for.
NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # the phone writes here
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # the board notifies here

_WRITE_BUFFER = 244  # the largest write a phone can make in one go at MTU 247
_ADV_DEFAULT_MS = 500


class _Gatt:
    """The registered service table: a handle per (service, characteristic), the nodes listening for writes, the
    connected centrals and their MTUs. Built once per deploy, by whichever GATT node starts first."""

    def __init__(self, radio, table):
        self.radio = radio
        self.handles = {}
        self.writers = {}  # handle -> [Writes]
        self.conns = {}  # conn handle -> MTU
        self.nodes = []  # node ids, for connection status
        ble = radio.ble
        services = tuple(
            (bluetooth.UUID(norm_uuid_for_ble(svc)), tuple((bluetooth.UUID(norm_uuid_for_ble(c)), int(f)) for c, f in chars))
            for svc, chars in table
        )
        try:
            ble.gap_advertise(None)  # registering resets the GATT database; nothing may be connectable meanwhile
            registered = ble.gatts_register_services(services)
        except OSError as e:
            raise OSError("Bluetooth services could not be registered (%r): %d services; hard-reset the board" % (e, len(services)))
        for (svc, chars), handles in zip(table, registered):
            for (char, flags), h in zip(chars, handles):
                self.handles[(norm_uuid(svc), norm_uuid(char))] = h
                if flags & (FLAG_WRITE | FLAG_WRITE_NO_RESPONSE):
                    ble.gatts_set_buffer(h, _WRITE_BUFFER)
        try:
            ble.config(mtu=_WRITE_BUFFER + 3)  # the size the board asks for; the phone may agree to less
        except (OSError, ValueError, TypeError):
            pass

    def handle(self, svc, char):
        try:
            return self.handles[(norm_uuid(svc), norm_uuid(char))]
        except KeyError:
            raise OSError("characteristic %s in service %s isn't in the registered table" % (char, svc))

    def on_writes(self, node_id, svc, char):
        w = Writes(node_id)
        self.writers.setdefault(self.handle(svc, char), []).append(w)
        self.attach(node_id)
        return w

    def attach(self, node_id):
        """Adds a node to the ones whose status follows the connections."""
        self._node(node_id)

    def _node(self, node_id):
        if node_id not in self.nodes:
            self.nodes.append(node_id)
        self._status(node_id)

    def _status(self, node_id):
        if self.conns:
            runtime.report_status(node_id, "connected", "%d connected" % len(self.conns))
        else:
            runtime.report_status(node_id, "disconnected", "advertising, no one connected")

    def payload_room(self):
        """What one notification carries at the smallest connected MTU."""
        return (min(self.conns.values()) if self.conns else _DEFAULT_MTU) - 3

    def write(self, node_id, svc, char, data, notify):
        """Sets the value a phone reads, and notifies every connected phone. Returns how many were notified."""
        h = self.handle(svc, char)
        ble = self.radio.ble
        ble.gatts_write(h, data)
        self._node(node_id)
        sent = 0
        if notify:
            for conn in list(self.conns):
                try:
                    ble.gatts_notify(conn, h)
                    sent += 1
                except OSError:
                    pass  # it disconnected meanwhile; the disconnect event follows
        return sent

    def send_chunks(self, node_id, svc, char, data):
        """Notifies `data` to every connected phone in pieces that fit each one's MTU (UART). Returns pieces sent."""
        h = self.handle(svc, char)
        ble = self.radio.ble
        self._node(node_id)
        sent = 0
        for conn, mtu in list(self.conns.items()):
            step = mtu - 3
            for i in range(0, len(data), step):
                try:
                    ble.gatts_notify(conn, h, data[i : i + step])
                    sent += 1
                except OSError:
                    break
        return sent

    def irq(self, event, data):
        if event == _IRQ_CENTRAL_CONNECT:
            conn = data[0]
            self.conns[conn] = _DEFAULT_MTU
            for n in self.nodes:
                self._status(n)
        elif event == _IRQ_CENTRAL_DISCONNECT:
            self.conns.pop(data[0], None)
            for n in self.nodes:
                self._status(n)
            self.radio.readvertise()  # the stack stops advertising on a connection
        elif event == _IRQ_GATTS_WRITE:
            conn, h = data[0], data[1]
            writers = self.writers.get(h)
            if writers:
                value = bytes(self.radio.ble.gatts_read(h))
                for w in writers:
                    w.offer(value, conn)
        elif event == _IRQ_MTU_EXCHANGED:
            if data[0] in self.conns:
                self.conns[data[0]] = data[1]



def gatt(radio, table, name):
    """The flow's GATT server, registering `table` on first use. Every GATT node passes the same table (the
    compiler builds it from the whole flow); a different one is a loud error, as for any shared hardware.
    Without a ble advertise node, the board advertises `name` so phones can find it."""

    def make():
        g = _Gatt(radio, table)
        radio.gatt_server = g
        if radio.adv is None:
            radio.adv = (_ADV_DEFAULT_MS, build_adv(name))
        radio.readvertise()
        return g

    return runtime.shared("ble_gatt", 0, table, make)
