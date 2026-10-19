# `http_request`: a response body larger than free memory fails as a bare `MemoryError`

Status: open, needs a decision (Mike), found 2026-10-19 during the network-packages hardware pass.

## What happened

`test-flows/network-packages-pass.py`'s http flow, pointed at a 56 KB page, failed on an ESP32-C3 with:

```
NODE_ERROR node=h1 type=MemoryError msg=memory allocation failed, allocating 56722 bytes
```

Pointing the same flow at a 48-byte page succeeded, and the body arrived in `msg['payload']`. So the node works;
the failure is response size, not the request path.

At the failure the board reported `freeRamBytes: 41120`, `freeIdfHeapBytes: 8668`,
`largestIdfHeapBlockBytes: 5632`. `readexactly(56722)` needs one contiguous 56 KB allocation, and there isn't one.
The generated code (`editor/src/node-library/core-packages/http-request.ts`) reads the whole body in one call
(`readexactly(content_length)`, or accumulates `read(512)` chunks when there is no `Content-Length`), and `run()`
catches `OSError` only -- so `MemoryError` escapes with no attribution to http.

## Decision needed

How far to go:

1. **Make the failure legible, keep the one-shot response.** Catch `MemoryError` around the body read and raise
   `OSError("http_request to %s:%s: response body %d bytes doesn't fit in RAM" % ...)`. Smallest change; matches
   the project's fault-handling priority and the existing host:port attribution. This is the recommended first step
   regardless of what else is decided.
2. **Bound the body size.** Either a `maxBytes` node property, or a limit derived from `gc.mem_free()` and the
   largest block, then a clear error (or a truncated body flagged in the message). A fixed cap is wrong across
   boards: an RP2040 has far more room than a C3, and an S3 with PSRAM more again. Needs a shape decision before
   code.
3. **Stream the body.** Emit it in chunks instead of one payload. That changes the node's output contract, the port
   type and the docs; a much larger change and not obviously MVP work.

Recommendation: do (1) now; decide separately whether (2) is worth a property, and leave (3) post-MVP.

## Documentation already added

The current behavior is documented regardless of the fix: a limitation line on
`docs/user-guide/nodes/http-request.md` and an FAQ entry in `docs/user-guide/faq.md`.
