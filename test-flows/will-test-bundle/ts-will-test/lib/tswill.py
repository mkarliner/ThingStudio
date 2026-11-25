# The library half of the will_test bundle: what ts_ha will do for a Home Assistant device, minus discovery.
# A retained "offline" Last Will on the availability topic, a retained "online" on every connect, and a
# subscription so something calls ensure_connected() about once a second and notices a reconnect.

import asyncio
import runtime


class Announcer:
    def __init__(self, client, node_id, topic):
        self.client = client
        self.node_id = node_id
        self.topic = topic
        self.count = 0
        self.event = asyncio.Event()
        self.watcher = None
        client.set_will(topic, b'offline', True, 1)
        client.on_connect(self._online)
        runtime.register_cleanup('tswill-' + node_id, self._stop)

    async def _online(self):
        self.count += 1
        await self.client.publish(self.node_id, self.topic, b'online', True, 1)
        self.event.set()

    async def _watch(self):
        while True:
            await self.client.wait_message(self.node_id)

    def _stop(self):
        if self.watcher is not None:
            self.watcher.cancel()
            self.watcher = None

    async def wait_connect(self):
        """Returns once per connect: the first one, then each reconnect."""
        if self.watcher is None:
            await self.client.ensure_connected(self.node_id)
            await self.client.subscribe(self.node_id, self.topic + '/ping', 0)
            self.watcher = asyncio.create_task(self._watch())
        await self.event.wait()
        self.event.clear()
