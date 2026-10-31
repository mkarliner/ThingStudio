# Authoring brief: the tester-ready tutorial ladder

Status: brief for the next authored session, filed 2026-10-31. The context diet is closed (branch
`docs/context-diet` pushed through `4bee66c`); the tutorial ladder is the one [P1] work item it left open
(`outstanding-items.md`, "[TR] [P1] Tester-ready tutorials", scope `docs/tester-ready.md`). Everything
below is agreed with Mike; nothing here is to be re-derived.

## The scope discussion (agreed 2026-10-30, recorded in `docs/tester-ready.md`)

1. **The ladder: five tutorials, each starting from the previous flow**, so the user keeps a working flow
   while learning one concept per step:
   1. Onboard → blink the LED (the existing Getting started, adapted).
   2. Function read/write — a `function` node reads the pin and writes the inverse
      (`machine.Pin(n).value` read-modify-write, the docs' sanctioned raw-hardware path), with the caveat
      stated: the compile-time pin checker cannot see inside function code, so a wrong pin there fails on
      the board, not at compile.
   3. State — the LED state in node context
      (`context.set('led', not context.get('led', False))`); one sentence that `change` does the same
      without code (flow variables).
   4. Connected — blink from an `http in` node, reusing step 3's toggle. Teaches WiFi config/credentials
      and "how do I find the board on my network", and carries the one-line open-LAN-port security note.
   5. MQTT — publish and subscribe, from the HTTP-in flow's config nodes. In scope not because the ladder
      reaches it naturally but because real users demonstrably go there themselves (the adventurous-user
      learning below).
2. **Learner profiles are the design axis** — every tutorial page serves all five rather than having
   separate structures: path-follower (one unambiguous success per step), adventurer (loud, attributed
   failures and success-point pointers — their loop is error → explanation, silence kills it), reader
   (docs-vs-product contradictions are the worst failure), sample-scavenger (complete importable flow per
   tutorial, Node-RED-style; good failure messages when edits break), goal-driven arriver (task-first
   navigation, already the docs rule).
3. **The "getting adventurous" learning (2026-10-30):** the newest user blinked an LED and went straight
   to MQTT. Users don't follow the directed path; a bit of success makes them adventurous. Don't fight it,
   wire it: pointers at success points ("next, pick:" with 2-3 links), make adventure fail loudly (MQTT's
   missing WiFi/broker config must be a one-line compile error and an FAQ entry, not silence), and treat
   tutorial validation as watching where a user leaves the path — onboarding reports gain
   **"what did you try next, and what happened?"**.

## Owed when tutorial work starts (same-change per the standing rules)

- Success-point pointers ("next, pick:"), in every tutorial, at each success.
- The MQTT missing-WiFi/broker-config compile error, plus its FAQ entry
  (`docs/user-guide/faq.md`, one-line style).
- The function-node pin caveat, stated in place in ladder step 2.
- The HTTP-in open-port note (step 4) — one line, not a lecture.
- The onboarding-report question added to the report sheet.

## How the work is shaped

- Pages go in `docs/user-guide/` under the tutorial structure there, written to
  `docs/working-notes/docs-style-guide.md` (read it first; short sentences, definitions over elaboration).
- Each tutorial carries an importable flow file; hand-laid-out flows and generated flows follow
  `docs/user-guide/ai-authoring.md#layout` — columns ~220 px, ~36 px between stacked nodes; when authoring
  flows, run `editor/dist-cli/thingstudio-compile.mjs --relayout` then `--layout` to verify
  (`editor/test/flow-layout.test.ts` fails shipped flows with leftward wires).
- Tester-ready is the scope doc, not the schedule; the priority lives in the [P1] outstanding item. A
  natural first session: draft tutorials 1-2, validate each with a fresh importable flow, then continue
  down the ladder.
- Anything the tutorials expose about the product (a silent failure, a missing constrain) is a bug report
  first, not a tutorial workaround — fault handling beats happy-path prose.

## Environment facts (this box, verified 2026-10-31)

- **Everything the tutorial work needs runs locally now.** `docs/context-diet` clean and pushed to origin
  through `4bee66c` (based on `d312e9f`); merge is Mike's call.
- **Node**: 22.23.4 user-local in `~/.local/opt/node-v22.23.4`, symlinked into `~/.local/bin` (shadows
  apt's Node 20; open shells need `hash -r`). Node 20 cannot run the editor's compile-hook wasm — see
  `check-node`'s now-22.12+ floor and the WasmGC entry in `learnings/editor-build-tooling.md`.
- **npm**: works; in `editor/` always `npm ci --ignore-scripts` (a plain `npm install` fails; regenerate
  the lock with `--legacy-peer-deps` only if ever needed).
- **Suites, all green this box**: editor 1286 passed / 2 skipped (114 files); backend 361 (`make backend`,
  `.venv/bin/python -m pytest backend/test`); `make check-protocol`.
- **MicroPython**: `micropython` (unix port) and `mpy-cross`, both built 2026-10-31 from one commit
  (`321fba0d16`, mpy v6.3) in **`/tmp/opencode/mpy-src/`** — ephemeral; if wiped, rebuild (~2 min recipe in
  `device-runtime/test/README.md`, never on the shared Mac mount). Device-runtime headless suite: 295 tests
  green across 20 files, `test_exchanges.py` 13/13, `audit_protocol_exchanges.py` all fixed. One
  `test_exchanges` flake noted on a busy box — rerun before suspecting code
  (`learnings/micropython-device-runtime.md`).
- **Git**: no identity configured on this box — commit per-invocation
  (`git -c user.name='Michael Karliner' -c user.email='mike@karliner.net'`); Mike may want `git config`
  once. sudo works but is Mike's only (passwordless can expire mid-session; ask before using).
- **Boards/serial**: not touched this session.
