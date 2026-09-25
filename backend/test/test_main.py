# SPDX-License-Identifier: Apache-2.0
# backend/test/test_main.py
#
# __main__.main()'s startup failures: a clear one-line NODE_ERROR, not a traceback.

from __future__ import annotations

import socket

import pytest

from thingstudio_backend.__main__ import main


def test_port_in_use_is_a_clear_error(tmp_path, capsys) -> None:
    held = socket.socket()
    held.bind(("127.0.0.1", 0))
    held.listen()
    port = held.getsockname()[1]
    try:
        code = main(["--port", str(port), "--no-browser", "--data-dir", str(tmp_path)])
    finally:
        held.close()
    assert code == 1
    err = capsys.readouterr().err
    assert f"port {port} is already in use" in err and "already running" in err


@pytest.mark.asyncio
async def test_an_open_editor_tab_stops_a_second_one_opening(tmp_path, monkeypatch) -> None:
    """2026-09-25: restarting the backend used to open a new tab every time. A tab left open checks in at
    /api/alive; the browser-open hook then skips opening another."""
    import asyncio

    from aiohttp.test_utils import TestClient, TestServer

    from thingstudio_backend import __main__ as main_mod
    from thingstudio_backend.app import EDITOR_SEEN_KEY, create_app

    opened: list[str] = []
    monkeypatch.setattr(main_mod.webbrowser, "open", lambda url: opened.append(url) or True)
    monkeypatch.setattr(main_mod, "_REUSE_TAB_WAIT_S", 0.2)

    app = create_app(data_dir=tmp_path, static_dir=tmp_path, docs_dir=tmp_path)
    app.on_startup.append(main_mod._open_browser_soon("http://127.0.0.1:1/"))
    async with TestClient(TestServer(app)) as client:
        assert app[EDITOR_SEEN_KEY]["seen"] is False
        resp = await client.get("/api/alive", headers={"Host": "127.0.0.1"})
        assert resp.status == 200
        assert app[EDITOR_SEEN_KEY]["seen"] is True
        await asyncio.sleep(0.5)
    assert opened == []


@pytest.mark.asyncio
async def test_with_no_tab_checking_in_the_editor_opens(tmp_path, monkeypatch) -> None:
    import asyncio

    from aiohttp.test_utils import TestClient, TestServer

    from thingstudio_backend import __main__ as main_mod
    from thingstudio_backend.app import create_app

    opened: list[str] = []
    monkeypatch.setattr(main_mod.webbrowser, "open", lambda url: opened.append(url) or True)
    monkeypatch.setattr(main_mod, "_REUSE_TAB_WAIT_S", 0.1)
    app = create_app(data_dir=tmp_path, static_dir=tmp_path, docs_dir=tmp_path)
    app.on_startup.append(main_mod._open_browser_soon("http://127.0.0.1:1/"))
    async with TestClient(TestServer(app)):
        await asyncio.sleep(0.4)
    assert opened == ["http://127.0.0.1:1/"]
