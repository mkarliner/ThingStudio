// File -> Open Recent's list logic (flow-file/recent-files.ts, 2026-10-17). The IndexedDB wrapper and the
// file handles themselves are browser-only; this covers ordering, de-duplication and the cap.
import { describe, expect, it } from "vitest";
import { addRecent, MAX_RECENT, removeRecent, type RecentFile } from "../src/flow-file/recent-files.js";
import type { FlowFileHandle } from "../src/flow-file/file-io.js";

/** A stand-in handle: two handles with the same path are the same file, as isSameEntry reports. */
function handle(path: string): FlowFileHandle {
  const h = {
    name: path.split("/").pop()!,
    path,
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    getFile: async () => ({ text: async () => "", lastModified: 0 }),
    isSameEntry: async (other: FlowFileHandle) => (other as unknown as { path: string }).path === path,
  };
  return h as FlowFileHandle;
}
const entry = (path: string, at = 0): RecentFile => ({ handle: handle(path), name: path.split("/").pop()!, flowName: path, at });

describe("recent files", () => {
  it("puts the newest first", async () => {
    let list: RecentFile[] = [];
    list = await addRecent(list, entry("/a.flow.json", 1));
    list = await addRecent(list, entry("/b.flow.json", 2));
    expect(list.map((r) => r.name)).toEqual(["b.flow.json", "a.flow.json"]);
  });

  it("moves a file already on the list to the top instead of listing it twice", async () => {
    let list = [entry("/b.flow.json", 2), entry("/a.flow.json", 1)];
    list = await addRecent(list, entry("/a.flow.json", 3)); // a different handle object for the same file
    expect(list.map((r) => [r.name, r.at])).toEqual([["a.flow.json", 3], ["b.flow.json", 2]]);
  });

  it("tells apart two files with the same name in different folders", async () => {
    const list = await addRecent([entry("/one/x.flow.json")], entry("/two/x.flow.json"));
    expect(list).toHaveLength(2);
  });

  it(`keeps at most ${MAX_RECENT}`, async () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) list = await addRecent(list, entry(`/f${i}.flow.json`, i));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.name).toBe(`f${MAX_RECENT + 2}.flow.json`);
  });

  it("removes a file that has gone", async () => {
    const list = await removeRecent([entry("/a.flow.json"), entry("/b.flow.json")], handle("/a.flow.json"));
    expect(list.map((r) => r.name)).toEqual(["b.flow.json"]);
  });

  it("treats a handle whose isSameEntry throws as a different file, not an error", async () => {
    const bad = { ...handle("/a.flow.json"), isSameEntry: async () => { throw new Error("gone"); } } as FlowFileHandle;
    const list = await addRecent([{ handle: bad, name: "a.flow.json", flowName: "", at: 0 }], entry("/a.flow.json"));
    expect(list).toHaveLength(2);
  });
});
