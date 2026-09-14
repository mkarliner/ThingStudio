# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/admin_api.py
#
# The HTTP half of the backend<->browser persisted-data protocol
# (docs/working-notes/outstanding-items/backend-persisted-data-protocol.md,
# [P1] -- shape confirmed with Mike 2026-09-07: a small REST-ish admin API,
# not an extension of the WS control-plane channel, since persisted data
# (saved flows, custom node packages) needs to be reachable with no serial
# connection open at all -- a poor fit for ws_relay.py's ConnectionSession,
# which is scoped to "at most one open serial port per socket").
#
# Covered by the same posture-1 Host-allowlist middleware as every other
# route -- app.py installs it at the Application level, not per-route, so
# nothing here needs its own auth wiring. The auth consequence the
# outstanding-item doc flagged ("an HTTP admin API needs the same
# Host-allowlist... treatment as the WS upgrade") is satisfied by that
# existing app-level middleware, not by anything new.
#
# Every route: `PersistedStoreError` (persisted_store.py) is caught here
# and turned into a JSON `{"error": "NODE_ERROR: ..."}` body -- never a
# bare 500 with a traceback, same fault-handling-over-happy-path posture
# as ws_relay.py's status messages. `PersistedStoreNotFoundError` maps to
# 404; every other `PersistedStoreError` (bad name, invalid JSON, disk
# failure) maps to 400. Malformed request bodies (not JSON, missing
# expected fields) are handled the same way, before ever reaching the
# store.

from __future__ import annotations

import json

from aiohttp import web

from .persisted_store import PersistedStore, PersistedStoreError, PersistedStoreNotFoundError


def _error_response(exc: PersistedStoreError) -> web.Response:
    status = 404 if isinstance(exc, PersistedStoreNotFoundError) else 400
    return web.json_response({"error": str(exc)}, status=status)


def make_admin_routes(store: PersistedStore) -> list[web.RouteDef]:
    # -- flows ----------------------------------------------------------

    async def list_flows(request: web.Request) -> web.Response:
        return web.json_response({"flows": store.list_flows()})

    async def get_flow(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            text = store.read_flow(name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        # The stored text is already flow-file.ts-shaped JSON -- served
        # verbatim, this module never re-serializes it.
        return web.Response(text=text, content_type="application/json")

    async def put_flow(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        text = await request.text()
        try:
            store.write_flow(name, text)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    async def delete_flow(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            store.delete_flow(name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    # -- custom node packages --------------------------------------------

    async def list_custom_nodes(request: web.Request) -> web.Response:
        return web.json_response({"customNodes": store.list_custom_nodes()})

    async def get_custom_node(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            package = store.read_custom_node(name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"descriptor": package.descriptor, "implementation": package.implementation})

    async def put_custom_node(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return web.json_response(
                {"error": "NODE_ERROR: request body was not valid JSON (expected {\"descriptor\": ..., \"implementation\": ...})"},
                status=400,
            )
        if not isinstance(body, dict) or not isinstance(body.get("descriptor"), str) or not isinstance(body.get("implementation"), str):
            return web.json_response(
                {"error": "NODE_ERROR: request body must be a JSON object with string \"descriptor\" and \"implementation\" fields"},
                status=400,
            )
        try:
            store.write_custom_node(name, body["descriptor"], body["implementation"])
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    async def delete_custom_node(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            store.delete_custom_node(name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    # -- WiFi/MQTT-broker credentials ------------------------------------
    # docs/working-notes/outstanding-items/credential-storage-design.md.
    # {type} is "wifi" or "mqtt-broker" -- persisted_store.py rejects
    # anything else with a PersistedStoreError, mapped to 400 below same
    # as any other bad-name case, not a routing-level 404.

    async def list_credentials(request: web.Request) -> web.Response:
        credential_type = request.match_info["type"]
        try:
            names = store.list_credentials(credential_type)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"credentials": names})

    async def get_credential(request: web.Request) -> web.Response:
        credential_type = request.match_info["type"]
        name = request.match_info["name"]
        try:
            text = store.read_credential(credential_type, name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.Response(text=text, content_type="application/json")

    async def put_credential(request: web.Request) -> web.Response:
        credential_type = request.match_info["type"]
        name = request.match_info["name"]
        text = await request.text()
        try:
            store.write_credential(credential_type, name, text)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    async def delete_credential(request: web.Request) -> web.Response:
        credential_type = request.match_info["type"]
        name = request.match_info["name"]
        try:
            store.delete_credential(credential_type, name)
        except PersistedStoreError as exc:
            return _error_response(exc)
        return web.json_response({"ok": True})

    return [
        web.get("/api/flows", list_flows),
        web.get("/api/flows/{name}", get_flow),
        web.put("/api/flows/{name}", put_flow),
        web.delete("/api/flows/{name}", delete_flow),
        web.get("/api/custom-nodes", list_custom_nodes),
        web.get("/api/custom-nodes/{name}", get_custom_node),
        web.put("/api/custom-nodes/{name}", put_custom_node),
        web.delete("/api/custom-nodes/{name}", delete_custom_node),
        web.get("/api/credentials/{type}", list_credentials),
        web.get("/api/credentials/{type}/{name}", get_credential),
        web.put("/api/credentials/{type}/{name}", put_credential),
        web.delete("/api/credentials/{type}/{name}", delete_credential),
    ]
