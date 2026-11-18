// SPDX-License-Identifier: Apache-2.0
// editor/test/saved-values.test.ts
//
// The online editor's credentials, kept for the browser tab (src/app/rete/saved-values.ts, 2026-11-18).
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedValueMissing, forgetSavedValues, hasSavedCredential, tabStoreForTests as store } from "../src/app/rete/saved-values.js";

function fakeSessionStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

afterEach(() => {
  forgetSavedValues();
  vi.unstubAllGlobals();
});

describe("saved values in a browser tab", () => {
  it("keeps a credential in sessionStorage, so it survives a reload of the page", async () => {
    const ss = fakeSessionStorage();
    vi.stubGlobal("sessionStorage", ss);
    await store.put("credential", "wifi", "home", { ssid: "net", password: "pw" });
    expect([...ss.data.keys()]).toEqual(["thingstudio.savedValues"]);
    expect(store.get("credential", "wifi", "home")).toEqual({ ssid: "net", password: "pw" });
    expect(store.names("credential", "wifi")).toEqual(["home"]);
    expect(hasSavedCredential("wifi", "home")).toBe(true);
  });

  it("forgets everything at once", async () => {
    vi.stubGlobal("sessionStorage", fakeSessionStorage());
    await store.put("credential", "wifi", "a", { ssid: "x" });
    await store.put("credential", "mqtt-broker", "b", { broker: "y" });
    expect(forgetSavedValues()).toBe(2);
    expect(() => store.get("credential", "wifi", "a")).toThrow(SavedValueMissing);
  });

  it("falls back to page memory where sessionStorage throws", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    });
    await store.put("credential", "wifi", "m", { ssid: "z" });
    expect(store.get("credential", "wifi", "m")).toEqual({ ssid: "z" });
  });
});
