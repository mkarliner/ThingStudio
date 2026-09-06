#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/http_test_server.py
#
# Local HTTP test peer for exercising basic-http-request.flow.json's
# http_request node against real hardware (an ESP32/RP2040 board on the
# same WiFi network as this machine) -- same role udp_echo_server.py
# plays for udp_send/udp_receive.
#
# Deliberately NOT `python3 -m http.server`: that handler 501s on POST,
# and http-request.ts's client (editor/src/node-library/http-request.ts)
# has no chunked-transfer-encoding support -- only Content-Length or
# read-until-close bodies -- so every response here sets an explicit
# Content-Length rather than relying on BaseHTTPRequestHandler defaults.
#
# GET any path -> fixed 200 response body, so a quick round-trip doesn't
#   need any file on disk.
# POST any path -> reads exactly Content-Length bytes of the request
#   body and echoes them back prefixed with "ECHO:", confirming the
#   node's request body actually left the board and came back in `msg`.
#
# stdlib only, run directly, reachable from the board's WiFi network (not
# just localhost -- the board is a separate machine, per basic-http-
# request.flow.json's own notes):
#   python3 test-flows/http_test_server.py --port 8000
#
# Find this Mac's LAN IP for the flow's `url` property with, e.g.:
#   ipconfig getifaddr en0

import argparse
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def _log(self, label, extra=""):
        ts = time.strftime("%H:%M:%S")
        print("[%s] %s %s %s%s" % (ts, self.client_address[0], self.command, self.path, (" -- " + extra) if extra else ""))

    def do_GET(self):
        self._log("GET")
        body = b"hello from http_test_server.py\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        received = self.rfile.read(length) if length else b""
        self._log("POST", "received %r" % received)
        body = b"ECHO:" + received
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # replaced by _log() above -- default logging doesn't show the body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bind", default="0.0.0.0", help="local address to bind (default: all interfaces)")
    args = parser.parse_args()

    server = HTTPServer((args.bind, args.port), Handler)
    print("Listening on %s:%d ... Ctrl-C to stop." % (args.bind, args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
