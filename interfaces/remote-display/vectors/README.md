# interfaces/remote-display/

The remote display's page<->board contract (`SPEC.md`, draft — the spike's wording), with the exchanges it
covers as JSON vectors (`vectors/exchanges.json`). Same rules as every interface here: read the spec before
implementing anything that sends or parses these messages; change the contract only with Mike's explicit
permission.

**Runner (works like the protocol's, but the remote-display suite is the spike's own tests):**
the replay is `device-runtime/test/test_remote_display.py` and `device-runtime/test/test_ts_http_ws.py`,
run by the MicroPython unix port build (`device-runtime/test/README.md`). The page's crypto half is
`editor/test/remote-page-crypto.test.ts` (Node), so the login's SHA-256/HMAC chain stays RFC 4231-exact.
The vectors file describes these tests' exchanges as data, for a future runner more like the wire protocol's.
