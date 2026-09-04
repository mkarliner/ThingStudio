// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/udp-send.ts
//
// Tier 1 item 5's UDP/TCP batch (mvp-feature-priorities.md item 5 point 3
// / design doc §6's 2026-08-17 addendum). A sink: takes an inbound msg and
// fires its payload at a configured host:port over UDP. Simplest of the
// four new node types -- UDP has no connect step, so there's no
// connection-cache machinery to build (contrast tcp-send.ts). `bytes`
// payload semantics match the design doc's "not validating payload
// content" stance for this batch: whatever msg.payload is, it goes out
// encoded but unexamined -- see payloadToBytesSnippet (py-literals.ts).
//
// One shared, module-scope, non-blocking UDP socket for every udp_send
// node in a flow (key "udp-send-sock", the same
// dedup-by-key-not-per-instance pattern wifi-status.ts's "wifi-sta" uses)
// -- sendto() takes the destination address per call, so there's no
// per-instance socket state to keep separate the way udp-receive.ts's
// per-port bound sockets need.
//
// Bounding the send with asyncio.wait_for, per CLAUDE.md's fault-handling
// priority and matching http-request.ts's convention -- even though a UDP
// sendto to a local buffer rarely blocks in practice, per this batch's own
// implementation briefing: "rarely" isn't "never," and the existing
// convention already pays this cost everywhere else network I/O happens.
// Worth being explicit about HOW this is bounded, since it's not the
// obvious "just wrap the call" approach: MicroPython's asyncio has no
// wait_for-cancellable primitive for a plain (blocking-mode) socket
// send -- wrapping a synchronous, non-yielding sendto() call in an async
// function and awaiting it via wait_for would be decorative, not real
// protection, because wait_for's cancellation can only take effect at an
// actual await/yield point, and a blocking sendto() that's genuinely stuck
// has no such point for the timer to interrupt. So the socket is
// non-blocking (setblocking(False)) and the send is a real bounded retry
// loop -- try sendto(), and on EAGAIN (send buffer momentarily full) yield
// via a short asyncio.sleep_ms() and retry -- the same non-blocking-poll
// shape udp-receive.ts's buildMsg uses for the receive direction, applied
// symmetrically here so wait_for's timeout is an actual, enforceable bound
// rather than a wrapper with no real cancellation point behind it.
//
// **Real gap caught 2026-08-18, before the first real-hardware pass, not
// caught by any off-device test**: this node did NOT originally bring the
// WiFi station interface up at all. On real hardware, a flow whose only
// network node is udp_send would `sendto()` over an interface that was
// never `.active(True)`'d or `.connect()`'d -- silently going nowhere (or
// raising ENETUNREACH-ish errors) unless the same flow happened to also
// carry a wifi_status/http_request node bringing the interface up as a
// side effect. Fixed by adopting the same wifiSetupStatement() sharing
// http-request.ts/wifi-status.ts already use.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// **behavior change, 2026-08-18** -- credentials now come from a
// referenced `thingstudio/config/wifi` config node via
// `node.properties.wifiConfigId`, resolved through wifi-status.ts's
// `resolveWifiCredentials()`, not raw `ssid`/`password` properties on this
// node directly. See wifi-status.ts's own header for the full reasoning
// (Mike's explicit mandate). **`wifiConfigId` made mandatory 2026-08-20**
// (redeploy-cleanup-and-network-fault-detection-briefing.md, Problem 2b
// Option B) -- see wifi-status.ts's header for the reversal and why (the
// silent "no config -> ride on whatever's connected" fallback is exactly
// what let a stale/unrelated connection look like this flow's own).
//
// **Superseded, 2026-09-04**: this node no longer has a `wifiConfigId`
// property at all -- see wifi-status.ts's header for the bug this fixes
// (this node's own independently-selectable WiFi config could silently
// disagree with wifi_status's) and `resolveFlowWifiCredentials()`, which
// this node now calls instead of `resolveWifiCredentials()` directly.
//
// Redeploy resource cleanup (same briefing, Problem 1): the socket setup
// statement below now self-registers a `runtime.register_cleanup()` call
// closing the shared send socket -- device-runtime/src/runtime.py's
// `cancel_running()` is what actually calls it on every redeploy, closing
// the real root cause (an OS-level socket, owned by the old `_flow`
// module, that cancelling its task never touched) instead of relying on
// GC timing, which is what made "redeploy twice, first one fails with
// EADDRINUSE, second one works" flaky rather than deterministic.
//
// Loud network errors (same briefing, Problem 2a): an OSError from either
// `getaddrinfo()` or the bounded `sendto()` retry loop is now re-raised
// with the operation's own host:port context folded into the message,
// before it reaches runtime.py's NodeError/_guarded machinery -- that
// machinery already reports node ID + exception type accurately; the fix
// is making the message itself diagnosable (Mike's actual repro: a bare
// `OSError: -202`, an undocumented errno, gives no way to tell whether
// the target was unreachable, a DNS failure, or something else without
// opening generated source).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";
import { payloadToBytesSnippet } from "./py-literals.js";
import { resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";

export const UDP_SEND_SOCK_VAR = "_udp_send_sock";
export const UDP_SEND_SETUP_KEY = "udp-send-sock";

// Fixed retry-poll interval for the bounded-send loop below -- short
// enough to keep the overall wait_for bound meaningful even for a small
// configured timeoutMs, not exposed as a property (nothing in this
// batch's scoping calls for tuning it, unlike udp-receive.ts's pollMs,
// which the batch's own stop conditions explicitly flag as needing
// real-hardware tuning).
const SEND_RETRY_POLL_MS = 10;

export const udpSendNode: NodeDefinition = {
  type: "thingstudio/udp_send",
  kind: "sink",
  // input `msg` type `any` -- payloadToBytesSnippet handles bytes/str/other
  // uniformly (same bucket-3-avoiding reasoning mqtt_publish's own `any`
  // input gets, wire-type-system-scoping.md).
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const host = typeof node.properties.host === "string" ? node.properties.host.trim() : "";
    if (!host) {
      throw new CompileError('udp_send requires a non-empty "host"');
    }

    const port = Math.round(Number(node.properties.port));
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new CompileError(`udp_send port "${String(node.properties.port)}" must be a valid port number (1-65535)`);
    }

    const timeoutMs = Math.round(Number(node.properties.timeoutMs ?? 2000));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new CompileError(`udp_send timeoutMs "${String(node.properties.timeoutMs)}" must be a positive number`);
    }
    const timeoutS = timeoutMs / 1000;

    const hostLit = JSON.stringify(host);
    const sendFnName = ctx.uniqueName("udp_send_bounded");

    const functionBody = `
${payloadToBytesSnippet("_udp_body")}
async def ${sendFnName}():
    try:
        _udp_target = socket.getaddrinfo(${hostLit}, ${port})[0][-1]
    except OSError as _e:
        raise OSError("udp_send: could not resolve %s:%s: %r" % (${hostLit}, ${port}, _e))
    while True:
        try:
            ${UDP_SEND_SOCK_VAR}.sendto(_udp_body, _udp_target)
            return
        except OSError as _e:
            if _e.errno != errno.EAGAIN:
                raise OSError("udp_send to %s:%s failed: %r" % (${hostLit}, ${port}, _e))
            await asyncio.sleep_ms(${SEND_RETRY_POLL_MS})
await asyncio.wait_for(${sendFnName}(), ${timeoutS})`.trim();

    const { ssid, password, security } = resolveFlowWifiCredentials(ctx, "udp_send");

    return {
      imports: ["import socket", "import errno", "import network"],
      statements: [
        {
          key: UDP_SEND_SETUP_KEY,
          code: [
            `${UDP_SEND_SOCK_VAR} = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)`,
            `${UDP_SEND_SOCK_VAR}.setblocking(False)`,
            `runtime.register_cleanup(${JSON.stringify(UDP_SEND_SETUP_KEY)}, lambda: ${UDP_SEND_SOCK_VAR}.close())`,
          ].join("\n"),
        },
        wifiSetupStatement(ssid, password, security),
      ],
      functionName: ctx.uniqueName("udp_send"),
      functionBody,
    };
  },
};
