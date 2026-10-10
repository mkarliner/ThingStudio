# Briefing: user-docs style review and brainstorm

Status: brief, 2026-10-10. For a session with Mike. Its job: find out, from Mike's own reactions, what "human
oriented" writing means for Thingstudio's user docs, then write that down so no later session has to guess.

## Why

Mike's view: the user docs are not written for people. They read as correct and complete, and they were mostly
produced by agents working from source. The current rule in `CLAUDE.md` ("Human-facing documentation: concise, not
exhaustive") is an interim one: Node-RED's Concepts page as the pacing reference, with a promise to replace it with
a real style guide once Mike is happy with a piece. This session writes that guide.

Concise is not the same as human. A page can be short and still read as a spec. The review has to find out what is
missing besides length.

## Facts to start from

- Build is clean: `mkdocs build --strict` passes on mkdocs 1.6.1 with Material (2026-10-10). `wifi-provisioning.md` is
  not in the nav (INFO only; decide whether that is intended).
- Site: docs.thingstudio.net. `docs_dir` is `docs/user-guide`, so a relative link can't reach `docs/` (the clock page
  hit this: it now links to GitHub for the licences).
- About 28,000 words across `docs/user-guide`. Longest hand-written pages: `ai-authoring.md` (written for an AI,
  not a person: leave it out of the tone review), `nodes/gui.md`, `nodes/display-spi.md`, `debugging.md`, `boards.md`,
  `canvas-basics.md`, `custom-nodes.md`, `sensor-display.md`, `index.md`.
- `nodes-catalog.md` is generated and for tools. Not reviewed for tone.
- Pages written by different sessions at different times. Expect inconsistent voice, and node pages in particular
  written from the code outward (properties, then behaviour, then limits) rather than from the user's task inward.
- Existing evidence on what trips newcomers: `validation/newcomer-test-script.md` and
  `newcomer-docs-review-briefing.md`. The newcomer test itself has not been run on the current docs set.

## How to run it

1. **Mike reads, Claude listens.** Pick five pages that span the types: Home (`index.md`), Getting started, one task
   guide (`sensor-display.md`), one node page (`nodes/gui.md` or `nodes/display-spi.md`), and `debugging.md`. Mike
   reads each and says what he reacts to, in his words: what is cold, what is jargon, what answers a question nobody
   asked, what is missing, what he'd skip. Capture the remarks verbatim in a working note
   (`docs/working-notes/docs-style-review.md`) before interpreting them.
2. **Group the remarks** into patterns (voice, order, assumed knowledge, examples, jargon, structure, what to cut).
   Show Mike the groups and ask whether each is a rule, a preference, or a one-off.
3. **Write the style guide** (below) from the rules only. Each rule gets one good and one bad example, taken from the
   actual docs (anonymised if needed). Keep the guide itself short and written in the style it asks for.
4. **Explicit edits.** Mike points at things that stand out. Make those edits first, exactly as asked, then apply the
   same rule to the rest of the page it came from and show him the result before touching other pages.
5. **Stop at the sample.** Don't rewrite the whole set in the session. Rewrite the five sample pages, let Mike judge
   them, then list the rest by priority for later sessions.

## Questions to put to Mike early

- Who is the reader? A hobbyist who has never used a microcontroller, an Arduino user moving over, or a Node-RED
  user? The docs currently serve all three and fit none well.
- Voice: first person plural ("we"), second person ("you"), or neutral? Is some humour or warmth wanted, and how
  much?
- Is a node page a reference (look it up) or a lesson (read it once)? Should reference pages have a fixed layout?
- How should limitations be framed? Today they appear as flat lists ("no HTTPS, no chunked, no redirects").
- Examples: inline code, links to flows in `test-flows/`, or both? Should every node page start with one?
- Should internal project vocabulary ("v1", "not yet supported", decisions and dates) ever appear in user docs?
- Pictures: screenshots of the editor where words are weak? (None are in the docs today.)
- What should the first five minutes feel like, and which page owns that?

## Deliverables

- `docs/working-notes/docs-style-review.md`: Mike's remarks, verbatim, and the grouped patterns.
- **a) Style guide:** `docs/working-notes/docs-style-guide.md`. Voice, structure of each page type (task guide, node
  page, concept, troubleshooting), vocabulary list (words to use and avoid), how to treat limitations and
  unfinished features, example rules. Then replace the interim paragraph in `CLAUDE.md` with a pointer to it, as that
  paragraph promises.
- **b) Explicit edits:** Mike's list, done and shown, plus the sample-page rewrites.
- A prioritised list of pages still to rewrite, in `outstanding-items.md`.

## Constraints

- Mike does all git writes. Give commit commands.
- Don't change meaning while rewriting tone. Behaviour claims stay checked against the source.
- Don't use the phrase "load bearing".
- `ai-authoring.md` and the generated catalog are for AI readers and keep their own style; the guide should say so.
- Build check after any docs edit: `mkdocs build --strict` (venv with mkdocs 1.6 and mkdocs-material; the sandbox's
  default mkdocs is too old). The docs tests (`docs-llms.test.ts`, the CLI authoring-example test) must stay green.
