# Online editor demo on thingstudio.net (proposed 2026-11-08)

Status: planned 2026-11-08: `../online-editor-demo-scoping.md`. Wanted soon (Mike). Scope: as far as
generating code at least (Mike, 2026-11-08). Split from the full online-and-offline item
(`online-and-offline-editor.md`), which keeps the findings on what is backend-only today.

## The idea

A demo of the editor on thingstudio.net, for people who want a feel for the product before spending even the
15 minutes a real install takes. No functionality behind it beyond the editor itself (Mike): no board
connection, no deploy, no runtime install, no flashing, no saved credentials. A clear call to action leads to
the download for the real thing.

## Why it looks quick

The editor is a static Vite build and the compile already runs in the browser (WASM). Hosting is a static-site
job, close to what `deployment-and-distribution-notes.md` described before the backend existed. The backend
features can be hidden rather than reworked.

## Open questions for Mike

- Preloaded examples: which ones? The showreel flow is the obvious first.
- How the board-facing controls look: hidden, or visible but disabled with a pointer to the download.
- Where it lives: a path on thingstudio.net (GitHub Pages) or a subdomain.
- The page makes no requests beyond its own assets and GoatCounter, so the landing page can say so.
- The page is labelled as a demo, so nobody mistakes it for the full online version.
