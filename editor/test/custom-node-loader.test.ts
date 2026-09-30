// Custom nodes load automatically (2026-09-30, decisions/node-authoring.md): src/app/custom-node-loader.ts
// against a fake backend, the store's messages for a flow using a type that didn't load, and the example
// packages the backend copies into ~/.thingstudio/custom-nodes/ on first run.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAllCustomNodes, type CustomNodeListing, type CustomNodeSource } from "../src/app/custom-node-loader.js";
import {
  customNodePackages,
  getCustomNodePackage,
  missingNodeTypeMessage,
  replaceAllCustomNodePackages,
} from "../src/app/rete/custom-nodes-store.js";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildCustomNodeDefinition, mergeCustomNodeRegistry } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "..", "backend", "src", "thingstudio_backend", "example_nodes");

const DIR = "~/.thingstudio/custom-nodes";
const RUN = "async def run(msg, properties):\n    return msg\n";

function transform(type: string): string {
  return JSON.stringify({
    type,
    kind: "transform",
    label: type.split("/")[1],
    ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  });
}

/** A fake backend holding `files`: package name -> descriptor text and implementation. */
function fakeBackend(
  files: Record<string, { descriptor: string; implementation?: string } | Error>,
  extraPackages: CustomNodeListing["packages"] = [],
): CustomNodeSource {
  const names = Object.keys(files);
  return {
    list: async () => ({ names, packages: [...names.map((name) => ({ name, file: `${DIR}/${name}.node.json` })), ...extraPackages] }),
    read: async (name) => {
      const f = files[name];
      if (f === undefined) throw new Error(`no package named ${name}`);
      if (f instanceof Error) throw f;
      return { descriptor: f.descriptor, implementation: f.implementation ?? RUN };
    },
  };
}

describe("loadAllCustomNodes", () => {
  it("loads every good package and skips each bad one, naming its file", async () => {
    const result = await loadAllCustomNodes(
      fakeBackend({
        alpha: { descriptor: transform("my/alpha") },
        broken_json: { descriptor: "{ not json" },
        bad_kind: { descriptor: JSON.stringify({ type: "my/bad_kind", kind: "sometimes", label: "x" }) },
        unreadable: new Error("load custom node \"unreadable\" failed: incomplete package"),
        omega: { descriptor: transform("my/omega") },
      }),
    );
    expect(result.loaded.map((p) => p.descriptor.type)).toEqual(["my/alpha", "my/omega"]);
    expect(result.loaded[0]?.file).toBe(`${DIR}/alpha.node.json`);
    expect(result.problems.map((p) => p.file)).toEqual([`${DIR}/broken_json.node.json`, `${DIR}/bad_kind.node.json`, `${DIR}/unreadable.node.json`]);
    expect(result.problems[0]?.message).toMatch(/^not valid JSON/);
    // The type a broken descriptor claims is kept, so a flow using it can be told which file failed.
    expect(result.problems[1]?.type).toBe("my/bad_kind");
    expect(result.problems[0]?.type).toBeUndefined();
    expect(result.problems[2]?.message).toContain("incomplete package");
  });

  it("keeps the first package when two claim the same type, and reports the second", async () => {
    const result = await loadAllCustomNodes(
      fakeBackend({
        first: { descriptor: transform("my/same"), implementation: "# first\n" + RUN },
        second: { descriptor: transform("my/same"), implementation: "# second\n" + RUN },
      }),
    );
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]?.pythonSource).toContain("# first");
    expect(result.problems).toEqual([
      { file: `${DIR}/second.node.json`, message: `type "my/same" is already used by ${DIR}/first.node.json, which is loaded instead` },
    ]);
  });

  it("reports a package shadowed by a same-named package in an earlier folder", async () => {
    const result = await loadAllCustomNodes(
      fakeBackend({ blink: { descriptor: transform("my/blink") } }, [
        { name: "blink", file: "/elsewhere/blink.node.json", shadowedBy: `${DIR}/blink.node.json` },
      ]),
    );
    expect(result.loaded.map((p) => p.descriptor.type)).toEqual(["my/blink"]);
    expect(result.problems).toEqual([{ file: "/elsewhere/blink.node.json", message: `${DIR}/blink.node.json has the same name and is used instead` }]);
  });

  it("rejects a package claiming a built-in type, like any other invalid descriptor", async () => {
    const result = await loadAllCustomNodes(fakeBackend({ sneaky: { descriptor: transform("thingstudio/timer") } }));
    expect(result.loaded).toEqual([]);
    expect(result.problems[0]?.message).toContain("reserved");
  });

  it("throws only when the listing itself fails", async () => {
    const source: CustomNodeSource = {
      list: async () => {
        throw new Error("backend not reachable");
      },
      read: async () => ({ descriptor: "", implementation: "" }),
    };
    await expect(loadAllCustomNodes(source)).rejects.toThrow("backend not reachable");
  });

  it("an empty folder loads nothing and reports nothing", async () => {
    expect(await loadAllCustomNodes(fakeBackend({}))).toEqual({ loaded: [], problems: [] });
  });
});

