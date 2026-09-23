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
import logging
import sys
from pathlib import Path

from aiohttp import web

from .app import create_app
from .middleware import DEFAULT_ALLOWED_HOSTS

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
    parser.add_argument("--static-dir", type=Path, default=None, help="directory of built editor assets to serve")
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
    app = create_app(allowed_hosts=allowed_hosts, static_dir=args.static_dir, data_dir=args.data_dir, docs_dir=args.docs_dir)
    web.run_app(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
