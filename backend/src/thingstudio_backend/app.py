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
# cors_middleware (2026-09-08) is the outermost middleware -- it wraps the
# Host allowlist so a CORS preflight OPTIONS (no route registered for it)
# gets answered before host_allowlist_middleware ever sees it, and so every
# response, including a host-allowlist 403 or an admin-API error body,
# still carries the CORS headers the editor's fetch() calls need to read
# it at all. See cors.py's own header for the policy and its reasoning.

from __future__ import annotations

from pathlib import Path

from aiohttp import web

from .admin_api import make_admin_routes
from .cors import cors_middleware
from .docs_site import default_docs_dir, make_docs_routes
from .editor_site import default_editor_dir, make_editor_routes
from .middleware import DEFAULT_ALLOWED_HOSTS, host_allowlist_middleware
from .persisted_store import PersistedStore
import json

from .persisted_store import PersistedStoreError
from .ws_relay import make_websocket_handler


def create_app(
    allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS,
    static_dir: Path | None = None,
    data_dir: Path | None = None,
    docs_dir: Path | None = None,
) -> web.Application:
    app = web.Application(middlewares=[cors_middleware, host_allowlist_middleware(allowed_hosts)])
    store = PersistedStore(data_dir)

    def board_password(hostname: str) -> str | None:
        """The saved WiFi-transport password for a board, by its hostname (credentials/board/)."""
        try:
            password = json.loads(store.read_credential("board", hostname)).get("password")
        except (PersistedStoreError, ValueError, AttributeError):
            return None
        return password if isinstance(password, str) else None

    app.router.add_get("/ws", make_websocket_handler(password_lookup=board_password))
    # Registered before the static catch-all below -- aiohttp's router
    # matches resources in registration order, so these have to come first
    # or a static_dir containing files at these same paths could shadow them.
    app.router.add_routes(make_admin_routes(store))
    # Built user docs at /docs/ (docs_site.py) -- offline help for an installed copy.
    app.router.add_routes(make_docs_routes(docs_dir or default_docs_dir()))

    # The built editor at / (editor_site.py) -- registered last so every route above wins.
    app.router.add_routes(make_editor_routes(static_dir or default_editor_dir()))

    return app
