import { describe, expect, it } from "vitest";
import { nodeLabel } from "../src/gui/screens.js";

const n = (properties: Record<string, unknown>) => ({ id: "abcdef123", type: "thingstudio/gui_button", properties }) as never;

describe("nodeLabel", () => {
  it("names a node by the label the user gave it, then its name, then its kind and id", () => {
    expect(nodeLabel(n({ label: "Fire!", name: "fire" }))).toBe('"Fire!"');
    expect(nodeLabel(n({ label: " ", name: "fire" }))).toBe('"fire"');
    expect(nodeLabel(n({}))).toBe("gui_button abcdef");
  });
});
