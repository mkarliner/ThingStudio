# WiFi deploy chicken-and-egg

Status: **open, 2026-11-12**. Mike, from live S3 testing: "we have a chicken and egg problem. I can't put a flow
on the board via WiFi until I've put a flow on the board. And if I get it wrong the board will be off the net and
I'll be stuck." And on the fix direction: "this is a structural problem, not something that can be patched over."
No design chosen yet; deploy-side guards alone are explicitly *not* the answer.

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

## Design directions (undecided — Mike picks)

- **The listener owns the join.** A last-known-good network (SSID/password) stored in board settings — set
  over USB once, like the board password — and joined by the listener at boot, independent of any flow.
  The flow's WiFi config becomes a validated override or is dropped from the flow entirely. A wrong flow can
  then never strand the board: the listener re-joins whatever the flow did. Cost: the wifi config node, the
  `ensure_station` codegen and `wifi_status`'s ownership model all change shape; the credential store's
  "saved on this computer" story intersects with "saved on the board".
- **A listener-level rejoin watchdog.** Flows keep joining WiFi as today, but the listener remembers the last
  network a flow successfully joined (device settings) and rejoins it if the station is down N seconds after a
  flow swap. Cheaper, but keeps two owners of one radio and the window is dead-air.
- **Rejected by Mike's framing:** deploy-side guards alone (SSID-mismatch warnings, confirmations) — listed
  only so nobody "fixes" it this way; they are the patch-over.

Whichever direction: the WiFi provision AP (`wifi_provision.py`, the captive-portal setup path) already solves
the same problem at setup time — the board advertises, the user's browser fills the credentials in, and they
are stored on the board. The gap is only that a *deployed flow* re-owns them afterwards.

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
