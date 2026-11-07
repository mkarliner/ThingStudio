# SPDX-License-Identifier: Apache-2.0
# test/hil/wifi_link.py
#
# DutLink's network twin: the WiFi transport -- TCP 7462, the TSAUTH1 session
# handshake, then the same `F64:` base64 lines over the connection (plain
# print() lines mixed in), which is what a serial link carries. The editor's
# real path for network boards is the backend relay
# (backend/src/thingstudio_backend/tcp_relay.py); this is that link in
# blocking form, for the host-side CLI (test-flows/device_cli.py --host) and
# for the hil rig, so an agent or script can reach a board that has no USB or
# is plugged into another machine.
#
# It deliberately does NOT grow its own copy of the handshake crypto: the
# answer is computed by the backend's own answer_challenge(), imported from
# backend/src -- host tools share one implementation with the relay, the way
# the board side shares one with listener.py. STOP_TO_PROMPT and runtime
# installs stay USB-only by design (a listener stopped over the network has
# nowhere to fall back to; mpremote is a serial tool); device_cli refuses
# those over --host instead of the board discovering it later.
#
# Same duck type as hil_common.DutLink: send_message, send_raw_line,
# read_line, wait_for_message, decoder, close, plus set_read_timeout and
# clear_input for the CLI's interactive loops. read_line() returns None on a
# quiet socket, as the serial version does, and skips blank keepalive lines.

import base64
import errno
import os
import socket
import sys
import threading
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
RUNTIME_SRC = os.path.join(REPO_ROOT, "device-runtime", "src")
BACKEND_SRC = os.path.join(REPO_ROOT, "backend", "src")
for _path in (BACKEND_SRC, RUNTIME_SRC):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import protocol  # noqa: E402  (device-runtime/src/protocol.py, via RUNTIME_SRC)

F64_PREFIX = "F64:"
DEFAULT_PORT = 7462
CONNECT_TIMEOUT_S = 8.0
HANDSHAKE_TIMEOUT_S = 10.0


