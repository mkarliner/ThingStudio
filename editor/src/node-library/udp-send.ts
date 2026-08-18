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
// side effect. Fixed by adopting the exact same `ssid`/`password`
// properties and wifiSetupStatement() sharing http-request.ts/
// wifi-status.ts already use -- optional, empty ssid just skips the
// connect call and assumes something else (another network node in the
// flow) handles it, same "wifi-sta" dedup key so whichever network node
// compiles first brings the interface up for everyone sharing it.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";
import { payloadToBytesSnippet } from "./py-literals.js";
import { wifiSetupStatement } from "./wifi-status.js";

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
    _udp_target = socket.getaddrinfo(${hostLit}, ${port})[0][-1]
    while True:
        try:
            ${UDP_SEND_SOCK_VAR}.sendto(_udp_body, _udp_target)
            return
        except OSError as _e:
            if _e.errno != errno.EAGAIN:
                raise
            await asyncio.sleep_ms(${SEND_RETRY_POLL_MS})
await asyncio.wait_for(${sendFnName}(), ${timeoutS})`.trim();

    return {
      imports: ["import socket", "import errno", "import network"],
      statements: [
        {
          key: UDP_SEND_SETUP_KEY,
          code: [`${UDP_SEND_SOCK_VAR} = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)`, `${UDP_SEND_SOCK_VAR}.setblocking(False)`].join("\n"),
        },
        wifiSetupStatement(node.properties.ssid, node.properties.password),
      ],
      functionName: ctx.uniqueName("udp_send"),
      functionBody,
    };
  },
};
