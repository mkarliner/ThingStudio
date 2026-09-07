# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/app.py
#
# The "thin" backend, per docs/thingstudio-design-doc.md §4: relay
# WebSocket messages between browser and device, serve the editor's static
# built assets, and check posture-1's Host allowlist on everything. Posture-2
# auth (docs/working-notes/outstanding-items/posture-2-auth.md, [P4]) and the
# persisted-data protocol (docs/working-notes/outstanding-items/
# backend-persisted-data-protocol.md, [P1], undecided) are both explicitly
# out of scope for this module -- see those items before adding routes here
# for flow files or custom node packages.

from __future__ import annotations

from pathlib import Path

from aiohttp import web

from .middleware import DEFAULT_ALLOWED_HOSTS, host_allowlist_middleware
from .ws_relay import websocket_handler


def create_app(
    allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS,
    static_dir: Path | None = None,
) -> web.Application:
    app = web.Application(middlewares=[host_allowlist_middleware(allowed_hosts)])
    app.router.add_get("/ws", websocket_handler)

    if static_dir is not None:
        app.router.add_static("/", static_dir, show_index=False)

    return app
