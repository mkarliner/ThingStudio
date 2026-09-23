# Documentation site — not scoped

`deployment-and-distribution-notes.md`: unclear whether this means a generated site off `docs/*.md` as-is or a purpose-built site for a different (end-user) audience than the working-notes/design-doc split serves today.

## 2026-09-23 update — local hosting built; GitHub Pages not live yet

Decided and built: the backend serves the built docs at `/docs/` for an installed copy; GitHub Pages is for
pre-install reading only (`decisions/documentation-process.md`, 2026-09-23).

Still open:

- **GitHub Pages returns 404** (`https://mkarliner.github.io/ThingStudio/`). `.github/workflows/docs.yml` runs
  `mkdocs gh-deploy` on pushes to `main` touching the docs. Likely causes, not yet checked: the workflow hasn't
  run since it was added, the repo is private (Pages on a private repo needs a paid plan), or Pages isn't set to
  serve the `gh-pages` branch (Settings → Pages → Source: "Deploy from a branch", `gh-pages` / root).
- `wifi-provisioning.md` exists in `docs/user-guide/` but isn't in `mkdocs.yml`'s nav — mkdocs warns on every
  build.
