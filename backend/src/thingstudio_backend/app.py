# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/app.py
#
# The "thin" backend, per docs/thingstudio-design-doc.md §4: relay
# WebSocket messages between browser and device, serve the editor's static
# built assets, own ~/.thingstudio (persisted flows and custom node
# packages -- admin_api.py/persisted_store.py), and check posture-1's Host
# allowlist on everything -- one middleware at the Application level, so it
# covers the WS upgrade, the admin API, and static serving alike with no
# per-route wiring. Posture-2 auth (docs/working-notes/outstanding-items/
# posture-2-auth.md, [P4]) is still out of scope for this module. The
# persisted-data protocol (docs/working-notes/outstanding-items/
# backend-persisted-data-protocol.md, [P1]) is no longer undecided or
# unbuilt as of 2026-09-07 -- shape confirmed with Mike (HTTP admin API,
# not a WS control-plane extension); see persisted_store.py, admin_api.py.

from __future__ import annotations

from pathlib import Path

from aiohttp import web

from .admin_api import make_admin_routes
from .middleware import DEFAULT_ALLOWED_HOSTS, host_allowlist_middleware
from .persisted_store import PersistedStore
from .ws_relay import websocket_handler


def create_app(
    allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS,
    static_dir: Path | None = None,
    data_dir: Path | None = None,
) -> web.Application:
    app = web.Application(middlewares=[host_allowlist_middleware(allowed_hosts)])
    app.router.add_get("/ws", websocket_handler)
    # Registered before the static catch-all below -- aiohttp's router
    # matches resources in registration order, so these have to come first
    # or a static_dir containing files at these same paths could shadow them.
    app.router.add_routes(make_admin_routes(PersistedStore(data_dir)))

    if static_dir is not None:
        app.router.add_static("/", static_dir, show_index=False)

    return app
