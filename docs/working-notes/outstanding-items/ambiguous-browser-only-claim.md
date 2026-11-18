# `architecture-review-briefing.md`'s "browser-only, no install" claim (§4) — flagged as ambiguous

Flagged as unusually undermotivated when originally written; partially overtaken by the backend-architecture
decision (Decision 2) but never explicitly closed out as "yes, still true" or "no, superseded." WebSerial itself
was later confirmed to survive as a frozen local-only fallback (`deployment-and-distribution-notes.md`), which
resolves part of this, but the original §4 framing question was never explicitly revisited against that
resolution. Needs a human decision, not guessed here.

## Closed 2026-11-18

Answered by the online editor (`online-editor-webserial-briefing.md`, Mike, 2026-11-18): ThingStudio runs both
installed and as a web page. The web page reaches a board over Web Serial with no install; the installed editor adds
the WiFi link, custom nodes and the command line. Removed from `outstanding-items.md`'s ambiguous list.
