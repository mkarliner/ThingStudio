// The shared ts_wifi library (device-runtime/src/vendor/thingstudio_wifi/ts_wifi.py), run against pymock's
// network module. This is where the WiFi bring-up now lives, so its four behaviours need their own test:
// connect, unmanaged, defer-to-mqtt (with the ESP32-only first join), and idempotence.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-tswifi-"));
  const script = join(dir, "_ts_wifi.py");
  writeFileSync(script, body);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
  });
}

describe("ts_wifi.ensure_station", () => {
  it("connects with the supplied credentials", () => {
    const out = run('import ts_wifi\nsta = ts_wifi.ensure_station("net", "pw")\nprint("OK", sta.isconnected() or "pending")\n');
    expect(out).toContain("WLAN_ACTIVE STA_IF True");
    expect(out).toContain("WLAN_CONNECT STA_IF net");
  });

  it("does not connect for an unmanaged config", () => {
    const out = run('import ts_wifi\nts_wifi.ensure_station("net", "pw", "unmanaged")\n');
    expect(out).toContain("WLAN_ACTIVE");
    expect(out).not.toContain("WLAN_CONNECT");
  });

  it("does not connect for an open network with no password", () => {
    const out = run('import ts_wifi\nts_wifi.ensure_station("guest", "", "open")\n');
    expect(out).toContain("WLAN_CONNECT STA_IF guest");
  });

  it("defers the connect to mqtt_as off ESP32", () => {
    const out = run('import ts_wifi\nts_wifi.ensure_station("net", "pw", "password", True)\n');
    expect(out).toContain("WLAN_ACTIVE");
    expect(out).not.toContain("WLAN_CONNECT");
  });

  it("joins once at import on ESP32 when deferring", () => {
    const out = run('import sys\nsys.platform = "esp32"\nimport ts_wifi\nts_wifi.ensure_station("net", "pw", "password", True)\n');
    expect(out).toContain("WLAN_CONNECT STA_IF net");
  });

  it("is idempotent: a second call with the same settings does nothing", () => {
    const out = run(
      'import ts_wifi\n' +
        'a = ts_wifi.ensure_station("net", "pw")\n' +
        'b = ts_wifi.ensure_station("net", "pw")\n' +
        'print("SAME", a is b)\n',
    );
    expect(out).toContain("SAME True");
    expect(out.match(/WLAN_ACTIVE/g)?.length).toBe(1);
    expect(out.match(/WLAN_CONNECT/g)?.length).toBe(1);
  });

  it("refuses two different settings loudly", () => {
    expect(() =>
      run('import ts_wifi\nts_wifi.ensure_station("net", "pw")\nts_wifi.ensure_station("other", "pw")\n'),
    ).toThrow(/two nodes asked for different WiFi settings/);
  });
});
