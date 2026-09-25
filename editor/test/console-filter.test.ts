import { describe, expect, it } from "vitest";
import { isVerboseOnly } from "../src/app/console-filter.js";

describe("console Verbose switch", () => {
  it("hides routine system reports", () => {
    for (const line of [
      "NET_INFO mqtt: waiting for WiFi, station status 1001",
      "NET_LISTENING 192.168.10.247:7462 (esp-2.local)",
      "LISTENER_READY",
      "NODE_STATUS node=26e0 state=connected text=192.168.10.247",
      '[HELLO] {"type":"HELLO"}',
      '[NODE_STATUS] {"type":"NODE_STATUS"}',
      '[DEPLOY_ACK] {"type":"DEPLOY_ACK"}',
    ]) {
      expect(isVerboseOnly(line), line).toBe(true);
    }
  });

  it("always shows flow output, warnings, errors and the editor's own notes", () => {
    for (const line of [
      "DEBUG node=4ab9 msg={'payload': True}",
      "hello from print()",
      "NET_WARN dropped 40 bytes of output",
      "NODE_ERROR node=657a type=OSError msg=...",
      '[NODE_ERROR] {"type":"NODE_ERROR"}',
      "E (25385) wifi:sta is connecting, cannot set config",
      "[deploy OK -- flow is running on the device]",
      "[flow status] no flow currently running on this board",
    ]) {
      expect(isVerboseOnly(line), line).toBe(false);
    }
  });

  it("never hides a line logged as an error", () => {
    expect(isVerboseOnly("NET_INFO something", "err")).toBe(false);
  });
});
