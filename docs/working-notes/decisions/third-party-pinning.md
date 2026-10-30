# Decisions — Third-party code: pinned, scriptless, gated

Status: detail file for `decisions.md`'s "Third-party pinning" index entry. The operative rule lives in the
repo-root `AGENTS.md` section of the same name; this file holds the per-source pin inventory and the reasoning
that doesn't need to sit in every agent's context.

- **2026-10-08 — Anything fetched from outside the repo is untrusted until it is pinned, scriptless and gated.**
  Three conditions, all mechanical: (1) pinned to an immutable identifier — a lockfile with integrity hashes,
  `requirements.txt` with `--hash`, an Actions commit SHA rather than a tag, a firmware tag plus a locally
  verified build; (2) installed without its own code running — `npm ci --ignore-scripts`,
  `pip install --require-hashes` with no build isolation, no postinstall hooks; (3) covered by a check that
  fails rather than warns when it changes — the CI audit gate, Dependabot alerts, the checksums
  `record-tested.sh` keeps for release images.
- **Why mechanical rather than vigilant:** a supply-chain compromise is designed to survive review — the package
  looks right and behaves until it doesn't (event-stream, ua-parser-js, node-ipc; the xz backdoor was caught by
  an unrelated performance test, not by anyone reading the code). Human care does not scale to that; a pin that
  goes red does. This is the fault-handling priority applied to code we did not write.

## The pin inventory

| source | the pin | enforced by |
|---|---|---|
| npm (`editor/`) | `package-lock.json` integrity hashes; `npm ci --ignore-scripts` | CI audit gate, `.github/dependabot.yml` |
| Python (`backend/`) | `backend/requirements.txt`, hash-pinned; installed `--require-hashes` | CI, docs and release workflows, `make` |
| GitHub Actions | 40-char commit SHA with a `# v7` comment, never a tag | every workflow |
| Firmware toolchain | MicroPython/ESP-IDF tag + a build verified on the board | `firmware/classic-esp32/build.sh`, `tested.json` |
| Vendored libraries | the reviewed copy in `device-runtime/src/vendor/` | no update path by design |

## Open questions, rules and process

- **Adding a source is a reviewed decision, not a convenience.** Name it, say why, and add the line to
  `docs/third-party-licenses.md` in the same change — that ledger doubles as the supply-chain inventory.
- **Change one thing at a time.** A single reviewed security bump with the tests run is reviewable; `npm update`
  or `pip install -U` is not.
- **Refuse on a fact, warn on a prediction.** A hash mismatch, or a version with a published advisory, refuses.
  "This looks risky" is a note in a brief.

Stated exceptions, not accidents:

- `docs/requirements.txt` is exact-pinned (`==`) but unhashed — it is build-only tooling and hoisting a lock
  file there buys little.
- MicroPython and ESP-IDF are pinned by tag rather than by hash because we build them locally and verify the
  resulting image on hardware.

npm's own package hygiene (install scripts, `npx` policy, lockfile regeneration on this tree) is a separate
section of `AGENTS.md`; its incident lives in `learnings/editor-build-tooling.md`.
