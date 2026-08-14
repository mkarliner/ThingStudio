# Working note: deployment and distribution, medium-term

Status: working note, 2026-08-14. Raised out of sequence during an editor
hands-on session — not tied to current Tier 0/1 work, not scoped as a
design yet, just captured as a set before it's lost. `thingstudio-design-doc.md`
doesn't cover hosting/distribution at all yet (§14 is repo/dependency
structure, not where things get served from) — this is new ground for the
docs, not a gap in an existing section.

Three needs raised together, medium-term (post-v1-pipeline-proof, pre-real-users):

- **Static site for editor hosting.** The editor (`editor/`) is already a
  static Vite build — no server-side component, WebSerial and the
  mpy-cross WASM compile both run entirely client-side. Hosting it is a
  "point a static host at `vite build`'s output" problem, not an
  architecture problem — but needs a decision on where (GitHub Pages,
  Cloudflare Pages, etc.) and, since WebSerial requires a secure context,
  confirming the chosen host serves over https by default.
- **Documentation site.** Nothing decided yet — not clear if this means a
  generated site off `docs/*.md` as-is, or a purpose-built docs site with
  its own structure distinct from the working-notes/design-doc split that
  serves *this project's own development* right now. Those two audiences
  (contributors reading `docs/working-notes/` vs. end users of a shipped
  tool) probably don't want the same document, worth keeping distinct
  when this gets scoped rather than assuming the existing docs tree
  becomes the site verbatim.
- **Runtime install page**, Tasmota-style
  (<https://tasmota.github.io/install/>) — a browser-based flashing page
  so a user can put `device-runtime` on a fresh board with no local
  toolchain. Tasmota's page is built on ESP Web Tools (Web Serial-based,
  same browser API `transport.ts` already uses for `DEPLOY`), which
  argues for reusing that rather than hand-rolling a flasher — but
  ESP Web Tools flashes a full firmware image at a given manifest/offset,
  which is a different shape of artifact than what exists today
  (`device-runtime/src/*.py`, copied onto a device's filesystem as loose
  files per `test/hil/README.md`'s manual flash steps, not a single
  flashable binary). Getting a Tasmota-style install page working
  probably implies deciding on a real build/packaging step for
  `device-runtime` (a frozen MicroPython image with the listener/runtime
  baked in, most likely) before the install page itself is buildable —
  that packaging question isn't scoped anywhere yet either.

Nothing here started. Listed for prioritization whenever v1's pipeline
work is far enough along to need it, not scoped as a design yet.
