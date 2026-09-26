// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/filter.ts
//
// Filter / event compression (mvp-feature-priorities.md Tier 1 item 5 point 2; spec agreed with Mike
// 2026-09-26, docs/working-notes/filter-node-spec.md). Passes a msg on only when it's worth sending and
// drops the rest by returning None -- the compiler's existing "a transform's None stops the chain". The
// msg itself is never changed. Three modes:
//
//   change   -- payload differs (==) from the last one passed.
//   deadband -- payload, read as a number, is at least `threshold` from the last one PASSED (not the last
//               received, so a slow drift still gets through once it adds up). abs(), so falls count too.
//               Numeric strings/bytes are parsed ("21.5" from MQTT); bool, NaN, inf are not numbers.
//   rate     -- at least `intervalMs` since the last one passed; the rest are dropped, not queued.
//
// State is module-level (ctx.uniqueName, timer.ts's pattern): one dict per node keyed by topic (or ''
// when perTopic is off), so it resets on every Deploy and boot. At most 32 topics are tracked; a 33rd
// clears the table (one console line, printed once) -- bounds RAM on small boards without an LRU.
//
// Fault handling: a non-number in deadband mode is dropped, not raised -- raising would end the source's
// whole coroutine (runtime._guarded is per task), e.g. stop an mqtt_subscribe loop. It's reported once
// as a NODE_ERROR through runtime._report_error (present in every runtime since NODE_ERROR existed, so no
// runtime change or version bump), then quiet until a number arrives. Bad properties are CompileErrors.
//
// Left for later, all additive: % deadband, a direction (rising/falling) option, Node-RED's narrowband,
// comparing a property other than payload, and a rate mode that sends the last dropped value when the
// window ends (needs a task per node).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

export const FILTER_MODES = ["change", "deadband", "rate"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

/** Topics tracked per node before the table is cleared (see header). */
export const FILTER_MAX_TOPICS = 32;

// Shared by every deadband filter in a flow (deduplicated by key). Returns a float, or None for anything
// that isn't a finite number. bool first: in Python it's an int subclass.
const NUM_HELPER = `def _filter_num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (bytes, bytearray)):
        try:
            v = v.decode()
        except Exception:
            return None
    if isinstance(v, str):
        try:
            v = float(v.strip())
        except ValueError:
            return None
    if not isinstance(v, (int, float)):
        return None
    v = float(v)
    if v != v or v in (float('inf'), float('-inf')):
        return None
    return v`;

function numberProp(node: GraphNode, key: string, fallback: number): number {
  const raw = node.properties[key];
  return raw === undefined || raw === null || raw === "" ? fallback : Number(raw);
}

export const filterNode: NodeDefinition = {
  type: "thingstudio/filter",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const mode = (node.properties.mode as string | undefined) ?? "change";
    if (!(FILTER_MODES as readonly string[]).includes(mode)) {
      throw new CompileError(`filter node's mode "${mode}" must be one of ${FILTER_MODES.join(", ")}`);
    }
    const ignoreFirst = node.properties.ignoreFirst === true;
    const perTopic = node.properties.perTopic !== false;
    const nodeId = JSON.stringify(String(node.id));

    const stateVar = ctx.uniqueName("filter_state");
    const fullVar = ctx.uniqueName("filter_full_warned");
    const statements = [{ key: stateVar, code: `${stateVar} = {}\n${fullVar} = False` }];
    const imports: string[] = [];

    const body: string[] = [];
    const globals = [fullVar];
    body.push(perTopic ? "_k = msg.get('topic', '')\nif not isinstance(_k, str):\n    _k = str(_k)" : "_k = ''");
    body.push(
      `if _k not in ${stateVar} and len(${stateVar}) >= ${FILTER_MAX_TOPICS}:`,
      `    ${stateVar}.clear()`,
      `    if not ${fullVar}:`,
      `        ${fullVar} = True`,
      `        print("FILTER_INFO node=%s more than ${FILTER_MAX_TOPICS} topics, starting again" % ${nodeId})`,
    );
    const firstReturn = ignoreFirst ? "return None" : "return msg";

    if (mode === "change") {
      body.push(
        "_v = msg['payload']",
        `if _k in ${stateVar}:`,
        `    if ${stateVar}[_k] == _v:`,
        "        return None",
        `    ${stateVar}[_k] = _v`,
        "    return msg",
        `${stateVar}[_k] = _v`,
        firstReturn,
      );
    } else if (mode === "deadband") {
      const threshold = numberProp(node, "threshold", 1);
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new CompileError(`filter node's threshold "${String(node.properties.threshold)}" must be a number of 0 or more`);
      }
      const warnVar = ctx.uniqueName("filter_nan_warned");
      globals.push(warnVar);
      statements.push({ key: "_filter_num", code: NUM_HELPER });
      statements.push({ key: warnVar, code: `${warnVar} = False` });
      body.push(
        "_n = _filter_num(msg['payload'])",
        "if _n is None:",
        `    if not ${warnVar}:`,
        `        ${warnVar} = True`,
        `        runtime._report_error(${nodeId}, ValueError("deadband needs a number, got %s %r" % (type(msg['payload']).__name__, msg['payload'])))`,
        "    return None",
        `${warnVar} = False`,
        `if _k in ${stateVar}:`,
        `    if abs(_n - ${stateVar}[_k]) < ${threshold}:`,
        "        return None",
        `    ${stateVar}[_k] = _n`,
        "    return msg",
        `${stateVar}[_k] = _n`,
        firstReturn,
      );
    } else {
      const intervalMs = numberProp(node, "intervalMs", 1000);
      if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
        throw new CompileError(`filter node's interval "${String(node.properties.intervalMs)}" must be a whole number of milliseconds above 0`);
      }
      imports.push("import time");
      body.push(
        "_now = time.ticks_ms()",
        `if _k in ${stateVar} and time.ticks_diff(_now, ${stateVar}[_k]) < ${intervalMs}:`,
        "    return None",
        `${stateVar}[_k] = _now`,
        "return msg",
      );
    }

    return {
      imports,
      statements,
      functionName: ctx.uniqueName("filter"),
      functionBody: [`global ${globals.join(", ")}`, ...body].join("\n"),
    };
  },
};