class HandshakeError(Exception):
    """The board refused, or was not there. `code` names it the way the
    backend's TcpRelayError does (backend/test/test_tcp_relay.py): "timeout",
    "refused", "busy", "board_no_password", "auth_failed", "handshake",
    "network"."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class LinkGone(Exception):
    """The session existed and ended: the board closed it, or a read or write
    failed. close() sets every later read to raise it, so one dead link
    cannot half-answer."""


def _crypto_module():
    """The backend's handshake + relay timings. Imported lazily so wifi_link
    can be imported without the backend on hand; backend/src is stdlib-only."""
    import thingstudio_backend.tcp_relay as tcp_relay

    return tcp_relay


def _challenge(challenge, password):
    return _crypto_module().answer_challenge(challenge, password)


def keepalive_interval_s():
    return _crypto_module().KEEPALIVE_INTERVAL_S


def wait_for_message(link, predicate, timeout_s, description):
    """hil_common.DutLink.wait_for_message's loop, shared by both link classes:
    what differs is read_line(); collecting F64 frames is the same scan."""
    deadline = time.time() + timeout_s
    debug_lines = []
    while time.time() < deadline:
        line = link.read_line()
        if line is None:
            continue
        if not line.startswith(F64_PREFIX):
            debug_lines.append(line)
            continue
        try:
            frame = base64.b64decode(line[len(F64_PREFIX):])
        except Exception:
            continue
        for result in link.decoder.push(frame):
            if "message" in result and predicate(result["message"]):
                return result["message"]
    raise TimeoutError(
        "timed out waiting for %s; debug output seen:\n%s"
        % (description, "\n".join(debug_lines))
    )


class WifiLink:
    """One authenticated network session with a board, DutLink's twin."""

    def __init__(self, host, password, tcp_port=DEFAULT_PORT,
                 connect_timeout_s=CONNECT_TIMEOUT_S,
                 handshake_timeout_s=HANDSHAKE_TIMEOUT_S,
                 keepalive_s=None):
        self.host = host
        self.tcp_port = tcp_port
        self.port_name = "%s:%s" % (host, tcp_port)  # failure messages, like a serial path
        self.hostname = None  # the board's own name, from its challenge
        self.decoder = protocol.ProtocolStreamDecoder()
        self._buf = b""
        self._sock = None
        self._closed = False
        self._lock = threading.Lock()  # one writer at a time: this thread + the keepalive
        self._connect_timeout_s = connect_timeout_s
        self._handshake_timeout_s = handshake_timeout_s
        self._connect(password)
        self._keepalive_s = keepalive_s if keepalive_s is not None else keepalive_interval_s()
        self._keepalive = threading.Thread(target=self._keepalive_loop, daemon=True)
        self._keepalive.start()

    # --- connection and handshake -----------------------------------------------------------

    def _connect(self, password):
        try:
            self._sock = socket.create_connection(
                (self.host, self.tcp_port), self._connect_timeout_s
            )
        except socket.timeout as e:
            raise HandshakeError(
                "no answer from %s within %.0fs -- is the board on this network?"
                % (self.port_name, self._connect_timeout_s), "timeout") from e
        except OSError as e:
            raise HandshakeError("%s: %s" % (self.port_name, _explain_oserror(e)),
                                 _oserror_code(e)) from e
        # A command-line tool asks and waits: small writes must go out when sent,
        # not sit in Nagle's buffer until the board ACKs the previous one.
        self._sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        try:
            self._handshake(password)
        except BaseException:
            self.close()
            raise

    def _handshake(self, password):
        self._sock.settimeout(self._handshake_timeout_s)
        challenge = self._header_line("challenge")
        if challenge == "TSAUTH BUSY":
            raise HandshakeError(
                "the board already has a network session open -- disconnect the other editor first",
                "busy")
        if challenge == "TSAUTH NOPASSWORD":
            raise HandshakeError(
                "the board has no password set -- set one in Board settings (over USB)",
                "board_no_password")
        parts = challenge.split(" ")
        if len(parts) != 5 or parts[0] != "TSAUTH1":
            raise HandshakeError(
                "not a Thingstudio board at %s (got %r)"
                % (self.port_name, challenge[:60]), "handshake")
        self.hostname = parts[1]
        try:
            answer = _challenge(challenge, password)
        except ValueError as e:
            raise HandshakeError(str(e), "handshake") from e
        self._sendall((answer + "\n").encode("ascii"))
        verdict = self._header_line("answer to the password")
        if verdict == "TSAUTH FAIL":
            raise HandshakeError("wrong password for board %s" % self.hostname, "auth_failed")
        if verdict != "TSAUTH OK":
            raise HandshakeError(
                "board %s answered an unexpected handshake line: %r"
                % (self.hostname, verdict[:60]), "handshake")

    def _header_line(self, what):
        """One handshake line; distinguishes timeouts and refusals by code."""
        try:
            raw = self._buf_readline()
        except socket.timeout as e:
            raise HandshakeError(
                "no %s from %s within %.0fs" % (what, self.port_name, self._handshake_timeout_s),
                "timeout") from e
        except EOFError as e:
            raise HandshakeError(
                "the board closed the connection before the %s" % what, "network") from e
        except OSError as e:
            raise HandshakeError("%s while waiting for the %s: %s"
                                 % (self.port_name, what, _explain_oserror(e)),
                                 _oserror_code(e)) from e
        return raw.rstrip(b"\r\n").decode("utf-8", "replace")

    # --- line transport ----------------------------------------------------------------------

    def _buf_readline(self):
        """One raw newline-terminated line of bytes; buffers across recv() calls."""
        while b"\n" not in self._buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise EOFError("the link closed before a full line arrived")
            self._buf += chunk
        line, self._buf = self._buf.split(b"\n", 1)
        return line

    def read_line(self):
        """One console line or `F64:` frame as text. None while nothing arrives
        (the read times out); LinkGone when the session is dead. Blank
        keepalive lines come back as "" and are skipped."""
        if self._sock is None:
            raise LinkGone("the session is closed")
        try:
            raw = self._buf_readline()
        except socket.timeout:
            return None
        except EOFError as e:
            raise self._gone(e) from e
        except OSError as e:
            raise self._gone(e) from e
        text = raw.rstrip(b"\r\n").decode("utf-8", "replace")
        return None if text == "" else text

    def set_read_timeout(self, seconds):
        self._sock.settimeout(seconds)

    def clear_input(self):
        """Drops buffered lines -- device_cli's hello() starts from silence."""
        self._buf = b""

    def send_raw_line(self, text):
        self._sendall((text + "\n").encode("utf-8"))

    def send_message(self, message):
        frame = protocol.encode_message(message)
        self._sendall(
            (F64_PREFIX + base64.b64encode(frame).decode("ascii") + "\n").encode("ascii"))

    def wait_for_message(self, predicate, timeout_s, description):
        return wait_for_message(self, predicate, timeout_s, description)

    def _sendall(self, data):
        sock = self._sock
        if sock is None:
            raise LinkGone("the session is closed")
        try:
            with self._lock:
                sock.sendall(data)
        except OSError as e:
            raise self._gone(e) from e

    def close(self):
        self._closed = True
        with self._lock:
            if self._sock is not None:
                try:
                    self._sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self._sock.close()
                self._sock = None

    def join_keepalive(self, timeout_s=0.1):
        """Test helper: lets the keepalive thread wind down after close()."""
        if self._keepalive.is_alive():
            self._keepalive.join(timeout_s)

    # --- failure plumbing --------------------------------------------------------------------

    def _gone(self, cause):
        self.close()
        return LinkGone("%s is gone: %s" % (self.port_name, cause))

    def _keepalive_loop(self):
        """A blank line every KEEPALIVE_INTERVAL_S (30 s), like the backend
        relay: the board drops a session that sends nothing for 90 s
        (net_transport.py), and a vanished board would leave ours half-open."""
        interval = self._keepalive_s
        while not self._closed:
            time.sleep(interval)
            if self._closed:
                return
            try:
                self._sendall(b"\n")
            except LinkGone:
                return


def _explain_oserror(exc):
    code = getattr(exc, "errno", None)
    if code == errno.ECONNREFUSED:
        return "nothing listening (a board only opens the port once a password is set)"
    if code in (errno.ENETUNREACH, errno.EHOSTUNREACH):
        return "that host or network is not reachable from here"
    return getattr(exc, "strerror", None) or str(exc)


def _oserror_code(exc):
    code = getattr(exc, "errno", None)
    if code == errno.ECONNREFUSED:
        return "refused"
    return "network"
