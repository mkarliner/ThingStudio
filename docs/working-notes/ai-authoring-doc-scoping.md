# AI-authoring doc: scoping

Status: scoping, 2026-10-10. Launch item 6 in `launch-mvp-scope-briefing.md`. Decisions for Mike are at the end.
It depends on the headless compile/validate command, built 2026-10-10 (`docs/user-guide/check-a-flow.md`).

## What it is for

An AI agent (Claude Code, Cursor, a chat assistant with file access) working in a *user's* folder writes a flow file
or a custom node, checks it, and hands it back to be opened in the editor. The test of the doc is how often the
result passes the check, deploys and runs on the first go. It is not the repo-root `AGENTS.md`, which is for agents
working on Thingstudio itself.

## What an agent gets wrong without help

From how flows are built, the likely failures, in order of how often I'd expect them:

1. **Property names and values.** Each node's properties (names, types, defaults, ranges) live in the editor's node
   classes (`editor/src/app/rete/nodes.ts`) and the node's codegen, not in a schema. An agent guesses `interval`
   for `intervalMs`, or a string pin. This is the biggest risk, and a prose doc alone will drift out of date.
2. **Wiring.** Edges are `[fromId, outputSlot, toId, inputSlot]`, zero-based. Multi-output nodes (function with N
   outputs, journal, clock, bme280 splitters) need the slot right. The editor drops a refused wire silently on load.
3. **Pins.** Guessed from memory instead of the board definition. The CLI's `--board` catches the invalid ones, not
   the plausible wrong ones.
4. **The message shape.** `msg = {'payload', 'topic'}`; a function node returns `msg`, `None` or a list per output.
5. **GUI layouts.** The `screens` section (pages, rows, columns, widget `node` references, fonts, `maxChars`) is the
   most complicated part of the file format and has the most ways to be quietly wrong (a screen sized differently
   from its display, a font missing a character).
6. **Credentials.** WiFi and MQTT configs hold a `credentialName`, never a password. An agent must not write secrets
   into a flow file, and must say which names the user has to create.
7. **Boards the project hasn't tested.** CLAUDE.md's rule: say what is covered and point at the MicroPython docs.

## Content

One document, in this order:

1. The loop: write the file, run `thingstudio-compile`, read the errors, fix, repeat; then the user opens it in the editor.
2. The flow file: top-level keys, `nodes`, `edges`, `configs`, `layout` (optional), `panes`, `screens`, `notes`. A
   small complete example (blink), then the headliner as the large one.
3. The `msg` convention, and how to write a function node.
4. A node catalog: type, kind, ports (with types), every property (name, type, default, allowed values). **Generated,
   not hand-written** (see below).
5. Config nodes: i2c-bus, touch-panel, wifi, mqtt-broker. Credentials by name only.
6. Boards: take pins from the board definition (`--list-boards`, `editor/src/definitions/boards/*.json`), never guess; unsupported boards.
7. GUI: screens and pages, with the size rule (screen = display = the panel's own size; orientation on the display).
8. Custom nodes: pointer to `custom-nodes.md`, which is already self-contained.
9. Worked examples to copy: `test-flows/` files by task (blink, MQTT publish, BME280 to display, touch buttons).
10. What it can't check, and what to tell the user to do next (create credentials, pick the board, deploy).

## The node catalog must be generated

The doc's value is mostly item 4, and it must not drift. Proposal: add `thingstudio-compile --describe [type]` (and
`--describe-all --json`) that prints each node's ports, kind and its property defaults, read from `NODE_FACTORIES`
and the registry, the same code the editor uses. Then:

- the doc says "run `--describe thingstudio/timer`" and includes a generated `docs/user-guide/nodes-catalog.md`
  (or the `llms-full.txt` below) built from the same command;
- a test fails if a node has a property in its class that the catalog lacks, so it can't go stale.

Allowed values and ranges are in the codegen's validation (error messages), not in data. For the first version the
catalog gives names, types and defaults; ranges come from the existing node pages and the compiler's own errors,
which an agent sees on the first check. Moving ranges into data is a larger refactor and not part of this item.

## Where it lives (one source, three outputs)

| Output | What | Cost |
| --- | --- | --- |
| `docs/user-guide/ai-authoring.md` | The page in the docs site, the source of truth | small |
| `llms.txt` and `llms-full.txt` at the docs root | The index of the pages, and the whole docs set as one file, built with the site | small: a script in the docs build |
| `AGENTS.md` written into the user's workspace folder on first run | The same text, so an agent opened in that folder finds it | needs a workspace folder concept |

Findings: there is no "user workspace" in the product yet. The nearest things are the backend's `~/.thingstudio/`
(custom nodes, credentials, presets) and wherever the user keeps flow files (the OS file dialog, no fixed folder).
So the `AGENTS.md`-on-first-run output needs a design call about which folder (probably `~/.thingstudio/` is wrong
since flows aren't there). A packaged skill is a fourth output of the same text; it can follow once the doc is proven.

My recommendation: do the page and `llms.txt` first, and offer the same text as a download or copy button ("Add this
to your AI assistant's instructions") in the docs. Defer the first-run `AGENTS.md` until there is a workspace folder.

## How we test it

A newcomer-test protocol for an agent, run with a fresh session that has only the doc, the CLI and the repo's
`test-flows/` (no source, no working notes):

| Task | Passes if |
| --- | --- |
| Blink an LED on a LOLIN S2 Mini | the flow validates with `--board`, and the pin is the board's LED |
| Read a BME280 and publish to MQTT on an ESP32 | validates; I2C pins from the board; credentials by name only |
| Show the reading on the Freenove 4" display with a trend | validates; screen size equals the panel's; deploy-time checks pass |
| Write a custom node that doubles a number | the package loads in the editor |
| Add a clock page to an existing flow | edits the file in place, still validates |

Per task record: validated first time (yes/no), number of check-and-fix rounds, deployed and ran (Mike on hardware for
the board tasks), and what it got wrong. The first run is expected to find doc gaps; fix the doc, not the prompt, and
re-run with a new session. Use a different task wording each round so the doc isn't tuned to a phrase.

## Work plan

1. `--describe` and the generated catalog, with its drift test (about half a day).
2. The `ai-authoring.md` page from the outline, using the catalog (a day).
3. `llms.txt` and `llms-full.txt` in the docs build (small).
4. The test protocol, run with a fresh session; fix the doc; repeat until the tasks pass (open-ended; budget two rounds).
5. A "copy this into your assistant's instructions" block and a skill packaging of the same text (after 4).
6. Decide the workspace folder, then first-run `AGENTS.md` (separate item).

## Decisions for Mike

1. Agree that the node catalog is generated from the code (`--describe`), not hand-written?
2. Agree to the page and `llms.txt` first, and to defer the first-run `AGENTS.md` until there is a workspace folder?
3. Is an MCP wrapper (the earlier question) in or out for this item? My recommendation: out until the test shows a shell command isn't enough.
4. Test tasks: are the five above the right ones, and who runs the board tasks (you, on your hardware)?
