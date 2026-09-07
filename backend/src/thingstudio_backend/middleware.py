# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/middleware.py
#
# Posture-1 security surface (docs/working-notes/backend-editor-auth-and-protocol.md
# §1): reject any request -- HTTP or the WebSocket upgrade -- whose Host header
# isn't on an explicit allowlist, *before* it's handled at all. This is the
# actual DNS-rebinding defense (Origin checking is a separate, secondary
# concern the design note explicitly downgrades) -- a browser can't forge the
# Host header the way it can be tricked into resolving an attacker hostname to
# 127.0.0.1, so an allowlisted Host is a real, cheap guarantee.
#
# Deliberately not posture-2 auth (docs/working-notes/outstanding-items/posture-2-auth.md,
# [P4], not built): this middleware is the whole of posture 1, the default,
# no-account posture this backend ships under. It is not a lightweight stand-in
# for real auth -- it's the complete design for the posture it protects.

from __future__ import annotations

from collections.abc import Awaitable, Callable

from aiohttp import web

Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]

DEFAULT_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})


def _host_without_port(host_header: str) -> str:
    # IPv6 literals arrive as "[::1]:PORT" or bare "[::1]"; IPv4/hostnames as "host:port".
    if host_header.startswith("["):
        end = host_header.find("]")
        return host_header[: end + 1] if end != -1 else host_header
    return host_header.split(":", 1)[0]


def host_allowlist_middleware(allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS) -> Callable:
    """Build an aiohttp middleware that 403s any request with a non-allowlisted Host header.

    `allowed_hosts` should be bare hostnames/IP literals (no port) -- callers
    binding to a non-default posture-1 address must pass their own bind address
    here explicitly rather than relying on the loopback-only default.
    """

    @web.middleware
    async def middleware(request: web.Request, handler: Handler) -> web.StreamResponse:
        host_header = request.headers.get("Host")
        if host_header is None:
            # No Host header at all (HTTP/1.0, or a hand-crafted request) -- fail
            # closed rather than assume same-origin intent.
            return web.Response(
                status=403,
                text="NODE_ERROR: request rejected -- missing Host header (backend host-allowlist, posture 1)",
            )

        host = _host_without_port(host_header)
        if host not in allowed_hosts:
            return web.Response(
                status=403,
                text=(
                    f"NODE_ERROR: request rejected -- Host '{host}' is not on the backend's "
                    f"allowlist {sorted(allowed_hosts)} (posture 1 default; see "
                    "docs/working-notes/backend-editor-auth-and-protocol.md §1)"
                ),
            )

        return await handler(request)

    return middleware
