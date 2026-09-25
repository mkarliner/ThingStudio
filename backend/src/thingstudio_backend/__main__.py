# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/__main__.py
#
# CLI entrypoint: python -m thingstudio_backend [--host HOST] [--port PORT] ...
#
# Fail-closed default, per docs/thingstudio-design-doc.md §9 / rete-migration-
# decision.md's "refuse to start without auth configured" requirement, applied
# literally rather than deferred along with posture-2 auth itself: posture-2's
# actual auth mechanism (bcrypt password, signed session cookie) is [P4], not
# built (docs/working-notes/outstanding-items/posture-2-auth.md). Since there
# is currently no auth mechanism at all, this backend refuses to bind to
# anything but loopback -- not bind-then-warn -- until posture-2 exists.

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import webbrowser
from pathlib import Path

from aiohttp import web

from .app import EDITOR_SEEN_KEY, create_app
from .builtin_reference import seed_builtin_definitions
from .middleware import DEFAULT_ALLOWED_HOSTS
from .persisted_store import PersistedStore

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="thingstudio-backend", description="Thingstudio thin local backend")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1, loopback only)")
    parser.add_argument("--port", type=int, default=8765, help="bind port (default: 8765)")
    parser.add_argument(
        "--allowed-host",
        action="append",
        dest="allowed_hosts",
        default=None,
        help="additional Host header value to allow (posture 1); repeatable. "
        f"Defaults to {sorted(DEFAULT_ALLOWED_HOSTS)}.",
    )
    parser.add_argument(
        "--static-dir",
        type=Path,
        default=None,
        help="directory of the built editor to serve at / (default: the repo's editor/dist)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="don't open the editor in a browser on start",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="directory for persisted flows/custom-node packages (default: ~/.thingstudio)",
    )
    parser.add_argument(
        "--docs-dir",
        type=Path,
        default=None,
        help="directory of built user docs (mkdocs build output) to serve at /docs/ (default: the repo's site/)",
    )
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args(argv)


_REUSE_TAB_WAIT_S = 2.5


def _open_browser_soon(url: str):
    """on_startup hook: opens the editor once the server is listening -- unless an editor tab left open
    from the last run checks in first (2026-09-25: an open tab polls /api/alive every second while the
    backend is down, so restarting the backend used to leave a dead tab behind each time). Waits
    _REUSE_TAB_WAIT_S for that. Run in a thread because webbrowser.open() can block. Failure to open a
    browser (headless machine, no default browser) is logged, never fatal -- the URL is printed either way."""

    async def hook(app: web.Application) -> None:
        loop = asyncio.get_running_loop()

        def _open() -> None:
            if app[EDITOR_SEEN_KEY]["seen"]:
                logging.getLogger(__name__).info("an editor tab is already open -- reconnected to it, not opening another")
                return
            try:
                if not webbrowser.open(url):
                    logging.getLogger(__name__).info("no browser available -- open %s yourself", url)
            except Exception as exc:  # noqa: BLE001 -- see docstring
                logging.getLogger(__name__).info("couldn't open a browser (%s) -- open %s yourself", exc, url)

        loop.call_later(_REUSE_TAB_WAIT_S, lambda: loop.run_in_executor(None, _open))

    return hook


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.host not in _LOOPBACK_HOSTS:
        print(
            f"NODE_ERROR: refusing to bind to '{args.host}' -- posture-2 auth is not built yet "
            "(docs/working-notes/outstanding-items/posture-2-auth.md, [P4]), and this backend does not "
            "bind-then-warn on a non-loopback address with no auth configured. Use the default loopback "
            "bind (127.0.0.1) or build posture-2 auth first.",
            file=sys.stderr,
        )
        return 1

    allowed_hosts = DEFAULT_ALLOWED_HOSTS | frozenset(args.allowed_hosts or ())
    # Copies any missing built-in board/processor files into ~/.thingstudio (builtin_reference.py).
    # Here rather than in create_app() so tests building an app never write to a real home folder.
    seed_builtin_definitions(PersistedStore(args.data_dir).base_dir)
    app = create_app(allowed_hosts=allowed_hosts, static_dir=args.static_dir, data_dir=args.data_dir, docs_dir=args.docs_dir)
    url = f"http://{'[::1]' if args.host == '::1' else args.host}:{args.port}/"
    if not args.no_browser:
        app.on_startup.append(_open_browser_soon(url))
    try:
        web.run_app(app, host=args.host, port=args.port, print=lambda _msg: print(f"Thingstudio is running at {url}"))
    except OSError as exc:
        import errno

        if exc.errno != errno.EADDRINUSE:
            raise
        print(
            f"NODE_ERROR: port {args.port} is already in use -- Thingstudio is probably already running (check your "
            f"other terminal windows). Stop it with Ctrl-C there, or run: lsof -ti tcp:{args.port} | xargs kill. "
            "To run a second copy, use --port.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
