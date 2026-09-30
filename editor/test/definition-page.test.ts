// The "Pins…" page (2026-09-30): src/definitions/definition-page.ts, rendered from the real built-in
// definitions, so the page is checked against what the pin checks actually use.

import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { pinStatus, renderDefinitionPage, renderUnknownBoardPage } from "../src/definitions/definition-page.js";
import { buildDefinitionSet, type RawDefinitionFile } from "../src/definitions/definitions.js";
import { buildTarget, resolveTarget, type Target } from "../src/definitions/target.js";

const defs = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
const OPTS = { generated: "Shown now.", docsUrl: "http://127.0.0.1:8765/docs/boards/" };

function boardTarget(id: string): Target {
  const t = resolveTarget(defs, `board:${id}`, null).target;
  if (!t) throw new Error(`no built-in board ${id}`);
  return t;
}

/** The table row for one GPIO in the "All pins" table, as text. */
function pinRow(html: string, pin: number): string {
  const m = new RegExp(`<tr class="(\\w+)"><td class="gpio">${pin}</td>(.*?)</tr>`).exec(html);
  if (!m) throw new Error(`no row for GPIO ${pin}`);
  return `${m[1]} ${m[2]!.replace(/<[^>]+>/g, "|")}`;
}

describe("pinStatus", () => {
  const esp32 = buildTarget(defs.processors.get("esp32")!, null);

  it("reserved pins say the compile stops, with the definition's reason", () => {
    const s = pinStatus(esp32, 6);
    expect(s.kind).toBe("reserved");
    expect(s.status).toBe("Reserved: the compile stops");
    expect(s.why).toContain("flash chip");
  });

  it("pins to avoid say the compile warns, and keep any other limit", () => {
    expect(pinStatus(esp32, 12)).toMatchObject({ kind: "avoid", status: "Avoid: the compile warns" });
    expect(pinStatus(esp32, 12).why).toContain("Strapping pin");
  });

  it("input-only pins without pulls are limited, not free", () => {
    expect(pinStatus(esp32, 36)).toEqual({ kind: "limited", status: "Input only, no internal pull-up or pull-down", why: "" });
  });

  it("an ordinary pin is free", () => {
    expect(pinStatus(esp32, 4)).toEqual({ kind: "free", status: "Free", why: "" });
  });
});

describe("renderDefinitionPage", () => {
  it("answers 'where is the LED' for the Pico: named pins first, GPIO 25", () => {
    const html = renderDefinitionPage(boardTarget("pico"), OPTS);
    expect(html).toContain("<h1>Raspberry Pi Pico</h1>");
    const named = html.indexOf("<h2>Named pins</h2>");
    expect(named).toBeGreaterThan(0);
    expect(named).toBeLessThan(html.indexOf("<h2>All pins</h2>"));
    expect(html).toContain("<tr><td>LED</td><td class=\"gpio\">GPIO 25</td>");
    expect(html).toContain("The onboard LED is GPIO 25.");
  });

  it("shows the Pico W's WiFi-chip pins as reserved, with the reason", () => {
    const html = renderDefinitionPage(boardTarget("pico-w"), OPTS);
    expect(pinRow(html, 25)).toMatch(/^reserved .*Reserved: the compile stops.*Wired to the WiFi chip\./);
    expect(html).not.toContain("<h2>Named pins</h2>"); // the Pico W names no pins
    expect(html).toContain("WiFi: yes");
  });

  it("lists every usable GPIO once, plus reserved pins", () => {
    const t = boardTarget("lolin-s2-mini");
    const html = renderDefinitionPage(t, OPTS);
    const rows = [...html.matchAll(/<td class="gpio">(\d+)<\/td>/g)].map((m) => Number(m[1]));
    const expected = [...new Set([...t.gpio, ...t.reserved.keys()])].sort((a, b) => a - b);
    expect(rows).toEqual(expected);
  });

  it("labels a board's named pin in the All pins table too", () => {
    expect(pinRow(renderDefinitionPage(boardTarget("cyd"), OPTS), 2)).toContain("TFT_DC");
  });

  it("shows the bus rules: RP2040's fixed SPI pins, ESP32's fast pins and speed limits", () => {
    const rp = renderDefinitionPage(boardTarget("pico"), OPTS);
    expect(rp).toContain("<h2>SPI</h2>");
    expect(rp).toContain("SCK: 2, 6, 18, 22");
    expect(rp).toContain("<h2>I2C</h2>");
    const esp = renderDefinitionPage(buildTarget(defs.processors.get("esp32")!, null), OPTS);
    expect(esp).toContain("Up to 80 MHz, up to 27 MHz on other pins.");
    expect(esp).toContain("Any pins. Fastest on SCK 14, MOSI 13, MISO 12");
  });

  it("a processor-only target says 'any board' and names only the processor file", () => {
    const html = renderDefinitionPage(buildTarget(defs.processors.get("rp2040")!, null), OPTS);
    expect(html).toContain("<h1>RP2040 (any board)</h1>");
    expect(html).toContain("<code>~/.thingstudio/processors/rp2040.json</code>. Edit it");
    expect(html).not.toContain("WiFi:");
  });

  it("names both files for a board, and links the docs by absolute URL", () => {
    const html = renderDefinitionPage(boardTarget("pico"), OPTS);
    expect(html).toContain("<code>~/.thingstudio/boards/pico.json</code> and <code>~/.thingstudio/processors/rp2040.json</code>");
    expect(html).toContain('href="http://127.0.0.1:8765/docs/boards/"');
  });

  it("escapes everything from a hand-written file", () => {
    const user: RawDefinitionFile[] = [
      {
        kind: "board",
        id: "evil",
        source: "~/.thingstudio/boards/evil.json",
        data: { name: "<script>alert(1)</script>", processor: "rp2040", match: [], pins: { "<b>X</b>": 3 }, notes: "a & b < c" },
      },
    ];
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, user);
    const html = renderDefinitionPage(resolveTarget(set, "board:evil", null).target!, OPTS);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &amp; b &lt; c");
  });
});

