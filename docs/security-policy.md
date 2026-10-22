# Security policy

Status: **draft, 2026-10-19** -- written in a session with Mike; records what is built and decided, with gaps and
open decisions marked. Rationale: `docs/thingstudio-design-doc.md` §9; history: `docs/working-notes/decisions/`.
Update this file in the same change as anything it describes.

## Check this first

If your change does any of the following, it has security implications: read the section named before writing code,
and update it in the same change. If none apply, you do not need to read further.

| If your change... | Read |
|---|---|
| adds or upgrades a dependency (npm, PyPI, GitHub Action), vendors a file or binary, or touches CI, release or installers | §3.7 -- **Defend tier** |
| adds or changes a backend HTTP route, WebSocket message, bind address, CORS or Host handling | §3.1 |
| reads, stores, sends, logs, displays or bakes in a secret (WiFi/MQTT/board password, any credential) | §4 |
| changes which code runs where: `function` node, custom nodes, compile hooks, package loading, the CLI | §3.4 |
| touches the board link: serial, WiFi TCP transport, its auth, discovery, board settings | §3.2, §3.3 |
| touches WiFi provisioning or the board's setup access point | §3.5 |
| makes a node talk to an outside service, or parse network input on the board | §3.6 |
| lets the backend and the editor run on different machines, or exposes the backend beyond loopback | §5 |
| adds a new place data or code comes from or goes to, not covered above | §1 and §2, then add a row here |

No implications: node behaviour that stays inside the flow, editor UI and layout, docs, and tests that touch none of
the above.

**Rules that always apply:**

- No new dependency, vendored file or binary without Mike's approval first (`AGENTS.md`, "npm / Node.js package
  use"; extending that rule to every kind of dependency is proposed, §3.7).
- Fail closed: a missing secret or failed check stops the compile, deploy or connection; never a silent fallback.
- No secret in a flow file, log line, console message, compile error, catalog or test fixture.
- Opening is safe, deploying is trusting: loading a flow or package must not be able to harm the host; the editor
  never executes package code outside the compile-hook sandbox.
- Nothing listens beyond loopback without authentication.
- A new boundary gets a row in the table above and a tier in §2.

## 1. Zones

| Zone | What it holds |
|---|---|
| Editor (browser tab) | the open flow; resolved secrets in memory during compile/deploy |
| Compile-hook sandbox | a package's `compile.py` running in a WASM worker |
| Backend process | the relay, the admin API, access to `~/.thingstudio` |
| Host machine | `~/.thingstudio` (credentials, board passwords, custom nodes, presets, definitions); saved flow files |
| Host's network | editor/backend traffic (today loopback only); discovery and WiFi transport to boards |
| USB/serial link | an unauthenticated control channel to the board |
| Board, running | runtime; deployed flow with secrets baked in; board password key; WiFi credentials |
| Board, physical | the same, readable off flash by anyone holding it |
| Board's network | the WiFi transport listener; the flow's own traffic |
| Board's setup AP | the captive portal used for WiFi self-provisioning |
| Outside services | MQTT brokers, HTTP endpoints, NTP servers a flow uses |
| Code sources | custom-node packages, shared flow files, bundled examples, AI agents using the CLI and skills |
| Supply chain | npm and PyPI dependencies, GitHub Actions, vendored binaries, CI, releases, installers, the MicroPython firmware users flash |
| Not yet built | a backend on another machine (§5), node registries/marketplace, a team or fleet server |

## 2. Threat tiers

Every attacker position gets one stance. The stance says how hard the boundary must hold, so nobody over- or
under-builds.

- **Defend** -- must hold. A break is a bug, fixed with priority.
- **Mitigate** -- raise the cost and limit the damage; the residual risk is written down.
- **Accept** -- known, left as is, and users are told.
- **Out of scope** -- no sensible protection exists. Say so plainly, and limit what the attacker gets (below).

