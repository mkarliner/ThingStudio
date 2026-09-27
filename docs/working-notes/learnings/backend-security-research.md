# Learnings — Backend / security research

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **Same-origin policy does not cover WebSocket connections initiated
  from page JS the way it covers `fetch`/XHR.** A DNS-rebinding attack can
  get a browser to resolve an attacker-controlled hostname to `127.0.0.1`
  after an initial same-origin check passes, then open a WebSocket to a
  local server with no browser-level barrier stopping it. The `Host`
  header on that request still reads the attacker's hostname (can't be
  forged) — a server-side `Host` allowlist is the actual defense, not
  `Origin` checking. Verified against a real 2026 advisory
  (`GHSA-89vp-x53w-74fx`) against a structurally similar local WebSocket
  server. `backend-editor-auth-and-protocol.md`.
- **The browser's native `WebSocket` constructor cannot set custom
  request headers.** No `Authorization: Bearer …` is possible on a WS
  handshake from page JS — this is a real API limitation, not a design
  preference, and it's why session auth for the backend has to be
  cookie-based rather than token-based. Same note.
- **Check a dependency's actual release activity before trusting it,
  every time — not just for npm.** `pyserial-asyncio` turned out fully
  dead (no release since Sept 2021); `aiohttp-session` has had no release
  in ~12 months. Applied the same diligence `CLAUDE.md` already requires
  for npm packages to Python dependencies too, and it changed both
  decisions. `backend-platform-decision.md`, `backend-editor-auth-and-protocol.md`.
- **A citation can be wrong even when it "sounds right" — verify by
  direct inspection, not by trusting the name.** `connection-mastery-plugin`
  was cited as the drag-to-splice mechanism for a full session before
  being checked directly and found dead (Rete 1.x only, ~6 years stale)
  and, separately, not even the same feature. Corrected to Rete's own
  "Insert node" example. `rete-spike-briefing.md`, `architecture-review-briefing.md`.
- **Browser transport support isn't what it used to be assumed to be —
  check current support before relying on a browser API.** Safari has
  never supported WebSerial with no stated plans to; Firefox only gained
  it in v151 (May 2026); Web Bluetooth is *permanently* Chromium-only —
  a stated policy position from both Firefox and Safari, not a lagging
  gap that will close. `architecture-review-briefing.md`.

- **2026-09-25 — macOS 15 Local Network privacy blocks a framework-build Python even when the terminal is
  allowed.** First real WiFi-transport test (ESP32-C3, Mike's Mac): the board listened (`NET_LISTENING`), `nc` from
  iTerm connected, but the backend got `[Errno 65] No route to host` for both the TCP connect and the discovery
  broadcast. iTerm was allowed; Python wasn't listed at all. Likely cause: python.org/Homebrew Pythons are framework
  builds whose `python3` re-execs a hidden `Python.app`, which macOS judges on its own and often never prompts for.
  Diagnosis: `.venv/bin/python -c "import sys; print(sys._base_executable)"` showing `Python.framework`. **Confirmed:** the same command works
  from Apple's Terminal, which TN3179 says is always allowed ("Command-line tools run from Terminal or over SSH,
  including any child processes"); from iTerm it fails even with iTerm allowed and the Python called by full path.
  TN3179 also: only outgoing TCP/UDP and sending broadcasts need the permission -- listening and accepting don't --
  and identity is by code signature, so ad-hoc-signed Homebrew Python is the "may behave weirdly" case. Matters for packaging (MVP item 7): the
  bundled runtime must be allowed local network access. `tcp_relay._explain_connect_oserror` points Mac users at the
  setting.

## 2026-09-27 -- Local Network on the signed bundle; 255.255.255.255 refused while the subnet broadcast works

- Signed + notarized bundle (Developer ID, `thingstudio-python` with embedded Info.plist), started from iTerm on
  Mike's Intel Mac (macOS, Tailscale up): TCP connect to the board by IP **worked**, no Local Network prompt,
  no Thingstudio entry in System Settings > Local Network. So TCP to a LAN address was allowed without any
  prompt (probably attributed to iTerm, which is allowed), unlike the 2026-09-25 Homebrew-Python run.
- Discovery's probe to 255.255.255.255 failed with `[Errno 65] No route to host` in the same process, although
  `route get 255.255.255.255` and the default route were both `en0` (192.168.10.0/24). The same probe to
  `192.168.10.255` found the Pico W at once. Cause not pinned down (Tailscale's network extension is the prime
  suspect; not tested with Tailscale off). Fix doesn't depend on it: probe each interface's directed broadcast
  (TN3179's own advice, "run your service discovery code on all broadcast-capable interfaces"), limited
  broadcast only as fallback. `net_interfaces.py`, `tcp_relay.scan()`.
- TN3179 (Apple): 255.255.255.255 and multicast count as local network addresses; ad-hoc signed code isn't
  tracked reliably by Local Network privacy (use an Apple-issued identity); Terminal, SSH, launchd daemons and
  root are exempt, launchd *agents* are not (need `AssociatedBundleIdentifiers` or their own Info.plist);
  the first operation can be denied before the user answers the alert, so retry.
- **Later the same day: the signed bundle's TCP connect failed too** (v0.1.1 draft from iTerm, "No route to
  host"), still no Thingstudio entry, no prompt. Cause: a process started from a terminal app is attributed
  to that app (its *responsible process*), so macOS judged iTerm, never our signed identity or embedded
  Info.plist -- which is also why the earlier TCP success wasn't repeatable. The tmux fix works only because a
  tmux server daemonises. Fix: `thingstudio-python` re-execs itself once (`POSIX_SPAWN_SETEXEC`, same pid) with
  `responsibility_spawnattrs_setdisclaim` (private libSystem call, dlsym'd, falls back with a stderr note),
  as terminal apps do for shells and Qt Creator's `disclaim` helper does. Mike's other apps with Local Network
  entries are `.app` bundles started from Finder/Dock, so each is its own responsible process already.

