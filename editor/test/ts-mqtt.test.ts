// The shared ts_mqtt library (device-runtime/src/vendor/thingstudio_mqtt/ts_mqtt.py), run against pymock's
// mqtt_as/network/runtime fixtures. Covers the behaviour the old mqtt-shared.ts codegen had (one client per
// broker, one connect across racing nodes, the WiFi wait, the retry/reason text, redeploy cleanup) plus the new
// per-node subscription registry (routing, last-node unsubscribe, resubscribe on reconnect).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-tsmqtt-"));
  const script = join(dir, "_ts_mqtt.py");
  writeFileSync(script, body);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

const PRELUDE = "import asyncio\nimport mqtt_as\nimport runtime\nimport ts_mqtt\n";
const CLIENT = "ts_mqtt.ensure_client('b', 1883, 'net', 'pw', 'password', '', '')\n";

describe("ts_mqtt library", () => {
  it("the pymock fixture is a byte-identical copy of the vendored library", () => {
    const fixture = readFileSync(join(__dirname, "fixtures", "pymock", "ts_mqtt.py"));
    const vendor = readFileSync(join(__dirname, "../../device-runtime/src/vendor/thingstudio_mqtt/ts_mqtt.py"));
    expect(fixture.equals(vendor)).toBe(true);
  });

  it("one client per broker, shared by every caller", () => {
    const out = run(PRELUDE + "a = " + CLIENT + "b = " + CLIENT + "print('SAME', a is b)\n");
    expect(out).toContain("SAME True");
  });

  it("refuses two different settings for one broker loudly", () => {
    expect(() =>
      run(PRELUDE + CLIENT + "ts_mqtt.ensure_client('b', 1883, 'net', 'other', 'password', '', '')\n"),
    ).toThrow(/two nodes asked for different settings/);
  });

  it("two nodes racing to connect only actually connect once, and each reports its own status", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "mqtt_as.MQTTClient.CONNECT_DELAY_S = 0.05\n" +
        "async def _main():\n" +
        "    await asyncio.gather(c.ensure_connected('n1'), c.ensure_connected('n2'))\n" +
        "    print('CONNECT_CALLS', mqtt_as.CLIENTS[-1].connect_calls)\n" +
        "asyncio.run(_main())\n",
    );
    expect(out).toContain("CONNECT_CALLS 1");
    expect(out).toContain("NODE_STATUS node=n1 state=connected");
    expect(out).toContain("NODE_STATUS node=n2 state=connected");
  });

  it("routes an incoming message to every node whose subscription matches, and no other", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "async def _main():\n" +
        "    await c.ensure_connected('n1')\n" +
        "    await c.subscribe('n1', 'a/#', 0)\n" +
        "    await c.subscribe('n2', 'a/b', 0)\n" +
        "    c.client.queue._inject(b'a/b', b'one', False)\n" +
        "    print('N1', await asyncio.wait_for(c.wait_message('n1'), 2))\n" +
        "    print('N2', await asyncio.wait_for(c.wait_message('n2'), 2))\n" +
        "    c.client.queue._inject(b'a/c', b'two', False)\n" +
        "    print('N1B', await asyncio.wait_for(c.wait_message('n1'), 2))\n" +
        "    try:\n" +
        "        await asyncio.wait_for(c.wait_message('n2'), 0.3)\n" +
        "        print('N2B UNEXPECTED')\n" +
        "    except asyncio.TimeoutError:\n" +
        "        print('N2B EMPTY')\n" +
        "asyncio.run(_main())\n",
    );
    expect(out).toContain("N1 (b'a/b', b'one', False)");
    expect(out).toContain("N2 (b'a/b', b'one', False)");
    expect(out).toContain("N1B (b'a/c', b'two', False)");
    expect(out).toContain("N2B EMPTY");
  });

  it("resubscribes at a higher qos when a second node asks for one", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "async def _main():\n" +
        "    await c.ensure_connected('n1')\n" +
        "    await c.subscribe('n1', 't', 0)\n" +
        "    await c.subscribe('n2', 't', 1)\n" +
        "    print('SUBS', c.client.subscriptions)\n" +
        "asyncio.run(_main())\n",
    );
    expect(out).toContain("SUBS [('t', 0), ('t', 1)]");
  });

  it("sends the broker an UNSUBSCRIBE only when the last node lets go of a topic", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "async def _main():\n" +
        "    await c.ensure_connected('n1')\n" +
        "    await c.subscribe('n1', 't', 0)\n" +
        "    await c.subscribe('n2', 't', 0)\n" +
        "    await c.unsubscribe('n1', 't')\n" +
        "    print('AFTER1', c.client.subscriptions)\n" +
        "    await c.unsubscribe('n2', 't')\n" +
        "    print('AFTER2', c.client.subscriptions)\n" +
        "asyncio.run(_main())\n",
    );
    expect(out).toContain("AFTER1 [('t', 0)]");
    expect(out.match(/MQTT_UNSUBSCRIBE/g)?.length).toBe(1);
  });

  it("leaves a link blip to mqtt_as, and resubscribes when it comes back", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "async def _main():\n" +
        "    await c.ensure_connected('n1')\n" +
        "    await c.subscribe('n1', 't', 0)\n" +
        "    c.client.connected = False\n" +
        "    await c.ensure_connected('n1')\n" +
        "    print('CONNECTS', mqtt_as.CLIENTS[-1].connect_calls)\n" +
        "    print('DOWN', c.link_up)\n" +
        "    c.client.connected = True\n" +
        "    await c.ensure_connected('n1')\n" +
        "    print('SUBS2', c.client.subscriptions)\n" +
        "asyncio.run(_main())\n",
    );
    expect(out).toContain("CONNECTS 1");
    expect(out).toContain("DOWN False");
    expect(out.match(/MQTT_SUBSCRIBE topic='t'/g)?.length).toBe(2);
  });

  it("registers a redeploy cleanup that stops the client", () => {
    const out = run(
      PRELUDE +
        "c = " + CLIENT +
        "async def _main():\n" +
        "    await c.ensure_connected('n1')\n" +
        "asyncio.run(_main())\n" +
        "runtime._cleanups['mqtt-b-1883']()\n" +
        "print('STOPPED', mqtt_as.CLIENTS[-1]._has_connected)\n" +
        "print('CLIENTS', ts_mqtt._clients)\n",
    );
    expect(out).toContain("STOPPED False");
    expect(out).toContain("CLIENTS {}");
  });

  it("keeps the connect path's WiFi wait, bounded retries and refusal explanations", () => {
    const source = readFileSync(join(__dirname, "../../device-runtime/src/vendor/thingstudio_mqtt/ts_mqtt.py"), "utf8");
    expect(source).toContain("NET_INFO mqtt: waiting for WiFi");
    expect(source).toContain("for attempt in range(3):");
    expect(source).toContain("bad username or password");
    expect(source).toContain("not authorised");
    expect(source).toContain("failed after 3 attempts");
  });
});
