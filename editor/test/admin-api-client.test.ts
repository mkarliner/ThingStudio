// Tests for the backend admin-API fetch client
// (../src/flow-file/admin-api-client.ts). No real network or backend
// process involved: global fetch is replaced with a vi.fn() mock per test
// (vi.stubGlobal, restored via vi.unstubAllGlobals in afterEach) -- same
// "fake the browser API, exercise the real logic on top of it" approach
// backend-transport.test.ts's FakeWebSocket and test/transport.test.ts
// already take for their own browser APIs.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  backendHttpBaseUrl,
  deleteCustomNode,
  deleteFlow,
  deletePreset,
  getPreset,
  listCustomNodes,
  listFlows,
  listPresets,
  putPreset,
  readCustomNode,
  readFlow,
  slugifyFlowName,
  writeCustomNode,
  writeFlow,
} from "../src/flow-file/admin-api-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("backendHttpBaseUrl", () => {
  it("swaps ws:// for http:// and strips a trailing /ws", () => {
    expect(backendHttpBaseUrl("ws://127.0.0.1:8765/ws")).toBe("http://127.0.0.1:8765");
  });

  it("swaps wss:// for https://", () => {
    expect(backendHttpBaseUrl("wss://example.com:8765/ws")).toBe("https://example.com:8765");
  });

  it("leaves a URL with no /ws suffix alone besides the scheme swap", () => {
    expect(backendHttpBaseUrl("ws://127.0.0.1:8765")).toBe("http://127.0.0.1:8765");
  });

  it("throws AdminApiError for an unparseable URL", () => {
    expect(() => backendHttpBaseUrl("not a url")).toThrow(AdminApiError);
  });

  it("throws AdminApiError for a non-ws(s) scheme", () => {
    expect(() => backendHttpBaseUrl("http://127.0.0.1:8765/ws")).toThrow(AdminApiError);
  });
});

describe("slugifyFlowName", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugifyFlowName("My Cool Flow")).toBe("my-cool-flow");
  });

  it("collapses runs of invalid characters into one dash and trims leading/trailing dashes", () => {
    expect(slugifyFlowName("  we!rd///na**me  ")).toBe("we-rd-na-me");
  });

  it("falls back to 'untitled' when nothing valid remains", () => {
    expect(slugifyFlowName("   ***   ")).toBe("untitled");
    expect(slugifyFlowName("")).toBe("untitled");
  });

  it("truncates to 100 characters", () => {
    expect(slugifyFlowName("a".repeat(150)).length).toBe(100);
  });

  it("passes already-valid names through unchanged", () => {
    expect(slugifyFlowName("already_valid-name123")).toBe("already_valid-name123");
  });
});

describe("listFlows / readFlow / writeFlow / deleteFlow", () => {
  it("listFlows hits GET /api/flows and returns the flows array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flows: ["a", "b"] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listFlows("ws://127.0.0.1:8765/ws");
    expect(result).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/flows", undefined);
  });

  it("readFlow hits GET /api/flows/{name} and returns the raw text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"flowName":"x"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = await readFlow("ws://127.0.0.1:8765/ws", "my-flow");
    expect(text).toBe('{"flowName":"x"}');
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/flows/my-flow", undefined);
  });

  it("readFlow URL-encodes the name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await readFlow("ws://127.0.0.1:8765/ws", "weird name/x");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/flows/weird%20name%2Fx", undefined);
  });

  it("readFlow surfaces the backend's structured error message on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "NODE_ERROR: no saved flow named 'x'" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readFlow("ws://127.0.0.1:8765/ws", "x")).rejects.toThrow(/NODE_ERROR: no saved flow named 'x'/);
  });

  it("readFlow falls back to a generic message when the error body isn't the expected shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 500, statusText: "Internal Server Error" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readFlow("ws://127.0.0.1:8765/ws", "x")).rejects.toThrow(/HTTP 500/);
  });

  it("writeFlow PUTs the raw text with an application/json Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await writeFlow("ws://127.0.0.1:8765/ws", "my-flow", '{"flowName":"x"}');
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/flows/my-flow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"flowName":"x"}',
    });
  });

  it("writeFlow throws AdminApiError on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "NODE_ERROR: bad" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(writeFlow("ws://127.0.0.1:8765/ws", "my-flow", "{}")).rejects.toThrow(AdminApiError);
  });

  it("deleteFlow issues a DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteFlow("ws://127.0.0.1:8765/ws", "my-flow");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/flows/my-flow", { method: "DELETE" });
  });

  it("a fetch()-level failure (network/CORS) becomes an AdminApiError naming the backend URL", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listFlows("ws://127.0.0.1:8765/ws")).rejects.toThrow(/could not reach backend at http:\/\/127\.0\.0\.1:8765/);
  });
});

