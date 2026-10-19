# Proposal: one approval rule for every kind of dependency

2026-10-19. **Status: proposal, awaiting Mike** -- a change to the project rules, not made. Context:
`docs/security-policy.md` §2 (the supply chain is a Defend tier) and §3.7 (gaps). Today's `AGENTS.md` section
"npm / Node.js package use" covers npm only; PyPI packages, GitHub Actions and vendored binaries have no
flag-and-approve step, and the vendored MicroPython WASI interpreter went into the compile path without one.

If accepted, the text below replaces that section in `AGENTS.md` (keeping its npm rules word for word as the npm
subsection), `docs/security-policy.md` §3.7's first gap is closed, and its "Rules that always apply" line drops
"(proposed)".

---

## Dependencies and vendored artifacts: ask first, pin everything

The supply chain is one of Mike's top-level security concerns (`docs/security-policy.md`, Defend tier). Every kind of
third-party input gets the same step: **warn Mike and get approval before adding or upgrading it** -- name it, say
why it's needed, who maintains it and how healthy it looks, and how it will be pinned. This applies to:

- **npm packages** (dependencies and dev dependencies) -- the rules below.
- **PyPI packages** -- backend, docs tooling, test tooling, anything a script `pip install`s.
- **GitHub Actions** -- any new `uses:` line, or a version change to one.
- **Vendored files and binaries** -- copied source, `.wasm`, firmware, fonts, a wheel's contents, anything committed
  that we didn't write. Includes a spike artifact promoted into the repo.
- **Anything an agent downloads and runs or commits**, including one-off tools.

Pinning, by kind:

- **npm**: lockfile and `npm ci`; see the npm rules below.
- **PyPI**: exact versions for anything shipped (`packaging/constraints.txt`), with hashes (`--require-hashes`) once
  the bundle supports it; ranges only for development installs.
- **GitHub Actions**: pin to a full commit SHA, with the version tag in a comment (`uses: actions/checkout@<sha> #
  v7`), not to a tag, which can be moved.
- **Vendored binaries**: record the source URL, version, and SHA-256 in a README beside the file; prefer a build we
  can reproduce from a pinned upstream commit (the `mpy-cross-wasm` pattern). A binary built from an unmerged or
  alpha upstream needs that called out in the approval request.

Always: add or update the entry in `docs/third-party-licenses.md` in the same change.

### npm specifics

(The current "npm / Node.js package use" rules, unchanged: install with `--ignore-scripts`; no git-URL dependencies;
lockfile and `npm ci`; no blind bulk upgrades; sanity-check before adding; prefer fewer dependencies; never run
arbitrary `npx <package>`; always `npx --no`.)

### Python specifics

- Install into a virtual environment, never the system Python; `pip install --no-deps` from a pinned list when
  building anything shipped.
- No `pip install git+...` or arbitrary URLs; same reasoning as git-URL npm dependencies.
- Prefer wheels (`--only-binary=:all:` where the bundle already requires it): an sdist runs `setup.py` at install.

---

## Retroactive items under this rule

- **`micropython-wasi/micropython-wasi.wasm`**: needs Mike's approval as it stands (alpha wheel from a third-party
  PyPI publisher, built from unmerged MicroPython PR #13676), and the pinned reproducible rebuild already planned
  (`docs/working-notes/reviews/2026-10-19-compile-hooks-response-reply.md`, finding 14).
- **GitHub Actions in `.github/workflows/`**: all pinned by tag today; re-pin to SHAs in one change.
