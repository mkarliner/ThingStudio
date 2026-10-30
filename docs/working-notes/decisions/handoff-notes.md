# Decisions — Handoff/briefing notes: naming and contents

Status: detail file for `decisions.md`'s "Handoff notes" index entry. The operative rule lives in the
repo-root `AGENTS.md` section "Handoff/briefing note filenames: lead with the topic". This file holds the
incident record and the parts that don't need to sit in every agent's context.

- **2026-09-08 — Handoff notes lead with the topic, never with "next-session-picks".** A directory listing of
  a dozen `next-session-picks-briefing-2026-09-07*.md` files tells a reader nothing about what any of them
  covers; topic-first naming (`rp2350-bringup-briefing.md`, `failure-handling-briefing-2026-09-08.md`) keeps
  the directory scannable. The four-step naming procedure and the phrasing checks are in `AGENTS.md`.
- **2026-09-11 — Violated once after being written down.** The very session that fixed the
  WiFi-flapping/mqtt-status bugs wrote its handoff as `next-session-picks-briefing-2026-09-11.md` — the exact
  pattern this rule prohibits — by an agent that had already read the rule earlier in the same session. It took
  Mike explicitly flagging it ("it keeps being ignored") for it to be caught and renamed (to
  `node-status-hardware-pass-briefing.md`). The likely failure mode: pattern-matching off the directory listing
  — a dozen pre-2026-09-08 `next-session-picks-briefing-*.md` files still sit there, grandfathered and not going
  away — instead of off the rule. That "check the directory listing first" step is exactly where this has
  previously gone wrong; the rule's step 3 (the string must not appear in the name) is the cheap catch.
- **2026-10-24 — A brief's environment facts cover every toolchain the session used, not just the device.**
  Mike hit the gap the hard way: a brief listed the serial port, ESP-IDF and the device interpreter but had no
  npm line at all, so a broken `npm install` and six dependency advisories were rediscovered by hand on a Mac
  an hour later. The section is written for the person about to touch the same things — including the command
  that works and the one that doesn't — not as a summary of what the author found interesting.

Existing `next-session-picks-briefing-*.md` files are left as-is; the rule governs naming going forward, not a
retroactive rename pass.
