# WiFi deploy chicken-and-egg

Status: **open, scoped 2026-11-13** (raised 2026-11-12). Mike, from live S3 testing: "we have a chicken and egg problem. I can't put a flow
on the board via WiFi until I've put a flow on the board. And if I get it wrong the board will be off the net and
I'll be stuck." And on the fix direction: "this is a structural problem, not something that can be patched over."
Scoped 2026-11-13: the board owns the network (requirements and decisions below; the multi-network shape awaits Mike's confirmation). Deploy-side
guards alone are explicitly *not* the answer.

## The problem

A flow's WiFi config is what joins the network (`ts_wifi.ensure_station` in the flow's setup; the listener
brings up no network of its own beyond the transport the board is already on). A deploy *replaces* the flow.
So the transport that delivers the flow depends on the flow already being right:

- **Fresh flash → USB first, by design.** `install.sh` erases the board (flows, WiFi, board settings); until
  some flow joins WiFi, the board has no address and only the USB transport exists. This half is not a bug:
  it is the stated fresh-flash path.
- **A WiFi deploy can strand the board.** Deploying a flow whose WiFi config is wrong (bad password, another
  SSID, or a flow that fails its join) swaps out the only thing keeping the station up. The board leaves the
  network with no flow running to rejoin it, and recovery is a physical USB visit. The failure is silent and
  delayed: the deploy itself succeeds; the board dies a few seconds after `DEPLOY_ACK`.

## Why structural

