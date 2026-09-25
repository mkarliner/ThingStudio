// mqtt-shared.ts's connect path on ESP32 (2026-09-25, experiment): the generated code joins WiFi itself
// before mqtt_as's connect() (whose vendored wifi_connect() now returns early when already connected), and
// no longer disconnect()s between attempts -- that wedged the ESP32-C3's WiFi driver. Checked at the text
// level: the pymock network/mqtt_as fixtures don't model ESP-IDF's refusals, and the rest of the generated
// code is run for real by node-mqtt-publish.test.ts/node-mqtt-subscribe.test.ts.

import { describe, expect, it } from "vitest";
import { mqttEnsureConnectedSnippet } from "../src/node-library/mqtt-shared.js";

const cfg = { broker: "broker.local", port: 1883, ssid: "net", wifiPassword: "pw", username: "", password: "" };
const lines = mqttEnsureConnectedSnippet(cfg, "n1").split("\n");
const at = (text: string) => lines.findIndex((l) => l.includes(text));

describe("mqtt connect on ESP32", () => {
  it("joins WiFi with the flow's credentials before mqtt_as connects", () => {
    const gate = at('if sys.platform == "esp32" and not _mqtt_wifi_precheck_sta.isconnected():');
    const join = at('_mqtt_wifi_precheck_sta.connect("net", "pw")');
    const mqttConnect = at(".connect()");
    expect(gate).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(gate);
    expect(mqttConnect).toBeGreaterThan(join);
  });

  it("doesn't disconnect the station between attempts", () => {
    expect(at("disconnect()")).toBe(-1);
  });

  it("reports every attempt's error with the station status", () => {
    expect(at("wifi status %s")).toBeGreaterThan(-1);
    expect(at('"mqtt connect to %s:%s failed after 3 attempts (%s)"')).toBeGreaterThan(-1);
  });
});
