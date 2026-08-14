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
    def __init__(self, cfg):
        self.cfg = dict(cfg)
        self.connected = False
        self.queue = _MsgQueue()
        self.subscriptions = []
        CLIENTS.append(self)

    async def connect(self, quick=False):
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
