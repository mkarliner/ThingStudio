# Thingstudio editor package

Shared rules are in the repo root `AGENTS.md` (read it first); this is the editor-specific orientation.

`editor/` is the browser app, the compiler, the node library, the flow-file layer, the protocol client and the
headless CLI. Cross-subsystem contracts live in `../interfaces/` — read the relevant spec before touching
`src/protocol/`, `src/definitions/`, `src/node-library/`, or a descriptor, and run its conformance test in the same
change.

Internal layering is enforced by `test/module-boundaries.test.ts` (run by `npm test`, and therefore by CI): `app/`
is the top layer (only `app/` and `cli/` may import it), `protocol/` is self-contained, `compiler/` does not import
`node-library/` or `app/`. Adding a legitimate new edge means updating that test deliberately, in the change that
adds it.

Typecheck with `./node_modules/.bin/tsc --noEmit`, test with `npm test`; delete stray compiled `.js` before
trusting either (root `AGENTS.md`).
