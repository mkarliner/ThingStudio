// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/definition-page.ts
//
// A readable page for the board or processor a flow is for (Mike, 2026-09-30, mikes-questions-and-
// points.md: "a button by the board and processor drop downs that will show a human readable page of
// their definitions, so I don't have to guess where the led is"). The toolbar's "Pins…" button opens it in
// a new tab, so it can sit beside the editor while wiring.
//
// Built from the resolved Target (target.ts), the same object the pin checks read, so the page and the
// compile always agree: a pin the page calls reserved is one the compile stops on. Named pins come first,
// since "which pin is the LED" is the usual question.
//
// Pure: returns an HTML string, touches no DOM, so it's unit-tested (test/definition-page.test.ts).
// Everything taken from a definition file is escaped: those files are hand-written.

import { formatPinSet, type ProcessorDef } from "./definitions.js";
import { splitChipType, type Target } from "./target.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One GPIO's status on this target, in the words the page uses. `kind` drives the row colour. */
export interface PinStatus {
  readonly kind: "reserved" | "avoid" | "limited" | "free";
  readonly status: string;
  readonly why: string;
}

export function pinStatus(target: Target, pin: number): PinStatus {
  const reserved = target.reserved.get(pin);
  if (reserved !== undefined) return { kind: "reserved", status: "Reserved: the compile stops", why: reserved };
  const avoid = target.avoid.get(pin);
  const limits: string[] = [];
  if (target.inputOnly.has(pin)) limits.push("input only");
  if (target.noPull.has(pin)) limits.push("no internal pull-up or pull-down");
  if (avoid !== undefined) {
    return { kind: "avoid", status: "Avoid: the compile warns", why: [avoid, ...limits.map((l) => `Also ${l}.`)].join(" ") };
  }
  if (limits.length > 0) {
    const text = limits.join(", ");
    return { kind: "limited", status: text.charAt(0).toUpperCase() + text.slice(1), why: "" };
  }
  return { kind: "free", status: "Free", why: "" };
}

