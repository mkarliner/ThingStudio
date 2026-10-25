# Firmware catalogue: manufacturer repositories, and what a catalogue source is

Status: not started; recorded 2026-10-25 from Mike ("an extension of what we're doing is to allow board
manufacturers to supply a URL which adds a catalogue of board definitions, available builds etc. Think the kind of
model that apt uses to add a new apt repository"). Design direction: `decisions/firmware-catalogue.md`.

## The idea

One built-in catalogue (`firmware/builds.json`, in the repo, hashes pinned) covers the boards and chips we know.
A manufacturer — or a school, or anyone maintaining a board family — adds a source: a URL pointing at an index that
carries board and processor definitions, builds, and versions. The user adds it once, and those boards and images
appear beside ours.

## Why it fits this project

- The "everything is a plugin" default: a third party adds boards the same way we do, without a core change.
- It is the same shape as the board/processor definitions already copied into `~/.thingstudio`, and the same shape
  as this catalogue, so the vocabulary does not grow.
- The alternative — every vendor board needing a Thingstudio release — is the trap the flash recipes fell into.

## The hard part: trust

Two very different things come from a source:

- **Definitions** (pins, match strings, `variant` pointers) — data the editor validates and the user can read. A
  bad one mislabels a pin or points at the wrong image; annoying, not dangerous.
- **Builds** (a URL to bytes that will be written to the user's flash) — arbitrary code on their hardware. Today
  every build is pinned by sha256 in a file a human reviewed.

So a source's builds need a hash inside the source, and adding a source needs an explicit, named acceptance with
what it can do spelled out. Never silent, never automatic — the same rule as the third-party package ledger.

## What to keep open now (cheap)

The loader takes a list of sources; the built-in file is source 1. No user-facing "add a repository" UI until
someone has a repository to add.

## Open questions

- Where the user's list of sources lives (`~/.thingstudio/firmware-sources.json`?), and how a source is removed.
- Whether a source can override a built-in board id (probably refuse, and say which source clashes).
- Whether freshness matters enough for a source to be refreshed on start, and what the failure looks like offline.
