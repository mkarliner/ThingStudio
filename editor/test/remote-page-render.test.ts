// SPDX-License-Identifier: Apache-2.0
// editor/test/remote-page-render.test.ts
//
// Runs the remote page's own renderer (device-runtime/.../page/remote.html, <script id="app">) under a small DOM
// stub, against the shape the board actually sends. It exists because three client-side bugs in a row were
// invisible to every other test: the salt/key derivation, the flat input envelope, and a modal that mounted but
// painted nothing because its widgets were mounted before a refresh that never applied them to it.
//
// What is checked here is only what a page can get wrong by itself -- the DOM widgets it builds and the text it
// puts in them. Wire behaviour belongs to remote-page-crypto.test.ts and the board-side python tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = new globalThis.URL(".", import.meta.url).pathname;
const PAGE = join(here, "..", "..", "device-runtime", "src", "vendor", "thingstudio_remote", "page", "remote.html");

interface StubEl {
  tag: string;
  children: StubEl[];
  style: Record<string, string>;
  className: string;
  textContent: string;
  hidden: boolean;
  appendChild(child: StubEl): StubEl;
  addEventListener(): void;
  classList: { toggle(): void; add(): void; remove(): void };
  firstChild: StubEl | undefined;
  innerHTML: string;
}

function makeEl(tag: string): StubEl {
  const node: StubEl = {
    tag,
    children: [],
    style: {},
    className: "",
    textContent: "",
    hidden: false,
    appendChild(child) { node.children.push(child); return child; },
    addEventListener() {},
    classList: { toggle() {}, add() {}, remove() {} },
    get firstChild() { return node.children[0]; },
    get innerHTML() { return ""; },
    set innerHTML(v: string) { if (v === "") node.children = []; },
  };
  return node;
}

/** Loads the page's app block with just enough DOM for mountTree() and asks it to render one screen message. */
function renderScreen(screen: unknown): Record<string, StubEl> {
  const src = readFileSync(PAGE, "utf8");
  const app = /<script id="app">([\s\S]*?)<\/script>/.exec(src)?.[1];
  if (app === undefined) throw new Error("the app block is missing from the page");
  const crypto = /<script id="crypto">([\s\S]*?)<\/script>/.exec(src)?.[1];
  if (crypto === undefined) throw new Error("the crypto block is missing from the page");

  const els: Record<string, StubEl> = {};
  const doc = {
    getElementById: (id: string) => (els[id] = els[id] ?? makeEl(id)),
    createElement: makeEl,
    createTextNode: (t: string) => ({ text: t, nodeValue: t, firstChild: { nodeValue: t } }),
  };
  const def = {
    v: 1,
    display: "phone",
    pages: [
      { name: "home", tree: { kind: "column", children: [{ wid: "temp", kind: "readout", config: {} }] } },
      { name: "settings", tree: { kind: "column", children: [{ wid: "th", kind: "number", config: { key: "th" } }] } },
    ],
    modals: [
      { name: "alarm", priority: 1, tree: { kind: "column", gap: 8, padding: 12, children: [
        { wid: "alarm_text", kind: "label", config: { text: "Timer fired" } },
        { wid: "alarm_ack", kind: "button", config: { mode: "navigate", target: "back", text: "Ack" } },
      ] } },
    ],
  };

  // eslint-disable-next-line no-new-func -- running the page's own script is the point of this test
  // the page's own script declares `var def` / `var screenPend`, so the definition cannot be passed as `def`
  // (the declaration would shadow the parameter and it would read back as null)
  const run = new Function("document", "location", "WebSocket", "fetch", "__def", "__screen",
    `${crypto}\n${app}\nfinishDefs(__def);\napplyScreen(__screen);\nreturn {pageRecs, modalRecs};`);
  const WebSocketStub = function (this: { readyState: number; send: () => void }) {
    this.readyState = 0;
    this.send = () => {};
  };
  run(doc, { protocol: "http:", host: "192.168.10.110" }, WebSocketStub, () => new Promise(() => {}), def, screen);
  return els;
}

function texts(node: StubEl | undefined, out: string[] = []): string[] {
  if (node === undefined) return out;
  if (node.textContent) out.push(node.textContent);
  node.children.forEach(c => texts(c, out));
  return out;
}

describe("the remote page's renderer", () => {
  it("fills a modal that opens while a page change runs underneath it", () => {
    // This is the case that shipped blank: one screen message names a page the page has not built yet, so
    // applyScreen mounts the modal and then buildPage() resets pageRecs -- the modal's widgets were registered
    // there, lost their records, and their set() (which is what writes a label's text) never ran.
    const els = renderScreen({ type: "screen", page: "settings", modal: "alarm",
                               modalPayload: "the 30 s timer fired", queued: 0, values: {} });
    expect(els["modal"]?.style.display).toBe("block");
    expect(texts(els["modalbox"])).toContain("Timer fired");
    expect(texts(els["modalbox"])).toContain("Ack");
  });

  it("fills a modal that opens on the page already showing", () => {
    const els = renderScreen({ type: "screen", page: "home", modal: "alarm", queued: 0, values: {} });
    expect(texts(els["modalbox"])).toContain("Timer fired");
    expect(texts(els["modalbox"])).toContain("Ack");
  });

  it("closes the overlay again when the board sends no modal", () => {
    const els = renderScreen({ type: "screen", page: "home", modal: null, queued: 0, values: {} });
    expect(els["modal"]?.style.display).toBe("none");
  });
});
