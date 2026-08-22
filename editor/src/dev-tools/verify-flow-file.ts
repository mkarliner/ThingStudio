// SPDX-License-Identifier: Apache-2.0
// editor/src/dev-tools/verify-flow-file.ts
//
// Scratch CLI, not part of the product (same status as compile-flow.ts,
// see its own header). Parses a flow file through the real
// flow-file/flow-file.ts logic the browser's "Open Flow" button uses, and
// additionally checks each node's type against the canvas's own
// NODE_FACTORIES key set -- without actually importing app/rete/nodes.ts,
// which pulls in `rete`/Vue-adjacent modules built for Vite's bundler
// resolution, not plain Node ESM (see test-flows/README.md). The kind
// list below is duplicated from palette.ts's NodeKind union rather than
// imported, specifically to catch drift: if this list and the real
// NODE_FACTORIES ever disagree, that's exactly the kind of mismatch this
// check exists to catch before a hand-edited flow file goes to a browser.
//
// wifi_status/udp_send/udp_receive added config-node-and-palette-
// implementation-briefing.md (2026-08-18) -- config references
// (`configs[].id`, a node's `wifiConfigId` property) aren't cross-checked
// here yet (this script predates config nodes existing at all); a
// dangling `wifiConfigId` is caught by the real compiler's
// `ctx.resolveConfig()` at compile time instead (CompileError, "referenced
// config ... not found"), not by this file's own lighter-weight checks.
//
// mqtt_publish/mqtt_subscribe added to the list below 2026-08-21, when
// they got real canvas factories for the first time (nodes.ts's own
// header) -- omitting them here would make this script wrongly flag a
// valid, now-loadable flow file as having "no canvas factory."

import { readFileSync } from "node:fs";
import { parseFlowFile } from "../flow-file/flow-file.js";

const KNOWN_KINDS = new Set([
  "inject",
  "function",
  "debug",
  "gpio_out",
  "timer",
  "interrupt",
  "wifi_status",
  "udp_send",
  "udp_receive",
  "mqtt_publish",
  "mqtt_subscribe",
]);

const path = process.argv[2];
if (!path) {
  console.error("usage: verify-flow-file.js <flow.json>");
  process.exit(2);
}

const text = readFileSync(path, "utf8");
const file = parseFlowFile(text);
console.log(`parsed OK: ${file.nodes.length} node(s), ${file.edges.length} edge(s), ${file.configs.length} config(s)`);

let ok = true;
for (const n of file.nodes) {
  const kind = n.type.replace(/^thingstudio\//, "");
  if (!KNOWN_KINDS.has(kind)) {
    ok = false;
    console.error(`node ${n.id}: type "${n.type}" has no canvas factory (would be skipped on load, logged as "unknown type")`);
  }
  if (!file.layout[String(n.id)]) {
    console.error(`node ${n.id}: no layout entry -- would load at (0, 0)`);
  }
}
for (const [originId, , targetId] of file.edges) {
  const originExists = file.nodes.some((n) => n.id === originId);
  const targetExists = file.nodes.some((n) => n.id === targetId);
  if (!originExists || !targetExists) {
    ok = false;
    console.error(`edge references missing node (origin=${originId} exists=${originExists}, target=${targetId} exists=${targetExists})`);
  }
}

if (!ok) {
  console.error("FAILED");
  process.exit(1);
}
console.log("All nodes have a canvas factory; all edges reference real nodes. OK.");
