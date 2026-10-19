// visibleConfigProperties is the one redaction used by the save path, the editor's hook contexts and the CLI's,
// so secrets cannot differ between producers (review finding 2).

import { describe, expect, it } from "vitest";
import { visibleConfigProperties } from "../src/app/rete/config-types.js";

describe("visibleConfigProperties", () => {
  it("keeps only the WiFi config's declared fields, dropping resolved secrets", () => {
    expect(
      visibleConfigProperties("thingstudio/config/wifi", {
        credentialName: "home",
        security: "password",
        ssid: "net",
        password: "secret",
      }),
    ).toEqual({ credentialName: "home", security: "password" });
  });

  it("passes an unknown config type through unchanged (fail open, as the save path does)", () => {
    expect(visibleConfigProperties("custom/thing", { a: 1 })).toEqual({ a: 1 });
  });
});