function spiSection(proc: ProcessorDef): string {
  if (!proc.spi) return "";
  const rows: string[] = [];
  for (const [bus, def] of [...proc.spi.buses].sort((a, b) => a[0] - b[0])) {
    let pins = "Any pins";
    if (def.pins) {
      pins = (["sck", "mosi", "miso"] as const)
        .filter((r) => def.pins?.[r])
        .map((r) => `${r.toUpperCase()}: ${formatPinSet(def.pins![r]!)}`)
        .join("<br>");
    } else if (def.fastPins) {
      const fast = (["sck", "mosi", "miso"] as const)
        .filter((r) => def.fastPins?.[r] !== undefined)
        .map((r) => `${r.toUpperCase()} ${def.fastPins![r]}`)
        .join(", ");
      pins = `Any pins. Fastest on ${fast}`;
    }
    rows.push(`<tr><td>${bus}</td><td>${pins}</td></tr>`);
  }
  const speed: string[] = [];
  if (proc.spi.maxHz) speed.push(`Up to ${formatHz(proc.spi.maxHz)}`);
  if (proc.spi.otherPinsMaxHz) speed.push(`up to ${formatHz(proc.spi.otherPinsMaxHz)} on other pins`);
  return (
    `<h2>SPI</h2>` +
    (speed.length ? `<p>${speed.join(", ")}.</p>` : "") +
    `<table><thead><tr><th>Bus</th><th>Pins</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
  );
}

function i2cSection(proc: ProcessorDef): string {
  if (!proc.i2c) return "";
  const rows: string[] = [];
  for (const [bus, def] of [...proc.i2c.buses].sort((a, b) => a[0] - b[0])) {
    const pins = def.pins
      ? (["sda", "scl"] as const)
          .filter((r) => def.pins?.[r])
          .map((r) => `${r.toUpperCase()}: ${formatPinSet(def.pins![r]!)}`)
          .join("<br>")
      : "Any pins";
    rows.push(`<tr><td>${bus}</td><td>${pins}</td></tr>`);
  }
  return `<h2>I2C</h2><table><thead><tr><th>Bus</th><th>Pins</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function formatHz(hz: number): string {
  return hz >= 1_000_000 ? `${+(hz / 1_000_000).toFixed(1)} MHz` : `${+(hz / 1000).toFixed(1)} kHz`;
}

const STYLE = `
:root { --bg: #ffffff; --fg: #1d2328; --muted: #5d6870; --line: #d9dee2; --head: #f2f4f6;
  --reserved: #fbe3e1; --avoid: #fff3d6; --limited: #e8f1fb; --accent: #2f6f9f; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #16191c; --fg: #e3e7ea; --muted: #9aa5ad; --line: #30363b;
  --head: #1f2327; --reserved: #4a2320; --avoid: #45391a; --limited: #1c3146; --accent: #7fb3dc; color-scheme: dark; } }
body { background: var(--bg); color: var(--fg); margin: 0; padding: 24px 16px 48px;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 4px; text-wrap: balance; }
h2 { font-size: 1.1rem; margin: 28px 0 8px; }
.sub { color: var(--muted); margin: 0 0 16px; }
.notes p { margin: 0 0 8px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--line); }
th { background: var(--head); font-weight: 600; }
td.gpio { font-weight: 600; white-space: nowrap; }
tr.reserved td { background: var(--reserved); }
tr.avoid td { background: var(--avoid); }
tr.limited td { background: var(--limited); }
.key { color: var(--muted); font-size: 0.9rem; margin: 6px 0 0; }
.notice { background: var(--avoid); padding: 12px 16px; border-radius: 6px; margin: 0 0 16px; }
.notice p { margin: 0 0 8px; }
pre { overflow-x: auto; background: var(--head); padding: 10px 12px; border-radius: 4px; margin: 0 0 8px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
footer { margin-top: 32px; color: var(--muted); font-size: 0.9rem; }
@media print { body { padding: 0; } }
`;

export interface PageOptions {
  /** A line for the footer (tests pass a fixed one). */
  readonly generated: string;
  /** Absolute URL of the boards docs page: the page opens from a blob: URL, which can't resolve "/docs/". */
  readonly docsUrl: string;
  /** What the connected board reports (HELLO chipType), when Auto found its processor but not the board
   * itself. The page then says board-specific pins are missing and how to add a board file. */
  readonly unlistedBoard?: string | null;
}

function page(title: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`
  );
}

/** A starter board file for a board that reports `boardPart`, on processor `processorId`. */
function boardFileExample(boardPart: string, processorId: string): string {
  const json = JSON.stringify({ name: boardPart, processor: processorId, match: [boardPart], pins: { LED: 2 } }, null, 2);
  return `<pre><code>${esc(json)}</code></pre>`;
}

function unlistedBoardNote(chipType: string, processor: ProcessorDef, opts: PageOptions): string {
  const { boardPart } = splitChipType(chipType);
  const file = boardPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-board";
  return (
    `<div class="notice"><p><strong>Your board isn't in Thingstudio's list.</strong> It reports ` +
    `<code>${esc(chipType)}</code>. Thingstudio knows its processor, so the pins below are the ${esc(processor.name)}'s. ` +
    `Pins the board wires to something, such as its LED, aren't shown.</p>` +
    `<p>To add them, save a file like this as <code>~/.thingstudio/boards/${esc(file)}.json</code>, with your ` +
    `board's real pins, then click Pins… again:</p>` +
    boardFileExample(boardPart, processor.id) +
    `<p>See <a href="${esc(opts.docsUrl)}#adding-a-board">Adding a board</a>.</p></div>`
  );
}

/** The page for a connected board whose processor matches no definition: what it reports, and what to add. */
export function renderUnknownBoardPage(chipType: string, opts: PageOptions): string {
  const { mcuPart } = splitChipType(chipType);
  return page(
    "Unknown board",
    `<h1>Unknown board</h1><p class="sub">It reports <code>${esc(chipType)}</code>.</p>` +
      `<p>Thingstudio has no definition for its processor (<code>${esc(mcuPart)}</code>), so it can't say which pins ` +
      `are safe, and it can't check the pins in your flow.</p>` +
      `<p>If it's a processor Thingstudio knows under another name, pick it in the Board menu. Otherwise add a ` +
      `processor file in <code>~/.thingstudio/processors/</code>, then click Pins… again. ` +
      `See <a href="${esc(opts.docsUrl)}#adding-a-processor">Adding a processor</a>.</p>` +
      `<footer><p>${esc(opts.generated)}</p></footer>`,
  );
}

/** The whole page for `target`. */
export function renderDefinitionPage(target: Target, opts: PageOptions): string {
  const { board, processor } = target;
  const title = board ? board.name : `${processor.name} (any board)`;
  const facts = [`Processor: ${esc(processor.name)}`];
  if (board) facts.push(board.wifi === true ? "WiFi: yes" : board.wifi === false ? "WiFi: no" : "WiFi: not stated");
  facts.push(`Native code: <code>${esc(processor.nativeArch)}</code>${processor.nativeArchConfirmed ? "" : " (unverified)"}`);

  const notes = [board?.notes, processor.notes].filter((n): n is string => !!n && n.trim() !== "");
  const notesHtml = notes.length ? `<div class="notes">${notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : "";

  let named = "";
  if (board && board.pins.size > 0) {
    const rows = [...board.pins]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([label, pin]) => {
        const s = pinStatus(target, pin);
        const why = s.kind === "free" ? "" : `${s.status}. ${s.why}`.trim();
        return `<tr><td>${esc(label)}</td><td class="gpio">GPIO ${pin}</td><td>${esc(why)}</td></tr>`;
      });
    named =
      `<h2>Named pins</h2><p>Pins wired to something on this board. Pin fields in the editor take the GPIO number.</p>` +
      `<table><thead><tr><th>Name</th><th>GPIO</th><th>Notes</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  // Every usable GPIO, plus any reserved pin outside that set, so nothing the compile mentions is missing.
  const all = [...new Set([...target.gpio, ...target.reserved.keys()])].sort((a, b) => a - b);
  const pinRows = all.map((pin) => {
    const s = pinStatus(target, pin);
    const labels = target.pinLabels.get(pin) ?? [];
    return (
      `<tr class="${s.kind}"><td class="gpio">${pin}</td><td>${esc(labels.join(", "))}</td>` +
      `<td>${esc(s.status)}</td><td>${esc(s.why)}</td></tr>`
    );
  });
  const pins =
    `<h2>All pins</h2>` +
    `<table><thead><tr><th>GPIO</th><th>Name</th><th>Status</th><th>Why</th></tr></thead><tbody>${pinRows.join("")}</tbody></table>` +
    `<p class="key">Reserved pins stop the compile. Pins to avoid work, but the compile warns. Blue rows have limits.</p>`;

  const files = [board ? `<code>~/.thingstudio/boards/${esc(board.id)}.json</code>` : null, `<code>~/.thingstudio/processors/${esc(processor.id)}.json</code>`]
    .filter(Boolean)
    .join(" and ");

  const notice = !board && opts.unlistedBoard ? unlistedBoardNote(opts.unlistedBoard, processor, opts) : "";
  return page(
    `${title} pins`,
    `<h1>${esc(title)}</h1><p class="sub">${facts.join(" · ")}</p>` +
      notice +
      notesHtml +
      named +
      pins +
      spiSection(processor) +
      i2cSection(processor) +
      `<footer><p>From ${files}. Edit ${board ? "them" : "it"} to correct this page. ` +
      `See <a href="${esc(opts.docsUrl)}">Boards and processors</a>.</p>` +
      `<p>${esc(opts.generated)}</p></footer>`,
  );
}
