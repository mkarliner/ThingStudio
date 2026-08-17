# Project rules for Thingstudio

Orientation for anyone (human or Claude) picking this project up: `docs/thingstudio-design-doc.md` is the design doc, `docs/working-notes/` is active planning. Read the design doc in full before proposing architecture changes.

## Engineering priority: fault handling over happy-path behavior

The measure of a good system is not how well it works but how well it fails. When a design or implementation choice trades off clarity/robustness of fault handling against the happy path, fault handling generally takes priority — timeouts, error attribution, degradation behavior, and recovery paths are not secondary polish added once the happy path works, they're load-bearing. This is already the working convention this project applies to hardware/protocol work (§5's fault isolation, the wire protocol's adversarial framing tests, bounded timeouts on network I/O) — worth stating explicitly so it's applied consistently to new work too, not just re-derived per feature.

## No premature optimization, but don't paint into an architectural dead end

Default to the cheapest implementation that's actually correct — don't build the general/heavy version of something on spec before a real need forces it. But before taking the cheap path, check whether it forecloses a future direction that would otherwise be nearly free to keep open: if a shortcut is a one-way door (a field that can't be added later without stranding already-deployed devices, a data shape that can't grow without a breaking migration), the cost of avoiding that lock-in now is usually much lower than the cost of undoing it later, and that comparison is worth making explicitly rather than skipped in the name of avoiding premature optimization. This project already applies the pattern — reserving `HELLO`'s `authRequired`/`authScheme` fields and laying out OTA-capable partitions on the ESP32 build before either feature is built (`mvp-feature-priorities.md`, Tier 0) are both "ship the cheap version, but don't foreclose the expensive one" calls, not exceptions to the cheap-by-default rule. Worth naming explicitly so it's applied consistently to new work — including plain engineering-effort trade-offs, not just protocol/hardware one-way doors — rather than re-derived per feature.

## Commits

Prompt Mike at suitable points to commit — don't assume auto-commit and don't let uncommitted work pile up silently. Suitable points: after a coherent unit of work lands (a doc section resolved, a feature/module working), before starting something new or risky, and at the end of a work session regardless of how small the change was.

## npm / Node.js package use

Warn Mike before installing or adding any npm/Node.js package (dependency or dev dependency) — name the package, why it's needed, and flag it before running the install. Once flagged, follow [lirantal/npm-security-best-practices](https://github.com/lirantal/npm-security-best-practices) where reasonable:

- **Install with scripts disabled by default**: `npm install --ignore-scripts <pkg>`. Only re-enable/run a specific package's install script after checking what it actually does and why it's needed — never blanket-trust a `package.json` postinstall hook.
- **Avoid git-based dependency URLs** — they bypass registry scanning/provenance and can ship an `.npmrc` that silently re-enables scripts.
- **Use lockfiles and deterministic installs**: `npm ci`, not bare `npm install`, once a lockfile exists; commit the lockfile.
- **Never blindly bulk-upgrade** (`npm update`, `ncu -u`) — review dependency updates individually, or via `npx npm-check-updates --interactive`.
- **Do a quick sanity check before adding a new dependency**: recent maintenance activity, whether it has an install script at all, and — if anything looks off — `npm pack <pkg> --dry-run` rather than trusting the registry page's displayed source blindly.
- **Prefer fewer dependencies** — a small native-JS implementation over pulling in a small utility package, where reasonable.
- **Never run arbitrary `npx <package>`** for one-off tool use — pre-install into a lockfile-tracked location first, then run it offline against the pinned version.
- **Always run `npx` with `--no`** (e.g. `npx --no <pkg>`) when the package isn't already a project dependency, even for a "just checking something quickly" one-off. Without `--no`, npm's own docs say it normally prompts before installing a missing package — but in a non-interactive shell (exactly what this environment is) it silently assumes `--yes` and installs without asking. `--no` makes npm refuse and error instead, which is the actual enforcement mechanism behind the rule above, not just a reminder to be careful.

Not every practice in that doc applies here — the maintainer-side items (2FA, provenance/OIDC publishing) are only relevant if this project ever publishes its own packages, not to installing dependencies.

## Git writes from the agent sandbox

Same underlying cause as the `node_modules` cross-platform corruption bug (`editor-hands-on-briefing.md`): the agent sandbox and Mike's real Mac share the same live-mounted repo, and the sandbox cannot delete files it just created on that mount (`Operation not permitted` on unlink) — confirmed for `.git/index.lock`, `.git/HEAD.lock`, and `.git/objects/*/tmp_obj_*`. `git add`/`git commit` from the sandbox routinely leave one of these behind, which then blocks the *next* git command (from either side) until someone with real delete permission — Mike, in a real Terminal — removes it.

Read-only git commands from the sandbox (`status`, `log`, `diff`) are fine. For writes (`add`, `commit`), hand Mike the exact command(s) to run himself in a real Terminal, rather than running `git commit` from the sandbox — cheaper than the repeated "run `rm -f .git/*.lock`, retry" cycle this cost a full session before the pattern was recognized.

## Third-party software tracking

`docs/third-party-licenses.md` is the running ledger of every third-party dependency in use — runtime/platform components, editor build tooling, and anything vendored — with its license. Keep it current in the same change, not batched up for later: any new npm package (already requires the flag-and-approve step above), any newly vendored library, or any platform/runtime component decision (a different ESP-IDF version, a different MicroPython fork, etc.) gets a line added or updated there immediately, pulling version/license straight from the installed package metadata rather than from memory.
