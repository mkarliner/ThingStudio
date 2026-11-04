# An examples folder for the flows users copy

Status: decision, 2026-11-01. Mike picked it on review of where "the http blink flow" should live.

Thingstudio's *test* flows and its *example* flows are different things and now live in different places:

- **`examples/` (repo top level)** — the flows a user is invited to open and make their own: `blink`,
  `two-more-blinks`, `http-blink`, and the task examples the AI-authoring guide's "Examples to copy" table names.
  `examples/README.md` indexes them, links each to the tutorial or page that walks it, and the folder goes out with
  every release: `tools/make_bundle.py` copies it to the bundle root, beside the launcher, where the install keeps
  it. A bundle build fails if `examples/` has fewer than two flows, so a mistake there stops the release, not the
  user later.
- **`test-flows/`** — fixtures for hands-on node checks (`test-flows/README.md` says so at the top). It keeps the
  hero GUI rigs, the ai-authoring working set and the rig scripts.

Rules that ride along:

- `editor/test/flow-layout.test.ts` walks both folders recursively; a shipped flow reads left to right, and no
  subfolder can drift out of the gate.
- The test suites that compile "example" GUI-flow fixtures (cli-check-flow, gui-compile, gui-trend) read the moved
  flows from `examples/`, so examples stay compiled-clean as tests all the same.
- What makes something an example: it appears in `examples/README.md` and compiles with `--layout` clean. What
  makes something a test flow: it exists in `test-flows/` and is exercised by a rig script or a test.
- Not settled: how an **installed** copy surfaces these flows (today: browse to the install folder and use File →
  Open, or download from the docs' links). An editor "Examples…" affordance over the shipped folder is a product
  idea, not a decision; see `outstanding-items.md`.

## 2026-11-04: examples/ holds only the tutorial flows, and is renamed tutorials/

Mike: test flows and tutorial flows go in separate folders; test flows stay in the repo, tutorial flows are copied
to the installation. `examples/` now holds the four tutorial flows (`blink`, `two-more-blinks`, `http-blink`,
`blink-from-anywhere`). `basic-http-request`, `basic-mqtt`, `bmp280-test-flow`, `gui-touch-freenove-s3-4in` and
`gui-headliner-sensor-freenove-s3-4in` moved to `test-flows/`, and the tests that read them (cli-check-flow,
gui-compile, gui-trend) follow. The tutorial flows carry blank credential names: a flow never names a saved credential,
so the reader isn't pointed at one they don't have. `packaging/ai-skill/build.mjs` takes `blink` from `examples/` and
the rest from `test-flows/`. The skill build's check fails on the `test-flows/ai-authoring` flows ("elements is not
iterable"), unrelated to this change.

Mike, later the same day: the folder is `tutorials/`, not `examples/`. `tools/make_bundle.py` copies it to the bundle
root as `tutorials/`; the tests, the AI-skill build and the guide follow. The guide page follows: `tutorial-flows.md`, "Tutorial flows"
(not `tutorials.md`, which would collide with the tutorials section's URL).
