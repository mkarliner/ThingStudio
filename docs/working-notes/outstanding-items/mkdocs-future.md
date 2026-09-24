# MkDocs future: stay on 1.x for now, Zensical is the likely move

Status: open, not scheduled. Raised 2026-09-24 when mkdocs-material 9.7.7 started printing a banner about
MkDocs 2.0 during `make`.

## Where things stand (checked 2026-09-24)

- **MkDocs 1.x** (we pin 1.6.1) is unmaintained: no releases in about 18 months, no maintainer since 2024-08.
- **MkDocs 2.0** is a ground-up rewrite, still pre-release. It drops the plugin system, rewrites theming, moves
  config to TOML and has no licence yet. Material doesn't run on it and has capped mkdocs at `<2` since 9.7.5.
  So "upgrading mkdocs" to 2.0 isn't an upgrade path for us at all.
- **Material for MkDocs** reportedly goes into maintenance mode on 2026-11-05 (the date comes from a third-party
  issue, not confirmed on Material's own site).
- **Zensical**, from the Material authors, is meant as a drop-in replacement for MkDocs 1.x that reads
  `mkdocs.yml` as-is. We use no plugins and no theme overrides, so a switch should be small.

## What to do

Nothing now: 1.6.1 + Material 9.7.7 build fine and the output is static HTML the backend serves, so an
unmaintained generator is a build-time risk, not a runtime one. Revisit if a build breaks, a security issue lands
in either package, or before packaging (MVP item 7) fixes the docs toolchain into the installer. Trying it
means: pin Zensical in `docs/requirements.txt`, point the Makefile's `site/index.html` rule and `docs.yml` at it,
compare the built site, and update `docs/third-party-licenses.md`.

The banner is silenced in the Makefile (`NO_MKDOCS_2_WARNING=1`), not in CI.

Sources: https://squidfunk.github.io/mkdocs-material/blog/2026/02/18/mkdocs-2.0/,
https://github.com/portolan-sdi/portolan-cli/issues/892
