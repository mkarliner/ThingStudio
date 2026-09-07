# Working note: documentation — tech selection (activity 3 of 3)

Status: decided, 2026-09-07. **MkDocs + Material, hosted on GitHub Pages for now.** Written in response to
Mike naming this the still-open question ("readthedocs or something") after the scoping pass
(`documentation-scoping.md`) landed; confirmed in conversation the same session after Mike asked whether MkDocs
can be self-hosted (yes — `mkdocs build` produces plain static HTML/CSS/JS, hostable anywhere) and chose
GitHub Pages as the starting host "for the moment" rather than Read the Docs or self-hosting. **Not a one-way
door**: MkDocs' output is static files with no server-side dependency on GitHub Pages specifically, so moving to
self-hosting, Read the Docs, or anywhere else later is a hosting-config change, not a rebuild of the docs
themselves — worth naming per `CLAUDE.md`'s "don't paint into a dead end" check, satisfied trivially here.

## What this choice actually needs to satisfy

Pulled from what's already on record, not invented fresh for this note:

- **Markdown source, plain and concise** — `CLAUDE.md`'s own end-user-doc style rule (short sentences, 3–4
  sentence paragraphs, Node-RED's Concepts page as the pacing reference) doesn't depend on the tool, but a tool
  that fights plain Markdown (forces a proprietary format, heavy component authoring) works against it.
- **Fewer new dependencies, and any new npm package gets flagged before installing** — `CLAUDE.md`'s standing
  npm policy. A JS/npm-based tool isn't disqualified, but it's not free the way a Python-based one is, since this
  project's `editor/` already carries a real `node_modules` tree and its own build-tooling hazards
  (`CLAUDE.md`'s "npm install / build / test from the agent sandbox" section) that a Python-based doc tool
  sidesteps entirely.
- **Shares a content source with the in-editor node reference, not a walled-off docs directory** —
  Mike's own new requirement, `documentation-scoping.md`'s 2026-09-07 addendum. A tool needs to either read
  Markdown/JSON that also lives near `editor/src/node-library/`, or be simple enough that keeping the two in sync
  by hand isn't real ongoing cost.
- **Hosting that doesn't quietly answer the still-open CI-vendor-neutrality question** — `outstanding-items.md`'s
  own tracked, still-unresolved item ("should CI be independent of GitHub specifically?"). GitHub Pages ties
  publishing to GitHub; a host independent of it leaves that question open rather than deciding it by default via
  tooling choice.
- **No live backend assumed** — nothing in this project's architecture serves docs dynamically today or is
  likely to soon; a static-site generator is the right category, not a documentation "platform" with its own
  server.

## Candidates

**MkDocs + Material theme.** Python-based, YAML nav config, plain Markdown source, built-in search, light/dark
theme, versioning available via a plugin if ever needed. Zero new npm dependency — a `pip install`, alongside
this project's existing Python side (`device-runtime/`), so it doesn't touch `editor/`'s `node_modules` tree or
trigger the sandbox build hazards `CLAUDE.md` already warns about. Very well-established for exactly this
register of docs (concise, technical, end-user-facing) — FastAPI, Traefik, and a long list of hardware/IoT
projects use it. Plain Markdown files are trivially shareable with an in-editor reference (read the same `.md`
file, or a JSON sidecar, from both places) since there's no proprietary format or build-time-only transform
standing in the way.

**ReadTheDocs (hosted) + Sphinx.** The option Mike named directly. Two separable things worth naming apart: the
*generator* (traditionally Sphinx, reStructuredText by default, though the MyST plugin lets Sphinx read Markdown
instead) and the *host* (readthedocs.org, an independent, free-for-open-source hosting platform — not GitHub,
which directly answers the vendor-neutrality question above). Sphinx by itself is heavier tooling than this
project's doc needs justify (its extension ecosystem is built for large multi-format API-reference projects);
RST specifically would be a new syntax to learn against no real benefit here. Read the Docs the *host*, though,
is worth keeping regardless of generator — it now natively supports MkDocs projects too, not only Sphinx, so
"ReadTheDocs" and "MkDocs" aren't actually competing options.

**VitePress.** Vue + Vite based, Markdown source with the option to embed live Vue components directly in a
page. Real synergy worth naming: the editor itself is Vue + Vite (`PropertyPanel.vue`, `PaletteSidebar.vue`), so
a shared component (or at least shared design tokens) between the docs site and the in-editor reference tab is
more directly possible here than with any Python-based tool. Costs a new npm devDependency — flagged per
`CLAUDE.md`'s policy, though it would sit in `editor/`'s existing npm tooling rather than introducing a second
language toolchain. Newer and smaller ecosystem than MkDocs/Sphinx; fine for this project's scale, just less
battle-tested elsewhere.

**Docusaurus.** React-based, Markdown/MDX, versioning and i18n built in. Overbuilt for what this project needs
today — those two headline features (multi-version docs, internationalization) aren't asked for anywhere on
record — and it's the heaviest new-dependency cost of the four (a full React toolchain alongside Vue), which cuts
against "prefer fewer dependencies" for no benefit this project has asked for.

**Plain Markdown, rendered by GitHub only, no generator.** Zero new dependency, zero setup. Real cost: no search,
no real navigation/sidebar once the guide has more than a few files (a real risk once the 14-entry node reference
in `documentation-scoping.md` gets written out), and no natural place to enforce the shared-content-with-editor
requirement beyond manual discipline. Fine as a stopgap, not a real long-term answer to activity 3.

## Decision

**MkDocs with the Material theme.** This isn't a rejection of what Mike named — MkDocs is the best fit on every axis that isn't about hosting: no new npm dependency, plain Markdown that a
future in-editor reference can read directly, minimal setup and maintenance, and a style track record that
matches this project's own "concise, not exhaustive" convention closely. **Hosting: GitHub Pages, for now** —
Mike's own call, made knowingly against the still-open CI-vendor-neutrality question (`outstanding-items.md`) —
worth someone circling back to when that question itself gets picked up, not silently resolved by this choice.

**VitePress is the real alternative worth naming**, specifically if Mike wants the in-editor node-reference idea
to lean on actual shared Vue components rather than shared Markdown text — a stronger form of "single source"
than MkDocs can offer, at the cost of a new npm dependency in an already-npm-heavy part of the repo.

## What this note does not do

- Does not install anything, or run `pip install`/`npm install` — a real decision from Mike first, per the same
  policy that already governs npm packages.
- Does not touch activity 2 (structure/format) — nav layout, one-guide-vs-two, and the node-reference page split
  are unaffected by which generator renders them, and stay open regardless of this pick.
- Does not resolve the in-editor node-reference item's own open UI design questions
  (`outstanding-items/in-editor-node-reference.md`) — only the "keep the content source shareable" requirement
  those questions impose on this choice.

## Follow-up for whoever builds this (activity 2 / implementation)

- Installing `mkdocs` + `mkdocs-material` (both pip packages) needs an entry in `docs/third-party-licenses.md`
  at install time, per `CLAUDE.md`'s third-party-tracking rule — pull version/license from the installed package
  metadata then, not from this note.
- GitHub Pages publishing needs a build step (a GitHub Actions workflow running `mkdocs gh-deploy` or equivalent)
  — this is new CI surface, worth a one-line cross-reference from `outstanding-items/ci-vendor-neutrality.md` once
  it exists, since it's the first real instance of that open question actually mattering in practice.
