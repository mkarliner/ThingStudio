// The preview scheduler (reviews 2026-10-19 findings 7/8): compiles never overlap, queued previews coalesce to the
// newest, and Deploy's compile is never skipped.

import { describe, expect, it } from "vitest";
import { createPreviewQueue } from "../src/app/preview-queue.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createPreviewQueue", () => {
  it("never runs two compiles at once", async () => {
    let active = 0;
    let maxActive = 0;
    const gates: ReturnType<typeof deferred<void>>[] = [];
    const queue = createPreviewQueue(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      active--;
      return gates.length;
    });

    const a = queue.latest();
    const b = queue.latest();
    await tick();
    expect(active).toBe(1);
    gates[0]!.resolve();
    await tick();
    expect(active).toBe(1);
    gates[1]!.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    expect(maxActive).toBe(1);
    expect(ra).toBe(1);
    expect(rb).toBe(2);
  });

  it("coalesces queued previews: only the newest of several waiting runs", async () => {
    const gates: ReturnType<typeof deferred<number>>[] = [];
    let calls = 0;
    const queue = createPreviewQueue(async () => {
      calls++;
      const gate = deferred<number>();
      gates.push(gate);
      return gate.promise;
    });

    const first = queue.latest();
    const second = queue.latest();
    const third = queue.latest();
    await Promise.resolve();
    expect(calls).toBe(1); // first is running; second/third wait

    gates[0]!.resolve(1);
    await tick();
    expect(calls).toBe(2); // second was skipped, third ran
    gates[1]!.resolve(3);

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(1); // superseded, returns the last result
    await expect(third).resolves.toBe(3);
  });

  it("now() waits its turn but is never coalesced away", async () => {
    const gates: ReturnType<typeof deferred<string>>[] = [];
    const queue = createPreviewQueue(async () => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise;
    });

    const preview = queue.latest();
    const deploy = queue.now();
    const newerPreview = queue.latest();
    await tick();
    expect(gates).toHaveLength(1);
    gates[0]!.resolve("first");
    await tick();
    expect(gates).toHaveLength(2); // deploy ran; it is not coalesced away
    gates[1]!.resolve("deploy");
    await expect(deploy).resolves.toBe("deploy");
    await expect(preview).resolves.toBe("first");
    await tick();
    expect(gates).toHaveLength(3); // the preview requested after deploy still runs
    gates[2]!.resolve("newest");
    await expect(newerPreview).resolves.toBe("newest");
  });
});
