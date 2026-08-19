// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/udp-receive.ts
//
// Tier 1 item 5's UDP/TCP batch (mvp-feature-priorities.md item 5 point 3
// / design doc §6's 2026-08-17 addendum). A source: binds a UDP socket on
// a configured local port and produces one msg per datagram received.
// `bytes` payload, no parsing -- matches the design doc's "not validating
// payload content" stance. Extra msg properties `host`/`port` carry the
// sender's address, the same "real protocol metadata beyond payload"
// precedent wifi-status.ts's `ip` and mqtt-subscribe.ts's `topic`/
// `retained` already set.
//
// **Real, currently-open MicroPython-level gap this node's shape depends
// on, not an oversight**: verified against MicroPython issue #13382
// ("Asyncio's UDP API," open at the time this node was written) --
// unlike TCP's open_connection/start_server, asyncio has no first-class
// datagram primitive on any port, rp2 or esp32 included. mqtt_subscribe.ts
// gets to `await client.queue.__anext__()` and genuinely suspend with zero
// busy-waiting because mqtt_as's queue is itself asyncio.Event-backed;
// there's no equivalent for a raw UDP socket. The fallback used here,
// consistent with CLAUDE.md's "cheapest implementation that's actually
// correct": a non-blocking socket (setblocking(False)), polled via
// recvfrom() inside a try/except that treats OSError/EAGAIN as "nothing
// pending yet, try again shortly." This is purely internal codegen -- no
// flow-author-visible API changes if a future MicroPython/asyncio release
// adds a real datagram primitive and this gets swapped out, so it's a safe
// cheap-now choice, not a one-way door.
//
// **Where this poll loop actually lives is a real compiler-shape decision,
// not incidental.** node-definition.ts's SourceCodegenResult has no
// "skip this wake, don't propagate" signal the way EventSourceCodegenResult's
// buildMsg can `continue` -- and this node deliberately does NOT use the
// event-source pattern (there's no real external event/flag to wait on the
// way interrupt.ts's ThreadSafeEvent is one; see this batch's own
// implementation briefing). More importantly, a bare `continue` inside a
// codegenSource buildMsg would be actively wrong here even if the
// interface allowed it: compile.ts's repeatMs>0 loop shape is
// `while True: <buildMsg>; <chainBody>; await asyncio.sleep_ms(repeatMs)`,
// all in the same loop body -- a `continue` fired when recvfrom() raises
// EAGAIN would jump straight back to the top and skip that trailing
// sleep_ms entirely, since it sits textually AFTER buildMsg in the same
// block. On a socket with nothing pending, recvfrom() raises immediately
// every time, so that would busy-loop the single-threaded event loop with
// zero yields -- exactly the non-yielding-event-loop hazard class §5/
// POC-D's hardware bugs warn about, not a hypothetical. So the retry loop
// -- and its own `await asyncio.sleep_ms()` between attempts -- lives
// INSIDE buildMsg itself instead: buildMsg only ever returns once real
// data has arrived, exactly mirroring mqtt-subscribe.ts's buildMsg
// "genuinely blocks (here: via repeated short yields, not a real await)
// until a real message shows up" contract. SourceCodegenResult.repeatMs is
// therefore NOT this node's poll interval (that's the `pollMs` property,
// governing the internal retry cadence) -- it's set to a small fixed
// value purely as the mandatory extra yield after each successfully
// propagated message, the identical role mqtt-subscribe.ts's repeatMs: 10
// plays and for the identical reason (see that file's own comment).
//
// **Stop condition inherited from this batch's implementation briefing,
// not yet exercised by these off-device tests**: whether `pollMs`'s
// default is actually tight enough to avoid missing back-to-back
// datagrames on real hardware (as opposed to loopback in a test process)
// is real research this batch's hands-on pass against a real network peer
// still owes -- these tests only prove the codegen's logic is correct
// against a real (if local) UDP peer, not that the chosen default holds up
// on-device.
//
// **Real gap caught 2026-08-18, before the first real-hardware pass**:
// same issue udp-send.ts's header now documents -- this node never brought
// the WiFi station interface up itself, so a flow whose only network node
// is udp_receive would bind a socket on an interface that was never
// `.active(True)`'d, let alone associated to an AP. Fixed the same way:
// wifiSetupStatement() shared under the same "wifi-sta" dedup key
// http-request.ts/wifi-status.ts/udp-send.ts all use.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// **behavior change, 2026-08-18** -- same treatment as udp-send.ts:
// credentials now come from a referenced `thingstudio/config/wifi` config
// node via `node.properties.wifiConfigId`, resolved through
// wifi-status.ts's `resolveWifiCredentials()`, not raw `ssid`/`password`
// properties on this node directly. See wifi-status.ts's own header for
// the full reasoning.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { resolveWifiCredentials, wifiSetupStatement } from "./wifi-status.js";

// Conservative fixed recv buffer -- comfortably under the ~1472-byte
// practical UDP payload ceiling on a standard 1500-byte-MTU Ethernet/WiFi
// link (1500 - 20 IP - 8 UDP header). Not a property: no v1 use case here
// calls for a configurable buffer, and a too-small value would just
// truncate a datagram silently worse than a fixed conservative one would.
const RECV_BUFSIZE = 1472;

// Mandatory post-message yield only -- see this file's header for why this
// is NOT the poll interval (that's the `pollMs` property below).
const MANDATORY_YIELD_MS = 10;

export const udpReceiveNode: NodeDefinition = {
  type: "thingstudio/udp_receive",
  kind: "source",
  // output `msg` type `bytes` -- payload is always the raw `_udp_data` from
  // recvfrom(), never decoded (this file's own header, "not validating
  // payload content").
  ports: {
    outputs: [{ name: "msg", type: "bytes" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const port = Math.round(Number(node.properties.port));
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new CompileError(`udp_receive port "${String(node.properties.port)}" must be a valid port number (1-65535)`);
    }

    const pollMs = Math.round(Number(node.properties.pollMs ?? 20));
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new CompileError(`udp_receive pollMs "${String(node.properties.pollMs)}" must be a positive number`);
    }

    // Fixed, port-derived variable/key names -- NOT ctx.uniqueName --
    // matching interrupt.ts's own pin-scoped-naming precedent and for the
    // same reason that file's header gives: two udp_receive nodes
    // (incorrectly) configured for the same port should still dedup onto
    // one shared socket rather than the second instance's buildMsg
    // referencing a name mergeSetup's dedup silently never emitted.
    const sockVar = `_udp_recv_sock_${port}`;

    const buildMsg = [
      "while True:",
      "    try:",
      `        _udp_data, _udp_addr = ${sockVar}.recvfrom(${RECV_BUFSIZE})`,
      "        break",
      "    except OSError as _e:",
      "        if _e.errno != errno.EAGAIN:",
      "            raise",
      `        await asyncio.sleep_ms(${pollMs})`,
      "msg = {'payload': _udp_data, 'topic': '', 'host': _udp_addr[0], 'port': _udp_addr[1]}",
    ].join("\n");

    const { ssid, password } = resolveWifiCredentials(node.properties, ctx);

    return {
      imports: ["import socket", "import errno", "import network"],
      statements: [
        {
          key: `udp-receive-${port}`,
          code: [`${sockVar} = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)`, `${sockVar}.setblocking(False)`, `${sockVar}.bind(('0.0.0.0', ${port}))`].join(
            "\n",
          ),
        },
        wifiSetupStatement(ssid, password),
      ],
      buildMsg,
      repeatMs: MANDATORY_YIELD_MS,
    };
  },
};
