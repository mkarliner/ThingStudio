# Web server

Serves ThingStudio Web, `web.thingstudio.net`: the editor and Set up a board as static files with nothing behind
it. `demo.thingstudio.net` points at the same server, which redirects it to `web.thingstudio.net`. Plan and
reasons: `docs/working-notes/online-editor-demo-scoping.md`.

- `Caddyfile`: the web server. Static files only, no directory listing, the security headers, caching, and a
  three-day access log with no IP addresses. The Content-Security-Policy is written here and nowhere else.
- `add_meta_csp.py`: puts the same policy into `index.html` as a `<meta>` tag, for the GitHub Pages standby
  copy, which can't send headers.
- `../../tools/deploy_demo.sh`: installs a release's demo zip on the server and switches to it.

## On the server

The demo sits behind Pangolin, which terminates TLS in its Traefik and forwards plain HTTP down its tunnel.

1. A container or VM of its own, with Caddy, kept apart from the rest of the lab. Automatic security updates on.
2. A deploy user that owns `/srv/thingstudio-demo` and nothing else. Caddy reads that folder and can't write it.
3. Copy `Caddyfile` into place, `caddy validate`, then start Caddy. It listens on plain HTTP, port 8080. With
   Caddy's Debian/Ubuntu package, the place is `/etc/caddy/Caddyfile` (`systemctl cat caddy` shows the path in
   use); after a change, `sudo caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`.
4. In Pangolin, add resources for `web.thingstudio.net` and `demo.thingstudio.net`, both pointing at
   `http://<this host>:8080`, with **authentication off**: the demo is public, and with it on, visitors get Pangolin's login page. Pangolin's
   Traefik gets the certificate.
   Pangolin must pass the visitor's `Host` header through unchanged: the redirect depends on it.
5. DNS: `web.thingstudio.net` and `demo.thingstudio.net` to Pangolin, with a short TTL so the Pages standby is a
   quick switch. A CAA record
   allowing only `letsencrypt.org` is a cheap extra.
6. As the deploy user: `tools/deploy_demo.sh v0.13.0` (any released version with a demo zip).

The security headers come from Caddy and pass through Traefik. If Pangolin or a Traefik middleware adds its own
`Content-Security-Policy` or other security headers, the browser applies both; take them off that route, so the
Caddyfile stays the one place they're set.

After the first deploy, check:

- `curl -sI https://web.thingstudio.net/vendor/micropython-wasi/micropython-wasi.wasm` says
  `content-type: application/wasm`;
- the headers with securityheaders.com or `curl -sI https://web.thingstudio.net/`;
- the browser matrix: Chrome, Edge, Firefox, Safari on desktop; a phone for the narrow-screen message.

## Pages standby

Unzip the same release zip into the Pages repository, run `python3 packaging/demo-server/add_meta_csp.py <folder>`,
and push. Switching is a DNS change.

## What it sends

`tools/demo_request_check.py` opens the built demo in Chromium with these headers, opens and compiles every example,
and fails on any request that leaves the page's own origin. Its JSON report is the evidence for "the demo sends
nothing". The release workflow runs it and attaches the report.