| Attacker | Stance | Notes |
|---|---|---|
| The supply chain: a compromised or malicious dependency, Action, vendored binary or release path | **Defend** | One of Mike's top concerns; the project rules have reflected it from the start (§3.7) |
| On the internet, no foothold | Defend | nothing is exposed; the backend is loopback-only |
| A malicious web page in the user's browser | Defend | DNS rebinding and cross-site requests; the Host allowlist (§3.1) |
| Content the user chooses to load: a flow file, a package, AI-written code | Defend the host; accept on the board | opening is safe, deploying is trusting (§3.4) |
| Someone on the board's network | Mitigate | the board password guards deploys (§3.3); the setup AP doesn't reopen by itself (§3.5) |
| Eavesdropping on the board's WiFi | Accept | the network's encryption is the control (assumption 1) |
| Someone on the backend's network | Defend, when reachable | does not apply today (loopback); posture 2 (§5) |
| Another local user on the host machine | *open decision 1* | credential files are owner-only, but loopback is reachable by every local user |
| A compromised upstream we can't pin away (MicroPython itself, GitHub, PyPI) | Mitigate | pinning, hashes, reproducible builds narrow it; the remainder is accepted |
| Code running as the user on the host (malware, an agent with the user's privileges) | Out of scope | the user's own account can't be defended against |
| Physical possession of the board | Out of scope | flash is readable and serial is unauthenticated; ESP32 flash encryption/secure boot need custom firmware |
| Physical possession of the host | Out of scope | |

**Assumptions** (stated so they can be checked, not silently relied on):

1. Boards join encrypted WiFi (WPA2/WPA3). Open networks are the user's own risk, and the docs say so. On
   WPA2-Personal, anyone who knows the passphrase can decrypt other devices' traffic if they capture the handshake
   (WPA3 closes this), so the residual eavesdropper is an insider on a shared network -- accepted.
2. The host is a single-user machine -- *unless open decision 1 says otherwise*.

**Limiting the damage for out-of-scope tiers.** Physical possession of a board yields every secret baked into its
flow and its board password key. What we can do is make that loss small, and say so in the user docs:

- Board passwords should be long, random and unique per board: the stored key is SHA-256 iterated 2000 times
  (`device-runtime/src/board_settings.py`), so a stolen board's password can be guessed offline quickly, and a reused
  password then unlocks every other board (*open decision 2*).
- Prefer a separate WiFi network or VLAN for devices, and an MQTT user per board with narrow topic permissions.
- When a board is lost: change its WiFi and broker credentials, and its board password anywhere it was reused.

## 3. Boundaries

Each entry: what crosses, the rule, status, stance. "Gap" marks something known and not yet handled.

### 3.1 Editor <-> backend -- Defend

- Crosses: flows, custom nodes, presets, definitions, **credentials in plain text**, board traffic over the
  WebSocket relay (deploy, runtime install, tool commands).
- Rule: the backend binds to loopback only and refuses any other address (`backend/.../__main__.py`) until posture-2
  auth exists. Every HTTP request and WebSocket upgrade is checked against a Host allowlist (`middleware.py`), the
  defence against DNS rebinding (`docs/working-notes/backend-editor-auth-and-protocol.md` §1).
- Status: built (posture 1). No authentication: any process that can reach loopback can read every credential
  (`GET /api/credentials/{type}/{name}`) and drive every attached board.
- Gap: CORS reflects any `Origin` (`cors.py`, no `Allow-Credentials`). Safe only while loopback-bound with no
  cookies; must become an allowlist before §5.
- Gap: other local users can reach loopback (open decision 1).

### 3.2 Backend <-> board, USB serial -- physical access is the control

- Crosses: everything, including setting the board password and installing the runtime.
- Rule: unauthenticated by design. Status: built.

### 3.3 Backend <-> board, WiFi transport -- Mitigate

- Crosses: the same protocol as serial, over TCP 7462.
- Rule: a board with no password opens no listener. Each session starts with a random-nonce HMAC-SHA256 challenge
  (`TSAUTH1`); the password never crosses the wire (`decisions/wifi-transport.md`, design doc §9).
- Status: built. Eavesdropping is covered by assumption 1.
- Gap (integrity, lower priority): frames after the handshake carry no per-frame authentication, so an insider on
  the network could in principle inject into an authenticated session. Boards drive physical things, so this is
  tracked, not accepted. UDP discovery is unauthenticated (it carries no secrets).

### 3.4 Code sources -> editor and board -- Defend the host; accept on the board

- `function` node: user code, unsandboxed on the board, inside the deploy perimeter (design doc §9).
- Custom nodes: the descriptor is data; `.node.py` runs on the board with full trust; the editor never executes it
  (`docs/working-notes/custom-node-authoring-scoping.md` Decision 5).
- Compile hooks: run only in the WASM worker, with no host imports beyond the context; output is validated data with
  size limits, never Python source; a timeout terminates the worker (`interfaces/node-compile-context/SPEC.md`,
  draft). `flow.configs` is redacted; only configs the node references carry secrets.
- Gap: the CLI builds hook contexts without redaction or target, and runs hooks synchronously with no containment
  (`docs/working-notes/reviews/2026-10-19-compile-hooks-response.md`, findings 2 and 15). CLI custom-node loading
  must not land without containment.
- Gap: shared flow files and packages have no provenance or review mechanism; they are trusted like the user's own.
  A registry or marketplace is the trigger to revisit (Decision 5), and would move into the Defend tier.
- AI agents act with the user's privileges through the CLI and skills; the same rules apply to what they write.

### 3.5 Board's setup access point -- Defend

- Rule: the portal opens on first boot only for an "unmanaged" WiFi config, and does not reopen when a saved
  credential stops working unless the config opts in (`allowReprovisioning`): an unauthenticated AP that reopens
  on any WiFi drop lets anyone in radio range redirect the board (design doc §9).
- Status: built. `computeWifiProvisionMarker` makes the decision; keep its tests.

### 3.6 Board <-> outside services -- Accept, documented

- Broker and network secrets are baked into the deployed flow as literals.
- MQTT is plain TCP (MQTTS deferred, `docs/working-notes/outstanding-items/mqtts-tls-deferred.md`); HTTP is plain.
- Everything received is untrusted input to the flow.

### 3.7 Supply chain -- Defend

The controls are the project rules, all in `AGENTS.md`:

- "npm / Node.js package use": warn Mike and get approval before adding any npm package; `--ignore-scripts`;
  lockfile and `npm ci`; no git-URL dependencies; no blind bulk upgrades; `npx --no`.
- "Install instructions: never `curl | sh` alone": a plain download offered alongside, and how to read the script.
- "Third-party software tracking": every dependency and vendored file in `docs/third-party-licenses.md`, same change.

What is built:

- The release bundle installs exact versions (`packaging/constraints.txt`), wheels only; the bundled CPython
  (python-build-standalone) is checked against recorded SHA-256s (`packaging/python-build-standalone.sha256`).
- The installers check each download against the release's `SHA256SUMS`. That protects integrity in transit, not
  origin: the sums come from the same release.
- Workflows default to `contents: read` where set; the release job that publishes has `contents: write`.

Gaps:

- **The approval rule covers npm only.** PyPI dependencies, GitHub Actions and vendored binaries have no
  flag-and-approve step. Proposed fix: one rule for every kind of dependency
  (`docs/working-notes/dependency-rule-proposal.md`, awaiting Mike).
- **Vendored MicroPython WASI interpreter** (`micropython-wasi/`): an alpha wheel from a third-party PyPI publisher,
  built from an unmerged upstream PR, hash-recorded but not reproducibly built -- and on the compile path for every
  WiFi flow. Under the proposed rule it needs retroactive approval and a pinned reproducible build
  (`docs/working-notes/reviews/2026-10-19-compile-hooks-response-reply.md`, finding 14).
- **GitHub Actions are pinned by tag** (`actions/checkout@v7` and others). Tags can be moved; pin to commit SHAs.
- **Python dependencies are version-pinned, not hash-pinned** (`constraints.txt`); development installs use ranges
  (`backend/pyproject.toml`, `aiohttp>=3.9,<4`). Hash pinning (`pip --require-hashes`) for the bundle is the next step.
- **The docs workflow has `contents: write`** for `gh-deploy`; scope it to the Pages branch if possible.
- **Release artifacts are not signed** beyond the checksums (macOS signing is conditional on CI secrets). The
  custom classic-ESP32 firmware image (`firmware/classic-esp32/`) follows the same rule: SHA-256 plus a build
  script, workflow and pinned MicroPython/ESP-IDF versions, so the image is rebuildable from a known commit -- a
  checksum detects corruption, not tampering. Signing is deferred to the first OTA-capable firmware release
  (`docs/working-notes/decisions/classic-esp32-firmware.md`).

## 4. Secrets

| Stage | Where | Rule |
|---|---|---|
| At rest, host | `~/.thingstudio/credentials/{wifi,mqtt-broker,board}/<name>.json` | written `0600` (`persisted_store.py`, `mkstemp`) |
| In a flow file | `credentialName` only | the secret never round-trips into `.flow.json` |
| In the editor | merged into config properties in memory at load | not written back |
| To a compile hook | `referencedConfigs` only | `flow.configs` is redacted (editor; CLI gap, §3.4) |
| On the board | literals in the generated flow on flash; the board password as a salted, iterated key | readable with physical access (§2) |
| On the wire | encrypted by the board's WiFi (assumption 1); MQTT/HTTP plain (§3.6) | -- |

Never log or print a secret, including in a `COMPILE ERROR` or console line.

## 5. Deferred requirement: backend on a different machine

Planned since the start; deferred by Mike on 2026-10-19 (test and implementation;
`docs/working-notes/decisions/backend.md`). Until it is built, the only supported split is an SSH tunnel or VPN to a
loopback-bound backend (posture 1). Requirements when it is picked up:

- Posture-2 auth: a password, a signed `HttpOnly` session cookie, TLS, and fail-closed start-up -- no bind beyond
  loopback without a password configured (`docs/working-notes/outstanding-items/posture-2-auth.md`,
  `backend-editor-auth-and-protocol.md` §1).
- CORS becomes an allowlist (§3.1); the Host allowlist gains the configured address.
- The zones split into **editor machine**, **backend machine** and **the network between them**; that link becomes
  the most sensitive boundary (credentials and hardware control cross it).
- Data ownership is stated: flow files stay on the editor machine (saved through the browser); credentials and
  boards stay on the backend machine.
- Do not remove the loopback refusal "for a test": with no auth, anything on the network could read every
  credential and push code to attached boards.

## 6. Open decisions (Mike)

1. **Another local user on the host**: state "single-user machine" as an assumption (accept), or treat it as a gap
   (mitigate -- e.g. a per-install token on the loopback API)?
2. **Board passwords**: should the editor generate a long random password per board by default, and warn on reuse?
3. **The generalised dependency rule** (`docs/working-notes/dependency-rule-proposal.md`) and, under it, retroactive
   approval of the vendored WASI interpreter.
