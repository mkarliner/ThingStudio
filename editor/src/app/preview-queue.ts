// SPDX-License-Identifier: Apache-2.0
// editor/src/app/preview-queue.ts
//
// Serialises compiles and coalesces preview requests. The editor recompiles on every change; without this, two
// compiles can overlap and the older one can write its result last (reviews 2026-10-19 findings 7/8). A preview
// requested while another compile runs waits; if several wait, only the newest runs. Deploy uses now(), which
// waits its turn but is never coalesced away.

export interface PreviewQueue<T> {
  /** For UI refreshes: one at a time, and only the newest queued request runs. */
  latest(): Promise<T>;
  /** For Deploy: one at a time, never skipped. */
  now(): Promise<T>;
}

export function createPreviewQueue<T>(run: () => Promise<T>): PreviewQueue<T> {
  let tail: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let last: T | undefined;

  function enqueue(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    latest(): Promise<T> {
      const myGeneration = ++generation;
      return enqueue(async () => {
        // A newer request arrived while this one waited. Do not compile a graph that has already changed; the
        // newer request will. If this is somehow the first request, run it rather than inventing a value.
        if (myGeneration !== generation && last !== undefined) return last;
        last = await run();
        return last;
      });
    },
    now(): Promise<T> {
      return enqueue(async () => {
        last = await run();
        return last;
      });
    },
  };
}
