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


@pytest.mark.asyncio
async def test_runtime_sources_serves_the_real_runtime_as_text(tmp_path) -> None:
    from aiohttp.test_utils import TestClient, TestServer

    from thingstudio_backend.app import create_app

    app = create_app(data_dir=tmp_path, static_dir=tmp_path, docs_dir=tmp_path)
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/api/runtime-sources", headers={"Host": "127.0.0.1"})
        assert resp.status == 200
        names = [f["name"] for f in (await resp.json())["files"]]
    assert "listener.py" in names and "net_transport.py" in names and "mqtt_as.py" in names
    assert "main.py" not in names


def test_compiled_field_is_checked() -> None:
    import base64

    from thingstudio_backend.ws_relay import _decode_compiled

    ok, problem = _decode_compiled({"runtime.mpy": base64.b64encode(b"M\x06x").decode()})
    assert problem is None and ok == {"runtime.mpy": b"M\x06x"}
    assert _decode_compiled(None) == (None, None)
    assert _decode_compiled({"../main.py": "TQ=="})[1]  # not a plain module name
    assert _decode_compiled({"x.mpy": "not base64!"})[1]
    assert _decode_compiled({"x.mpy": base64.b64encode(b"print(1)").decode()})[1]  # not a .mpy header
