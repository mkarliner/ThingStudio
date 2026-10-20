# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_mqtt/ts_mqtt.py
#
# Thingstudio's shared MQTT client, a flow dependency rather than part of the runtime (a flow with no MQTT never
# carries it). One client per broker, built once and shared by every mqtt_publish/mqtt_subscribe node on it -- the
# package form of what mqtt-shared.ts used to emit as module-scope setup. The difference that matters: the client,
# its connection and its subscriptions are library state, so a package's per-instance setup can reach them.
#
# Subscriptions are tracked PER NODE, not per topic (Mike, 2026-10-19; see outstanding-items/mqtt-dynamic-
# subscription.md). Two nodes may subscribe to the same topic or overlapping wildcards; the broker is only told to
# UNSUBSCRIBE when the last node lets go. Incoming messages are routed to each node's own queue by wildcard match,
# so two subscribe nodes on one client no longer race over one shared queue.
#
# Reconnection is mqtt_as's own (_keep_connected). mqtt_as does not resubscribe on reconnect, so ensure_connected()
# resubscribes the registry's current topics whenever it sees the link come back. That is also why wait_message()
# re-checks the connection about once a second while it waits: a subscribe-only flow has no publish call to notice
# a reconnect.
#
# A "subscribed" signal for a publish to wait on is deliberately not built yet; the registry is where it belongs
# (outstanding-items/mqtt-pubsub-boot-race.md), and ensure_connected()/subscribe() are the seam for it.

import asyncio
import mqtt_as
import network
import runtime
import sys
import time

_clients = {}

# Queue per node, plus an Event per node. A list rather than asyncio.Queue: the dispatcher is the only writer, and
# a plain list makes "drop the oldest when full" a one-liner (mqtt_as's own MsgQueue does the same).
_QUEUE_LIMIT = 20


def _match(filt, topic):
    if filt == topic:
        return True
    f = filt.split('/')
    t = topic.split('/')
    i = 0
    while i < len(f):
        if f[i] == '#':
            return True
        if i >= len(t):
            return False
        if f[i] != '+' and f[i] != t[i]:
            return False
        i += 1
    return i == len(t)


def _text(value):
    return value.decode() if isinstance(value, (bytes, bytearray)) else value


