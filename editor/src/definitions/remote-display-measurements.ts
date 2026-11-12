// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/remote-display-measurements.ts
//
// Which processors have measured remote-display headroom. The ledger is
// docs/working-notes/remote-display-spike-results.md (freeIdfHeapBytes / largestIdfHeapBlockBytes, never
// gc.mem_free() alone); this is the compiler's copy, keyed by processor id.
//
// The compiler warns -- never blocks -- when a remote screen targets a processor or image that is not a
// measured case (decisions/remote-display.md, 2026-11-07 and 2026-11-10): a user may deploy a remote display
// to any board that can run the web server and ts_remote, but the memory floor is a measured fact, not a
// guess. The compiler cannot see the image (stock or custom -- that is known only at deploy time, from the
// frozen inventory), so a note always names the image it was measured on, and the warning for a measured
// processor still fires for other images.
//
// Adding a measurement: a row here and a row in remote-display-spike-results.md, in the same change. A
// processor not listed is unmeasured.

export interface RemoteDisplayMeasurement {
  /** The verdict the results sheet records. */
  readonly verdict: "comfortable" | "below-floor";
  /** The image the measurement was made on, as a phrase ("the ESP32-S3 custom image (frozen remote libraries)"). */
  readonly note: string;
}

/** Processor id -> the recorded remote-display headroom. An absent processor is unmeasured. */
export const REMOTE_DISPLAY_MEASUREMENTS: ReadonlyMap<string, RemoteDisplayMeasurement> = new Map([
  ["esp32-s3", { verdict: "comfortable", note: "the ESP32-S3 custom image (frozen remote libraries)" }],
  ["esp32-c3", { verdict: "below-floor", note: "a stock install -- the ESP-IDF heap collapses under the feature" }],
]);
