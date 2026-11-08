#!/usr/bin/env python3
"""Puts the demo's Content-Security-Policy into index.html as a <meta> tag, for the GitHub Pages standby.

Pages can't send headers, so the standby copy carries the policy in the page itself. The policy is read from the
Caddyfile beside this script (the one place it's written), minus frame-ancestors, which browsers ignore in a
<meta> tag. The other headers (nosniff, Referrer-Policy, Permissions-Policy) have no <meta> form; Pages goes
without them.

Usage:  python3 packaging/demo-server/add_meta_csp.py <unpacked demo folder>
Edits <folder>/index.html in place. Standard library only.
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

CADDYFILE = Path(__file__).resolve().parent / "Caddyfile"


def header_csp(caddyfile: Path = CADDYFILE) -> str:
    """The Content-Security-Policy value as the server sends it."""
    m = re.search(r'^\s*Content-Security-Policy\s+"([^"]+)"\s*$', caddyfile.read_text(), re.M)
    if not m:
        raise SystemExit(f"no Content-Security-Policy line in {caddyfile}")
    return m.group(1)


def meta_csp(policy: str) -> str:
    """The same policy without the directives a <meta> tag can't carry."""
    kept = [d.strip() for d in policy.split(";") if d.strip() and not d.strip().startswith(("frame-ancestors", "report-uri", "sandbox"))]
    return "; ".join(kept)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    index = Path(sys.argv[1]) / "index.html"
    text = index.read_text()
    if 'http-equiv="Content-Security-Policy"' in text:
        print(f"{index} already has a CSP <meta> tag; left as it is")
        return 0
    tag = f'<meta http-equiv="Content-Security-Policy" content="{html.escape(meta_csp(header_csp()))}" />'
    # First in <head>, before any script or style it governs.
    new, n = re.subn(r"<head>", "<head>\n" + tag, text, count=1)
    if n != 1:
        raise SystemExit(f"no <head> tag in {index}")
    index.write_text(new)
    print(f"added the CSP <meta> tag to {index}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
