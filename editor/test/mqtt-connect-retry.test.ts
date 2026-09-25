// ESP32 + MQTT WiFi join (2026-09-25, experiment): the flow joins WiFi at start -- the same connect() a flow
// without MQTT runs, which works on the ESP32-C3 bench where the same call inside the MQTT coroutine didn't --
// and the MQTT connect path only waits for the link, then hands over to mqtt_as (whose vendored
// wifi_connect() skips its own connect() once joined). Checked at the text level: the pymock network/mqtt_as
// fixtures don't model ESP-IDF, and the rest of the generated code is run by the node-mqtt-* tests.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { mqttEnsureConnectedSnippet, mqttSetupStatement } from "../src/node-library/mqtt-shared.js";
import { wifiSetupStatement } from "../src/node-library/wifi-status.js";

const cfg = { broker: "broker.local", port: 1883, ssid: "net", wifiPassword: "pw", username: "", password: "" };
const lines = mqttEnsureConnectedSnippet(cfg, "n1").split("\n");
const at = (text: string) => lines.findIndex((l) => l.includes(text));

describe("ESP32 + MQTT WiFi join", () => {
  it("joins at flow start on ESP32 when MQTT owns the connection", () => {
    const code = wifiSetupStatement("net", "pw", "password", true).code;
    expect(code).toContain('if sys.platform == "esp32" and not _wifi_sta.isconnected():');
    expect(code).toContain('_wifi_sta.connect("net", "pw")');
  });

  it("the MQTT connect path only waits: no connect() or disconnect() of its own", () => {
    expect(at("_mqtt_wifi_precheck_sta.connect(")).toBe(-1);
    expect(at("disconnect()")).toBe(-1);
    expect(at("NET_INFO mqtt: waiting for WiFi")).toBeLessThan(at("for _mqtt_connect_attempt_"));
  });

  it("reports every attempt's error with the station status", () => {
    expect(at("wifi status %s")).toBeGreaterThan(-1);
    expect(at('"mqtt connect to %s:%s failed after 3 attempts (%s)"')).toBeGreaterThan(-1);
  });

  it("explains the broker's refusal codes", () => {
    expect(at('("0x5", "not authorised')).toBeGreaterThan(-1);
    expect(at('("0x4", "bad username or password')).toBeGreaterThan(-1);
  });

  it("registers a redeploy cleanup that stops the client (no second client with the same ID)", () => {
    const setup = mqttSetupStatement(cfg).code;
    expect(setup).toContain("def _mqtt_client_");
    expect(setup).toContain("c._has_connected = False");
    expect(setup).toContain('c._sock.write(b"\\xe0\\0")');
    expect(setup).toMatch(/runtime\.register_cleanup\("mqtt-_mqtt_client_[^"]+", _mqtt_client_\w+_stop\)/);
  });

  it("a flow with MQTT but no wifi_status still gets the join", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "x" } },
        { id: "2", type: "thingstudio/mqtt_publish", properties: { topic: "t", retain: false, qos: 0, brokerConfigId: "b1" } },
      ],
      links: [[1, "1", 0, "2", 0, "any"]],
      configs: [
        { id: "w1", type: "thingstudio/config/wifi", properties: { ssid: "HomeNet", password: "secret12", security: "password" } },
        { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "broker.local", port: 1883 } },
      ],
    };
    expect(compile(graph, buildRegistry()).source).toContain('_wifi_sta.connect("HomeNet", "secret12")');
  });
});