describe("custom-nodes-store after a load", () => {
  beforeEach(() => replaceAllCustomNodePackages([], []));

  it("replaces the whole set, so a package removed from the folder leaves the palette", async () => {
    const first = await loadAllCustomNodes(fakeBackend({ a: { descriptor: transform("my/a") }, b: { descriptor: transform("my/b") } }));
    replaceAllCustomNodePackages(first.loaded, first.problems);
    expect([...customNodePackages.value.keys()]).toEqual(["my/a", "my/b"]);
    const second = await loadAllCustomNodes(fakeBackend({ b: { descriptor: transform("my/b") } }));
    replaceAllCustomNodePackages(second.loaded, second.problems);
    expect([...customNodePackages.value.keys()]).toEqual(["my/b"]);
    expect(getCustomNodePackage("my/a")).toBeUndefined();
  });

  it("says which file failed for a type whose package didn't load", async () => {
    const result = await loadAllCustomNodes(
      fakeBackend({ bad_kind: { descriptor: JSON.stringify({ type: "my/bad_kind", kind: "sometimes", label: "x" }) } }),
    );
    replaceAllCustomNodePackages(result.loaded, result.problems);
    const message = missingNodeTypeMessage("my/bad_kind");
    expect(message).toContain(`${DIR}/bad_kind.node.json`);
    expect(message).toContain("didn't load");
  });

  it("says where packages go for a custom type nothing defines, and stays plain for a built-in id", () => {
    expect(missingNodeTypeMessage("my/nowhere")).toContain("~/.thingstudio/custom-nodes/");
    expect(missingNodeTypeMessage("my/nowhere")).toContain("Reload custom nodes");
    expect(missingNodeTypeMessage("thingstudio/from_the_future")).toBe('unknown node type "thingstudio/from_the_future"');
  });
});

describe("the example packages the backend ships", () => {
  const names = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".node.json"))
    .map((f) => f.slice(0, -".node.json".length))
    .sort();

  it("are the two expected ones", () => {
    expect(names).toEqual(["dht22", "doubler"]);
  });

  it("all load, and compile into a flow whose Python parses", async () => {
    const source: CustomNodeSource = {
      list: async () => ({ names, packages: names.map((name) => ({ name, file: `${name}.node.json` })) }),
      read: async (name) => ({
        descriptor: readFileSync(join(EXAMPLES_DIR, `${name}.node.json`), "utf8"),
        implementation: readFileSync(join(EXAMPLES_DIR, `${name}.node.py`), "utf8"),
      }),
    };
    const result = await loadAllCustomNodes(source);
    expect(result.problems).toEqual([]);
    const registry = mergeCustomNodeRegistry(
      buildRegistry(),
      result.loaded.map((p) => buildCustomNodeDefinition(p.descriptor, p.pythonSource)),
    );
    // dht22 -> doubler -> debug: one of each kind the examples cover.
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "examples/dht22", properties: { pin: 4, intervalMs: 5000 } },
        { id: "2", type: "examples/doubler", properties: { factor: 2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "2", 0, "3", 0, "any"],
      ],
    };
    const { source: py } = compile(graph, registry);
    expect(py).toContain("dht.DHT22");
    execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: py });
  });
});
