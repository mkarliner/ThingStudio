# Minimal stand-in for the vendored mqtt_as
# (device-runtime/src/vendor/mqtt_as/__init__.py), used only to run
# compiler output through real CPython in tests -- see
# docs/working-notes/validation/mvp-validation-plan.md. Not a substitute
# for the real headless-unix-port check against the actual vendored file;
# closest thing achievable without real MicroPython or hardware.
#
# Only what mqtt-shared.ts's/mqtt-publish.ts's/mqtt-subscribe.ts's codegen
# actually touches: the `config` dict (copied via dict(mqtt_as.config), so
# this only needs the keys real code reads/sets), MQTTClient's
# constructor, async connect()/publish()/subscribe(), and .queue's
# __anext__()/__aiter__() (the callback-free Event/Queue interface,
# config['queue_len'] > 0). No real network/broker behavior -- publishes
# are recorded (PUBLISHED) and incoming messages are test-injected
# (_MsgQueue._inject), same "print/record observable side effects, no
# real I/O" style as machine.py/network.py.

import asyncio

config = {
    "client_id": b"pymock",
    "server": None,
    "port": 0,
    "user": "",
    "password": "",
    "ssid": None,
    "wifi_pw": None,
    "queue_len": 0,
}


class _MsgQueue:
    def __init__(self):
        self._items = []
        self._evt = asyncio.Event()

    def _inject(self, topic, payload, retained=False):
        """Test-only: queue an incoming message as mqtt_as's real
        MsgQueue.put() would from a real broker packet."""
        self._items.append((topic, payload, retained))
        self._evt.set()

    def __aiter__(self):
        return self

    async def __anext__(self):
        while not self._items:
            self._evt.clear()
            await self._evt.wait()
        item = self._items.pop(0)
        return item


# Test-controlled globals: every constructed client is recorded here (so a
# test can reach into a compiled flow's own client instance without the JS
# side needing to know its generated variable name), and every publish()
# call is recorded on PUBLISHED for assertions.
CLIENTS = []
PUBLISHED = []


class MQTTClient:
    # Test-controllable: an artificial await inside connect(), long enough
    # to give a real event-loop yield point for a second coroutine to try
    # (and correctly block on) connecting concurrently -- see
    # node-mqtt-publish.test.ts's "two chains racing to connect" test.
    # Zero by default so every other test's connect() resolves instantly.
    CONNECT_DELAY_S = 0

    def __init__(self, cfg):
        self.cfg = dict(cfg)
        self.connected = False
        self.connect_calls = 0
        self.queue = _MsgQueue()
        self.subscriptions = []
        # The mqtt_as internals Thingstudio's redeploy cleanup touches (mqtt-shared.ts's <client>_stop).
        self._has_connected = False
        self._isconnected = False
        self._tasks = []
        self._sock = None
        self.closed = False
        CLIENTS.append(self)

    def _close(self):
        self.closed = True

    async def connect(self, quick=False):
        self.connect_calls += 1
        if MQTTClient.CONNECT_DELAY_S:
            await asyncio.sleep(MQTTClient.CONNECT_DELAY_S)
        print("MQTT_CONNECT server=%s port=%s" % (self.cfg.get("server"), self.cfg.get("port")))
        self.connected = True

    async def publish(self, topic, msg, retain=False, qos=0):
        if qos not in (0, 1):
            raise ValueError("Only qos 0 and 1 are supported.")
        PUBLISHED.append({"topic": topic, "payload": msg, "retain": retain, "qos": qos, "server": self.cfg.get("server"), "port": self.cfg.get("port")})
        print("MQTT_PUBLISH topic=%r payload=%r retain=%s qos=%s" % (topic, msg, retain, qos))

    async def subscribe(self, topic, qos=0):
        self.subscriptions.append((topic, qos))
        print("MQTT_SUBSCRIBE topic=%r qos=%s" % (topic, qos))

    def isconnected(self):
        return self.connected