The last mile of the transport is owned by the payload being replaced. Any patch that only *observes* the
danger (a deploy-time warning that the incoming flow's SSID differs from the connected one; a retry; a "are
you sure") leaves that dependency intact — it asks the user to be careful at exactly the moment the product
could be correct by construction. Mike's rule: no patch-overs; the design has to remove the dependency.

## More failure cases found while scoping (2026-11-13)

The deploy above is one of four ways the board ends up off the network. All have the same root cause: the flow
owns the radio.

1. **Wrong credentials, right away.** `ensure_station` does nothing if the radio is already connected, so a bad
   deploy only strands the board right away if the old flow's cleanup dropped the radio first. An MQTT flow does:
   vendored `mqtt_as.close()` calls `active(False)`. This is the "dies a few seconds after `DEPLOY_ACK`" case.
2. **Wrong credentials, at the next reboot.** If the old flow didn't drop the radio, the bad deploy looks fine
   until the board next reboots. Then the saved flow comes back with the bad credentials.
3. **A flow with no WiFi, deployed over WiFi.** Works until the next reboot. After that, nothing joins.
4. **Safe mode.** After a boot loop, the listener starts without the flow, so it also starts without WiFi. The
   recovery path for a broken flow strands any board reached only over WiFi.

A rejoin watchdog (an option considered earlier) only covers 2 and 4 if it also rejoins at boot. Then it is the
board owning the network with a second owner still fighting it, so it was dropped.

## Mike's requirements (2026-11-13 scoping session)

- **R1.** Flash a board, mark WiFi as used and set its network over USB, then work with the board over WiFi
  without deploying a flow first.
- **R2.** Secure by default: marking WiFi as used means a board password (the WiFi-session password, not the
  network's) by default. It can be turned off for dev work.
- **R3.** Credentials in `~/.thingstudio` must not be kept in plain text.
- **R4.** The captive portal is the fallback. It is used when WiFi is on and no network is assigned, or when a
  network is assigned but can't be joined after a reasonable number of attempts. Never when WiFi is off.

The three cases the design must cover (Mike):

- a board with WiFi that won't use it (an ESP32 driving a LoRa module);
- a board with no WiFi (a pyboard, a standard Raspberry Pi Pico);
- a board with WiFi that will use it.

## Decisions (2026-11-13)

- **The board owns the network.** The network name and password become a board setting (with the hostname and
  board password, `board_settings.py`). The listener joins the network at every boot, safe mode included, before
  any flow runs. No flow code calls `connect()`.
- **WiFi state is a board setting with three values: off, on with no network, on with a network.** A fresh flash
  is **off**: the board never starts the WiFi driver and never opens the portal, so the LoRa case costs no memory
  and does nothing. Boards with no radio report `hasWifi: false` and the editor doesn't offer the setting. WiFi is
  turned on over USB only.
- **Board password: on by default, with a deliberate opt-out.** Turning WiFi on sets a board password unless the
  user explicitly chooses "allow sessions without a password". Leaving the field empty is not an opt-out. A board
  in that mode says so in `HELLO` and in its discovery-probe reply, so the editor can show it as open. The cost,
  accepted for dev use: anyone on the LAN can deploy to that board or run code on it. The password itself stays
  USB-only.
- **Portal triggers move from the flow to the listener.** It opens when WiFi is on and either no network is
  assigned or the assigned one fails after N attempts (N to be decided at implementation). The flow's
  `wifiProvision` marker (`_flow_wifi_provision.json`) goes away. The portal sets the board's network.
  `allow_reprovision`'s September caveat (reopening an access point is attack surface) now applies to the
  join-failure trigger. The access point stays WPA2.
- **Credentials in `~/.thingstudio` go into the OS keychain** (Python `keyring`: macOS Keychain, Windows
  Credential Manager, Secret Service on Linux). `credentials/*/*.json` keep only non-secret fields. Existing
  plaintext secrets move into the keychain on first start. For board credentials the backend only needs the
  derived key (`sha256^N(salt + password)`), so it can store that rather than the password. Independent of the
  rest, so it is a separate work item. Not in scope: the board's own copy of the network password, which has to
  stay readable because the radio needs it. That falls under the existing rule that physical access is the trust
  anchor.

## Decided after the first pass (2026-11-13)

- **A flow's WiFi config does not override the board's network (Q3, Mike agreed).** No override in v1.
  Existing flows' WiFi configs get a compile warning and are otherwise ignored. Moving a board to its field
  network is a board-settings action. The reasons: a flow network that *joins fine* while the editor is on
  another network leaves a healthy board you can't reach, with nothing to fall back from. The network belongs to
  where a board is, not to what it runs (one flow, boards at three sites). Flows that name a credential don't
  travel well (tutorials, shared flows, the AI skill). If an override is ever added, it has to be data the
  listener acts on, with fallback (flow network, then the board's networks, then the portal), and it can be
  added without migrating flows.
- **A board's network can be changed over an authenticated WiFi session** (Mike: "caveat emptor, although less
  risky with a fallback ssid"). It is try-and-revert: the board keeps the new network only once it has joined
  it, and otherwise goes back to the previous one. Accepted risk: a new network that joins fine while the
  editor is on another one leaves the board unreachable over WiFi until USB or the portal. The board password
  stays USB-only.
- **More than one network.** Mike asked: a list of SSIDs, or just an alternate? Claude's recommendation,
  **pending Mike's confirmation**: store an ordered list ("scope is not shape", `AGENTS.md`). The list is a
  board setting and one protocol field, with a small cap (4). The editor shows a primary network plus "add
  another". The board tries the networks in order, last successful first, with no scan (the C3's `scan()` only
  reports the nearest network, per `wifi_provision.py`'s header). Each failed network adds its join timeout to
  boot, which is why the cap is small. The portal opens only when every network has failed N times. The list
  is what makes remote changes forgiving: changing one network leaves the others in place.

## Costs and risks

- **`mqtt_as` owns the radio today**: `defer_to_mqtt` hands it reconnection, and `close()` turns the radio off.
  Under the board owning the network, it must do neither. We've avoided patching the vendored library before
  (`decisions/redeploy-network.md`, 2026-08-21). This is the main technical unknown. **Spike first**, possibly
  through the `ts_mqtt` wrapper.
- ESP-IDF's saved-network auto-reconnect has bitten us before (same decision file). The listener's join must be
  explicit and not rely on it.
- **Interface changes: these need Mike's explicit permission before any implementation** (`interfaces/protocol/`):
  new `SET_BOARD_SETTINGS` fields (WiFi state, the network list, the password opt-out) and a remote, try-and-revert
  network change over WiFi, `HELLO`/probe fields (WiFi state,
  open sessions), and the `TSAUTH1` handshake gains an unauthenticated mode. The `ensure_station`/`wifi_status`
  code generation and the removal of the provision marker make it a major runtime version bump.
- Security: check `docs/security-policy.md`'s table before building. The password opt-out and the portal's
  join-failure trigger both change the attack surface.
- Editor: the board-settings dialog gains the WiFi state and network. The "saved on this computer" credential
  picker and the board-held network need reconciling.

## Meanwhile, operationally

- First flow after any flash goes over USB (works on the native-USB S3: into-the-board writes are fine; only
  large board→host prints are dropped, so runtime *installs* want UART — custom images need no install).
- WiFi redeploys are safe while the flow's WiFi config is unchanged (same SSID/password: `ensure_station` is
  a no-op on an associated board). Changing the network over WiFi is the dangerous case.
- `record-tested.sh`'s fresh-flash checkpoint (remote-display task 5) walks this path on purpose — the
  USB bring-up after a flash is expected, not exceptional.

Incident that surfaced it: 2026-11-12, the remote-display S3 sessions — three flash/bring-up cycles, each
needing USB password + flow redeploy, with the WiFi-deploy strand risk in view each time (see
`remote-display-live-verification-briefing.md`).