describe("listCustomNodes / readCustomNode / writeCustomNode / deleteCustomNode", () => {
  it("listCustomNodes hits GET /api/custom-nodes and returns the customNodes array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ customNodes: ["dht22"] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listCustomNodes("ws://127.0.0.1:8765/ws");
    expect(result).toEqual(["dht22"]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/custom-nodes", undefined);
  });

  it("readCustomNode returns the descriptor/implementation pair", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ descriptor: '{"type":"custom/dht22"}', implementation: "def read(): pass" }));
    vi.stubGlobal("fetch", fetchMock);
    const pkg = await readCustomNode("ws://127.0.0.1:8765/ws", "dht22");
    expect(pkg).toEqual({ descriptor: '{"type":"custom/dht22"}', implementation: "def read(): pass" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/custom-nodes/dht22", undefined);
  });

  it("writeCustomNode PUTs a JSON body with descriptor and implementation fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await writeCustomNode("ws://127.0.0.1:8765/ws", "dht22", "{}", "pass");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/custom-nodes/dht22", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptor: "{}", implementation: "pass" }),
    });
  });

  it("deleteCustomNode issues a DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteCustomNode("ws://127.0.0.1:8765/ws", "dht22");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/custom-nodes/dht22", { method: "DELETE" });
  });

  it("readCustomNode surfaces a 404 as a NODE_ERROR-prefixed message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "NODE_ERROR: no saved custom node named 'dht22'" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readCustomNode("ws://127.0.0.1:8765/ws", "dht22")).rejects.toThrow(/NODE_ERROR: no saved custom node named 'dht22'/);
  });
});

describe("listPresets / getPreset / putPreset / deletePreset", () => {
  it("listPresets hits GET /api/presets/{type} and returns the presets array, valid/error flags included", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        presets: [
          { name: "cyd", valid: true, error: null },
          { name: "broken", valid: false, error: "not valid JSON: ..." },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await listPresets("ws://127.0.0.1:8765/ws", "display_spi");
    expect(result).toEqual([
      { name: "cyd", valid: true, error: null },
      { name: "broken", valid: false, error: "not valid JSON: ..." },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/presets/display_spi", undefined);
  });

  it("listPresets URL-encodes the preset type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ presets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listPresets("ws://127.0.0.1:8765/ws", "weird type/x");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/presets/weird%20type%2Fx", undefined);
  });

  it("getPreset returns the parsed JSON object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ controller: "st7789", sck: 12 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await getPreset("ws://127.0.0.1:8765/ws", "display_spi", "cyd");
    expect(data).toEqual({ controller: "st7789", sck: 12 });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/presets/display_spi/cyd", undefined);
  });

  it("getPreset surfaces a 400 for a hand-edited broken preset as a NODE_ERROR-prefixed message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "NODE_ERROR: display_spi preset 'broken' (hand-edited file may have a syntax error) is not valid JSON: ..." }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPreset("ws://127.0.0.1:8765/ws", "display_spi", "broken")).rejects.toThrow(/hand-edited file may have a syntax error/);
  });

  it("putPreset PUTs a JSON-serialized body with an application/json Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await putPreset("ws://127.0.0.1:8765/ws", "display_spi", "cyd", { controller: "st7789", sck: 12 });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/presets/display_spi/cyd", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controller: "st7789", sck: 12 }),
    });
  });

  it("putPreset throws AdminApiError on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "NODE_ERROR: bad" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(putPreset("ws://127.0.0.1:8765/ws", "display_spi", "cyd", {})).rejects.toThrow(AdminApiError);
  });

  it("deletePreset issues a DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await deletePreset("ws://127.0.0.1:8765/ws", "display_spi", "cyd");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/api/presets/display_spi/cyd", { method: "DELETE" });
  });
});
