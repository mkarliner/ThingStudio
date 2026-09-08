# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/cors.py
#
# CORS support for the admin API (admin_api.py) -- added 2026-09-08 alongside
# the editor's fetch-based admin-API client (docs/working-notes/outstanding-items/
# backend-persisted-data-protocol.md's own "not decided or built here: any
# editor-side consumer of these routes at all"). Without this, a browser
# blocks the editor's own fetch() calls to this API whenever the editor's
# origin differs from the backend's -- true of every dev workflow (`npm run
# dev` on Vite's port, backend on 8765) and, per design doc §4's "backend
# runs wherever the devices are, a human drives the editor from a browser
# somewhere else", true of production use too whenever the editor isn't
# served BY this same backend's own static_dir.
#
# Policy, confirmed with Mike 2026-09-08 (weighed against the alternative --
# an explicit --allowed-origin allowlist mirroring --allowed-host): reflect
# whatever Origin the request carries. This doesn't lower this backend's
# actual security bar -- ws_relay.py's WebSocket upgrade already does zero
# Origin checking (middleware.py's own header comment calls Origin checking
# "a separate, secondary concern" deliberately downgraded in favor of the
# Host allowlist, which is the real DNS-rebinding defense), and __main__.py
# already refuses to bind anywhere but loopback until posture-2 auth exists
# (outstanding-items/posture-2-auth.md, [P4]) -- so the worst case this
# opens is "another page open in the same loopback-reachable browser can
# also read/write this backend's admin API", a risk category already fully
# accepted for the WS relay today, not a new one. If posture-2 auth (or a
# non-loopback bind, outstanding-items/posture-2-auth.md's 2026-09-08
# addendum) ever ships, this reflect-any-Origin default needs revisiting
# alongside it -- reflecting Origin is a fine default for "whoever can reach
# loopback is already trusted", not for "whoever can reach a LAN/public bind".
#
# No Access-Control-Allow-Credentials header is sent -- there are no cookies
# or credentials in play under posture 1, and this deliberately isn't set to
# "true" alongside a reflected Origin, which together would be the actually
# dangerous combination (posture-2's session cookie, when it exists, needs
# its own explicit look at this file rather than inheriting this default).

from __future__ import annotations

from collections.abc import Awaitable, Callable

from aiohttp import web

Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]

# GET/PUT/DELETE cover every admin_api.py route; OPTIONS is the preflight
# method itself, listed so a browser's preflight cache reflects it back.
_ALLOWED_METHODS = "GET, PUT, DELETE, OPTIONS"
# Content-Type is the only non-simple header the admin-API client sends
# (put_flow/put_custom_node bodies) -- kept to exactly what's actually used
# rather than a blanket "*", matching this project's existing allowlist-not-
# wildcard posture elsewhere (Host allowlist, name validation).
_ALLOWED_HEADERS = "Content-Type"


@web.middleware
async def cors_middleware(request: web.Request, handler: Handler) -> web.StreamResponse:
    """Reflects the request's Origin on every response (see module header
    for the policy this implements), and answers CORS preflight OPTIONS
    requests directly -- no route is registered for OPTIONS (admin_api.py
    only registers GET/PUT/DELETE), so a preflight would otherwise 404
    before ever reaching host_allowlist_middleware or the real route.
    Installed as the outermost Application-level middleware (app.py) so it
    wraps every response, including a host-allowlist 403 or an admin-API
    error response -- an error the editor can't read the body of because
    the browser blocked it as a failed CORS check would be strictly worse
    than the error itself, the same fault-handling-over-happy-path
    reasoning admin_api.py's own header comment already applies to its
    {"error": ...} bodies."""

    origin = request.headers.get("Origin")

    if request.method == "OPTIONS" and "Access-Control-Request-Method" in request.headers:
        response: web.StreamResponse = web.Response(status=204)
        response.headers["Access-Control-Allow-Methods"] = _ALLOWED_METHODS
        response.headers["Access-Control-Allow-Headers"] = _ALLOWED_HEADERS
        response.headers["Access-Control-Max-Age"] = "86400"
    else:
        response = await handler(request)

    if origin is not None:
        response.headers["Access-Control-Allow-Origin"] = origin
        # Tells caches (browser and any intermediary) the response varies
        # by Origin -- this is a reflection, not a fixed value, so a cached
        # response for one Origin must never be served back for another.
        response.headers["Vary"] = "Origin"

    return response
