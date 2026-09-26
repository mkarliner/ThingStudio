// Singleton config types (config-types.ts's `singleton`, 2026-09-25 -- WiFi): creating one when one
// already exists hands back the existing instance, so every node asking for "a WiFi config" gets the same one.

import { beforeEach, describe, expect, it } from "vitest";
import { clearConfigs, createConfig, listConfigsOfType, nextFreeKey } from "../src/app/rete/store.js";

const WIFI = "thingstudio/config/wifi";
const BROKER = "thingstudio/config/mqtt-broker";

beforeEach(() => clearConfigs());

describe("singleton config types", () => {
  it("returns the existing WiFi config instead of adding a second", () => {
    const a = createConfig(WIFI, { credentialName: "home", security: "password" });
    const b = createConfig(WIFI, { credentialName: "office", security: "password" });
    expect(b).toBe(a);
    expect(listConfigsOfType(WIFI)).toHaveLength(1);
    expect(listConfigsOfType(WIFI)[0]!.properties.credentialName).toBe("office");
  });

  it("switching network starts clean, so the old network's fetched values don't linger", () => {
    const id = createConfig(WIFI, { credentialName: "home" });
    listConfigsOfType(WIFI)[0]!.properties.ssid = "HomeNet"; // as main.ts's credential fetch would
    createConfig(WIFI, { credentialName: "office" });
    expect(listConfigsOfType(WIFI)[0]!.id).toBe(id);
    expect(listConfigsOfType(WIFI)[0]!.properties.ssid).toBeUndefined();
  });

  it("picking the same network again keeps its fetched values", () => {
    createConfig(WIFI, { credentialName: "home" });
    listConfigsOfType(WIFI)[0]!.properties.ssid = "HomeNet";
    createConfig(WIFI, { credentialName: "home", security: "password" });
    expect(listConfigsOfType(WIFI)[0]!.properties.ssid).toBe("HomeNet");
  });

  it("leaves non-singleton types alone", () => {
    const a = createConfig(BROKER, { credentialName: "one" });
    const b = createConfig(BROKER, { credentialName: "two" });
    expect(b).not.toBe(a);
    expect(listConfigsOfType(BROKER)).toHaveLength(2);
  });
});

describe("keyed singleton config types (I2C bus)", () => {
  const I2C = "thingstudio/config/i2c-bus";

  it("one config per bus number: the same bus hands back the existing one", () => {
    const a = createConfig(I2C, { bus: 0, scl: 22, sda: 21 });
    const b = createConfig(I2C, { bus: "0", scl: 5, sda: 4 });
    const c = createConfig(I2C, { bus: 1, scl: 9, sda: 8 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(listConfigsOfType(I2C)).toHaveLength(2);
  });

  it("nextFreeKey picks the lowest unused bus", () => {
    expect(nextFreeKey(I2C, "bus")).toBe(0);
    createConfig(I2C, { bus: 0 });
    createConfig(I2C, { bus: 2 });
    expect(nextFreeKey(I2C, "bus")).toBe(1);
  });
});