describe("boards Thingstudio doesn't fully know (2026-09-30)", () => {
  const chip = "WeAct Studio RP2040 with RP2040";

  it("Auto finds the processor only: the page says the board's own pins are missing", () => {
    const r = resolveTarget(defs, "auto", chip);
    expect(r.how).toBe("detected");
    expect(r.target?.board).toBeNull();
    const html = renderDefinitionPage(r.target!, { ...OPTS, unlistedBoard: chip });
    expect(html).toContain("Your board isn't in Thingstudio's list.");
    expect(html).toContain(`<code>${chip}</code>`);
    expect(html).toContain("<code>~/.thingstudio/boards/weact-studio-rp2040.json</code>");
    expect(html).toContain('href="http://127.0.0.1:8765/docs/boards/#adding-a-board"');
    // The notice comes before the pin tables, and the pins are still the processor's.
    expect(html.indexOf("isn't in Thingstudio's list")).toBeLessThan(html.indexOf("<h2>All pins</h2>"));
    expect(html).toContain("<h1>RP2040 (any board)</h1>");
  });

  it("the example board file on that page is one Thingstudio accepts, and then recognises the board", () => {
    const html = renderDefinitionPage(resolveTarget(defs, "auto", chip).target!, { ...OPTS, unlistedBoard: chip });
    const json = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const set = buildDefinitionSet(BUILTIN_DEFINITION_FILES, [
      { kind: "board", id: "weact-studio-rp2040", source: "~/.thingstudio/boards/weact-studio-rp2040.json", data: JSON.parse(json) },
    ]);
    expect(set.problems).toEqual([]);
    expect(resolveTarget(set, "auto", chip).target?.board?.id).toBe("weact-studio-rp2040");
  });

  it("no notice for a processor picked by hand, or a known board", () => {
    const picked = renderDefinitionPage(buildTarget(defs.processors.get("rp2040")!, null), OPTS);
    expect(picked).not.toContain("isn't in Thingstudio's list");
    expect(renderDefinitionPage(boardTarget("pico"), { ...OPTS, unlistedBoard: chip })).not.toContain("isn't in Thingstudio's list");
  });

  it("an unknown processor gets a page saying what it reports and what to add", () => {
    const unknown = "Some <Board> with STM32F405";
    expect(resolveTarget(defs, "auto", unknown).target).toBeNull();
    const html = renderUnknownBoardPage(unknown, OPTS);
    expect(html).toContain("<h1>Unknown board</h1>");
    expect(html).toContain("<code>Some &lt;Board&gt; with STM32F405</code>");
    expect(html).toContain("no definition for its processor (<code>STM32F405</code>)");
    expect(html).toContain('href="http://127.0.0.1:8765/docs/boards/#adding-a-processor"');
    expect(html).not.toContain("<Board>");
  });
});
