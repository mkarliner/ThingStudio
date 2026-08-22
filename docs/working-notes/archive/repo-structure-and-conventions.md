# Working note: repo structure and conventions

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** This note's own "open
> follow-ups" list (device-runtime headless test setup, physical-hardware-
> gated items) was all completed in later sessions. Kept for historical
> reference, not active reading.

Status: working note, 2026-08-12. Closes out Task 2 from
`mvp-planning-briefing.md` ("code structure and conventions") — §14's
single-monorepo call, executed as an actual layout, plus the tooling and
convention decisions that fall out of it. Written up after discussion;
nothing here is final until code actually starts landing against it, but
it's specific enough to start against, not a rough sketch.

## Repo layout

```
README.md
LICENSE                        (not yet added — see "License" below)
CLAUDE.md
docs/
  thingstudio-design-doc.md
  working-notes/                (this file, and everything else already here)
editor/                         the browser app — one package, not a workspace of many (see below)
  src/
    canvas/                     Litegraph integration, UI shell, status/log/inspector panel (§8)
    compiler/                   graph -> Python codegen (§6), the node codegen registry
    protocol/                   §13 message types, CBOR encode/decode, WebSerial transport client
    node-library/                per-node-type descriptors + codegen entries (node-definition-model.md)
    flow-file/                  git-friendly serialization, save/load (File System Access API + fallback)
  test/                         off-device unit + adversarial tests, run in Node via Vitest
  package.json
  vite.config.ts
device-runtime/                 MicroPython: listener, fault isolation, state store, native glue
  src/
    vendor/                     manually-vendored third-party MicroPython packages (mqtt_as/, added
                                 2026-08-14) -- same hash-recorded/provenance-documented discipline as
                                 mpy-cross-wasm/, not an npm-installable dependency
  test/                         headless MicroPython unix-port tests
mpy-cross-wasm/                 POC-B's build recipe + build artifacts, vendored (not an npm package)
test/hil/                       witness firmware, pin-map config, hardware-in-the-loop scripts (manual, not CI)
tools/                          license-scan script, build scripts
pocs/poc-a/ pocs/poc-b/ pocs/poc-c/ pocs/poc-d/     kept as-is, frozen, historical reference
.github/workflows/
```

`README.md` and `CLAUDE.md` stay at repo root — the two files tooling and
future Claude sessions expect to find there by convention, same reasoning
as not moving them into `docs/` earlier this session. `LICENSE` will join
them once formalized.

## Package structure: one editor package, not an npm workspace

Compiler, protocol, and node-library are separated by directory inside
`editor/src/`, not by npm package boundary. This mirrors §14's own
reasoning against splitting into separate repos ("a reasonable v2 move
once there's an actual external contributor base wanting to work on one
piece independently") — the same logic applies one level down to npm
workspaces. Real workspace-splitting is easy to introduce later if
something (a v2 companion server, say) needs to import the compiler
standalone; premature now.

## Language: TypeScript for the editor

The one substantive language call. The `msg` envelope's typed payload,
the node codegen registry (a real interface every node type has to
satisfy — see `node-definition-model.md`'s draft contract), and §13's
CBOR message shapes are exactly the case where static typing catches a
mismatched contract at build time instead of on-device at runtime.
`device-runtime/` stays Python (MicroPython target, no choice there).

## Build tooling: Vite + Vitest

Vite as the bundler, replacing the POCs' no-build-step `<script src>`
habit — §14 itself flags that a real editor app will want this rather
than carrying the POC habit over by default. Vitest as the test runner,
since it shares Vite's config and keeps dev/test tooling in one place.

## Dependency management and vendoring policy

npm plus a committed lockfile for anything that's an actual npm package
(Litegraph, a CBOR library) — this *is* the grown-up version of what the
POCs were doing by hand with `npm pack --ignore-scripts` and manual
hash-verification; the lockfile's integrity hashes serve the same purpose
with less friction. See `CLAUDE.md` for the standing rule this triggers —
Mike gets warned before any new package is added, with the
`npm-security-best-practices` checklist (ignore-scripts by default, no
git-based deps, `npm ci` not bare `npm install`, no blind bulk upgrades)
applied at that point.

Manual vendoring, with the POCs' hash-verification discipline, continues
for exactly one thing: `mpy-cross-wasm`, since it's a custom Emscripten
build (POC-B's recipe), not an npm-installable package. §5 already calls
out re-verifying it byte-identical against a native `mpy-cross` build on
every MicroPython version bump as an ongoing responsibility — worth
wiring into CI once the build recipe is checked in, not left as a manual
step someone has to remember.

## Python conventions: ruff

Lint and format `device-runtime/`'s Python in one tool. Expect some
false-positive "undefined name" noise on MicroPython-only names
(`uasyncio`, `machine`, `micropython`) that a CPython-oriented linter
doesn't know about — configure around it rather than suppressing broadly.

## Naming

"Harness" is retired as a name for the on-device listener/protocol-
handler component, per the earlier session discussion — too easily
misread as agent-harness given current usage. Real v1 code uses `runtime`
and `listener`, matching the design doc's own §5 vocabulary. This doesn't
touch `poc-a`/`poc-d`'s `harness.py` — frozen, historical, not renamed
retroactively.

## CI: GitHub Actions, split by what's actually automatable

Runs on every push: the editor's off-device Vitest suite (compiler
regression and adversarial-graph tests, CBOR round-trips, adversarial
frame-parsing, version-handshake matrix — see
`validation/mvp-validation-plan.md`'s Tier 0 section) and the
device-runtime's headless MicroPython unix-port tests.

Explicitly **not** in CI: anything needing the physical witness+DUT rig
(`test/hil/`). That stays a manual, documented local gate before merging
hardware-facing Tier 0/1 changes, with results recorded in the validation
plan's dated Results sections — matching how the POCs themselves were
verified. Revisit if/when self-hosted runners with real attached hardware
ever become worth the operational cost; not assumed for v1.

## License

Apache-2.0 remains the recommendation (design doc §14), not yet
formalized as an actual `LICENSE` file — that's a real follow-up action,
not done as part of this note, since committing the literal file is a
more final step than documenting the plan to. SPDX-style header comments
on first-party source files are the natural companion convention once the
file exists; not adopted yet either.

## Open follow-ups this note doesn't resolve

Done since this note was written: the `LICENSE` file and SPDX header
convention, the node codegen registry's concrete interface
(`editor/src/compiler/node-definition.ts`), the real
`package.json`/`vite.config.ts`/`tsconfig.json` scaffolding,
`.github/workflows/ci.yml`, and the real wire protocol (§13) — CBOR
framing, message types, the version-handshake matrix
(`editor/src/protocol/{errors,messages,framing,codec,version,protocol}.ts`,
`cborg` added as the CBOR dependency; see
`validation/mvp-validation-plan.md`'s dated Results entry). Still open:

- The real wire protocol's device-side half — the actual listener/
  protocol handler on `device-runtime`, needs hardware to build against
  safely (see "Fault isolation" in the validation plan).
- `device-runtime`'s headless MicroPython unix-port test setup — nothing
  wired up yet, `ci.yml` has a placeholder job comment rather than a fake
  job for it.
- Everything needing physical hardware (fault isolation validation, the
  witness+DUT rig itself) — blocked on that, tracked in the validation
  plan, not something to force from here.
