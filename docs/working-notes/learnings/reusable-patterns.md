# Learnings — Reusable patterns worth remembering

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **A bounded, drop-oldest ring buffer for queued outbound messages** —
  the vendored `mqtt_as`'s own `MsgQueue` already implements exactly this
  eviction shape for *inbound* subscribed messages; a validated precedent
  worth reusing for any future "buffer while disconnected, flush on
  reconnect" need, even though the data path differs (inbound vs.
  outbound). `mvp-feature-priorities.md`.