class _Client:
    def __init__(self, broker, port, ssid, wifi_password, security, username, password):
        self.broker = broker
        self.port = port
        self.settings = (ssid, wifi_password, security, username, password)
        cfg = dict(mqtt_as.config)
        cfg['server'] = broker
        cfg['port'] = port
        cfg['ssid'] = ssid
        cfg['wifi_pw'] = wifi_password
        cfg['user'] = username
        cfg['password'] = password
        # Fixed: only subscribe nodes drain the queue, and a publish-only flow simply never does. MsgQueue drops
        # the oldest entry on overflow, so this is a bound, not a leak.
        cfg['queue_len'] = _QUEUE_LIMIT
        self.client = mqtt_as.MQTTClient(cfg)
        self.connected = False
        self.link_up = False
        self.lock = None
        self.subs = {}          # topic -> set of node ids still subscribed
        self.qos = {}           # topic -> highest qos any node asked for
        self.node_topics = {}   # node id -> set of topics
        self.queues = {}        # node id -> [(topic, payload, retained), ...]
        self.events = {}        # node id -> asyncio.Event
        self.last_state = {}    # node id -> last reported connected state
        self.dispatcher = None
        runtime.register_cleanup('mqtt-%s-%s' % (broker, port), self.stop)

    # -- lifecycle ----------------------------------------------------------------------------------------------

    def stop(self):
        """Redeploy cleanup: stop this client and its tasks. Sync, as runtime cleanups are. WiFi stays up for the
        next flow. Same sequence the old generated cleanup used, including mqtt_as's internals (its own
        disconnect() is async and close() also drops WiFi)."""
        c = self.client
        c._has_connected = False
        c._isconnected = False
        for task in c._tasks:
            task.cancel()
        c._tasks.clear()
        if c._sock is not None:
            try:
                c._sock.write(b'\xe0\0')
            except OSError:
                pass
            c._close()
            c._sock = None
        if self.dispatcher is not None:
            self.dispatcher.cancel()
            self.dispatcher = None
        _clients.pop((self.broker, self.port), None)

    def _report(self, node_id):
        now = bool(self.client.isconnected())
        if self.last_state.get(node_id) != now:
            self.last_state[node_id] = now
            runtime.report_status(node_id, 'connected' if now else 'disconnected')

    async def ensure_connected(self, node_id):
        """Connect once, then report this node's own state. After the first successful connect, mqtt_as's own
        _keep_connected() owns reconnection -- calling connect() again here races its in-flight reconnect and wedges
        the ESP32 WiFi driver ("sta is connecting, cannot set config", then a connect/disconnect loop). This is why
        the old generated code only ever connected once. Double-checked locking so however many nodes share the
        client only one actually connects; every caller still reports under its own id."""
        if self.connected:
            now = bool(self.client.isconnected())
            if now and not self.link_up:
                # mqtt_as reconnected: resubscribe from the registry's current set.
                self.link_up = True
                await self._resubscribe()
            elif not now:
                self.link_up = False
            self._report(node_id)
            return
        if self.lock is None:
            self.lock = asyncio.Lock()
        async with self.lock:
            if self.connected:
                self._report(node_id)
                return
            sta = network.WLAN(network.STA_IF)
            if not sta.active():
                sta.active(True)
            if sys.platform == 'esp32' and not sta.isconnected():
                # The flow joins WiFi at start (ts_wifi); this only waits for that join and says how it went.
                t0 = time.ticks_ms()
                print('NET_INFO mqtt: waiting for WiFi, station status %s' % (sta.status(),))
                for _ in range(150):  # bounded ~15 s
                    if sta.isconnected():
                        break
                    await asyncio.sleep_ms(100)
                print('NET_INFO mqtt: WiFi %s after %d ms, station status %s' % (
                    'up' if sta.isconnected() else 'NOT up', time.ticks_diff(time.ticks_ms(), t0), sta.status()))
            errs = []
            for attempt in range(3):
                try:
                    await self.client.connect()
                    self.connected = True
                    break
                except OSError as e:
                    try:
                        station = sta.status()
                    except Exception:
                        station = '?'
                    why = repr(e)
                    for code, text in (
                        ('0x1', "broker doesn't support this MQTT version"),
                        ('0x2', 'client ID rejected'),
                        ('0x3', 'broker unavailable'),
                        ('0x4', 'bad username or password -- check the broker config'),
                        ('0x5', "not authorised -- check the broker config's username/password, or the broker's access rules"),
                    ):
                        if 'reason code ' + code in why:
                            why += ' (' + text + ')'
                    errs.append('%d: %s, wifi status %s' % (attempt + 1, why, station))
                    if attempt == 2:
                        self.last_state[node_id] = False
                        runtime.report_status(node_id, 'error', 'connect to %s:%s failed' % (self.broker, self.port))
                        raise OSError('mqtt connect to %s:%s failed after 3 attempts (%s)' % (
                            self.broker, self.port, '; '.join(errs)))
                    await asyncio.sleep_ms(1000)
            self.connected = True
            self.link_up = True
            await self._resubscribe()
            self._start_dispatcher()
        self._report(node_id)

    async def _resubscribe(self):
        for topic in list(self.subs.keys()):
            try:
                await self.client.subscribe(topic, self.qos.get(topic, 0))
            except OSError as e:
                raise OSError('mqtt subscribe to %s:%s failed: %r' % (self.broker, self.port, e))

    # -- subscriptions and routing ------------------------------------------------------------------------------

    def _start_dispatcher(self):
        if self.dispatcher is None:
            self.dispatcher = asyncio.create_task(self._dispatch())

    async def _dispatch(self):
        while True:
            topic, payload, retained = await self.client.queue.__anext__()
            text = _text(topic)
            for node_id in list(self.node_topics.keys()):
                for filt in list(self.node_topics[node_id]):
                    if _match(filt, text):
                        queue = self.queues.setdefault(node_id, [])
                        queue.append((topic, payload, retained))
                        if len(queue) > _QUEUE_LIMIT:
                            queue.pop(0)
                        self.events[node_id].set()
                        break

    async def subscribe(self, node_id, topic, qos=0):
        self.queues.setdefault(node_id, [])
        if node_id not in self.events:
            self.events[node_id] = asyncio.Event()
        self.node_topics.setdefault(node_id, set()).add(topic)
        first = topic not in self.subs
        self.subs.setdefault(topic, set()).add(node_id)
        if qos > self.qos.get(topic, 0):
            self.qos[topic] = qos
        if first:
            try:
                await self.client.subscribe(topic, self.qos.get(topic, 0))
            except OSError as e:
                raise OSError('mqtt subscribe to %s:%s failed: %r' % (self.broker, self.port, e))
        self._start_dispatcher()

    async def unsubscribe(self, node_id, topic):
        """Dynamic-subscription seam (not yet exposed by a node): only the last node letting go sends the broker an
        UNSUBSCRIBE."""
        topics = self.node_topics.get(node_id)
        if topics is not None:
            topics.discard(topic)
        holders = self.subs.get(topic)
        if holders is None:
            return
        holders.discard(node_id)
        if not holders:
            self.subs.pop(topic, None)
            self.qos.pop(topic, None)
            try:
                await self.client.unsubscribe(topic)
            except OSError as e:
                raise OSError('mqtt unsubscribe from %s:%s failed: %r' % (self.broker, self.port, e))

    async def wait_message(self, node_id):
        """Wait for a message routed to this node. Re-checks the connection while waiting: mqtt_as reconnects on
        its own, and only this call notices and resubscribes in a subscribe-only flow."""
        await self.ensure_connected(node_id)
        queue = self.queues.setdefault(node_id, [])
        event = self.events[node_id]
        while not queue:
            try:
                await asyncio.wait_for(event.wait(), 1)
            except asyncio.TimeoutError:
                pass
            event.clear()
            await self.ensure_connected(node_id)
            queue = self.queues.get(node_id) or []
        return queue.pop(0)

    # -- publishing ---------------------------------------------------------------------------------------------

    async def publish(self, node_id, topic, payload, retain=False, qos=0):
        await self.ensure_connected(node_id)
        try:
            await self.client.publish(topic, payload, retain=retain, qos=qos)
        except OSError as e:
            raise OSError('mqtt publish to %s:%s failed: %r' % (self.broker, self.port, e))


def ensure_client(broker, port, ssid, wifi_password, security='password', username='', password=''):
    """The one client for this broker. Two nodes asking for different settings is a loud error, like ts_wifi --
    never a silent first-wins."""
    settings = (ssid, wifi_password, security, username, password)
    key = (broker, port)
    existing = _clients.get(key)
    if existing is not None:
        if existing.settings != settings:
            raise ValueError(
                'ts_mqtt: two nodes asked for different settings for broker %s:%s -- every MQTT node on one broker '
                'must share the WiFi and broker credentials' % (broker, port))
        return existing
    client = _Client(broker, port, ssid, wifi_password, security, username, password)
    _clients[key] = client
    return client
