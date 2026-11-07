# SPDX-License-Identifier: Apache-2.0
# test/hil/test_wifi_link.py
#
# Off-device tests for test/hil/wifi_link.py, against an in-process fake board
# that speaks the WiFi transport's real server side (TSAUTH1 challenge, then
# `F64:` lines) -- driven over real sockets, the client-half equivalent of
# backend/test/test_tcp_relay.py's FakeBoard. The handshake crypto itself is
# not re-tested here: the answer comes from the backend's answer_challenge(),
# whose vectors live behind that module; one independent-HMAC check repeats at
# the bottom so the client half is pinned from this file too.
#
#   python3 -m pytest -q test/hil/test_wifi_link.py   # needs pytest + pyserial

import base64
import hashlib
import hmac
import json
import os
import socket
import sys
import threading
import time

import pytest

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
sys.path.insert(0, THIS_DIR)
sys.path.insert(0, os.path.join(REPO_ROOT, "device-runtime", "src"))

import protocol  # noqa: E402
import wifi_link  # noqa: E402

PASSWORD = "pw123456"
HOSTNAME = "kitchen"
SALT = bytes(range(32))
NONCE = bytes(range(8))
ITERATIONS = 7

CHALLENGE = "TSAUTH1 %s %s %s %d" % (HOSTNAME, NONCE.hex(), SALT.hex(), ITERATIONS)


def want_mac():
    """The same answer computed independently, for comparison."""
    key = SALT + PASSWORD.encode()
    for _ in range(ITERATIONS):
        key = hashlib.sha256(key).digest()
    return hmac.new(key, NONCE, hashlib.sha256).hexdigest()


class FakeBoard:
    """The board's side of the handshake on a real listening socket. `mode`
    selects the refusal shapes; `lines` (bytes) are what it sends after OK, or
    `gone` makes it close the socket first."""

    MODES = ("normal", "busy", "nopassword", "wrong_password", "garbage", "silent", "gone")

    def __init__(self, mode="normal", lines=b"", hello_reply=b""):
        assert mode in self.MODES
        self.mode = mode
        self.lines = lines
        self.hello_reply = hello_reply
        self.answer = None  # the TSAUTH1 answer the client sent
        self.post_ok = b""  # what the client sent after `TSAUTH OK` (grows as it arrives)
        self._lock = threading.Lock()  # server thread writes, tests read
        self._server = self._socket_listen()
        self._client = None
        self._done = threading.Event()

    def _socket_listen(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(5.0)
        self.port = server.getsockname()[1]
        return server

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self):
        try:
            conn, _ = self._server.accept()
        except (socket.timeout, OSError):
            self._done.set()
            return
        self._client = conn
        conn.settimeout(5.0)
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        try:
            if self.mode == "gone":
                conn.close()
                return
            if self.mode == "silent":
                self._done.wait(5.0)  # hold the socket open, send nothing
                return
            if self.mode == "busy":
                conn.sendall(b"TSAUTH BUSY\n")
                return
            if self.mode == "nopassword":
                conn.sendall(b"TSAUTH NOPASSWORD\n")
                return
            if self.mode == "garbage":
                conn.sendall(b"HTTP/1.1 404 Not Found\n")
                return
            conn.sendall((CHALLENGE + "\n").encode())
            self.answer = conn.recv(4096)
            if self.mode == "wrong_password" or self.answer.decode().strip() != "TSAUTH1 %s" % want_mac():
                conn.sendall(b"TSAUTH FAIL\n")
                return
            conn.sendall(b"TSAUTH OK\n")
            if self.lines:
                conn.sendall(self.lines)
            # record whatever the client sends next, and answer HELLO_REQUEST
            # the way a live listener answers its serial/network transports
            decoder = protocol.ProtocolStreamDecoder()
            deadline = time.time() + 2.0
            while time.time() < deadline:
                try:
                    piece = conn.recv(4096)
                except socket.timeout:
                    break
                except OSError:
                    break
                if not piece:
                    break
                with self._lock:
                    self.post_ok += piece
                self._answer_requests(conn, piece, decoder)
        finally:
            self._done.set()
            if self.mode != "silent":
                try:
                    conn.close()
                except OSError:
                    pass

    def _answer_requests(self, conn, piece, decoder):
        for raw_line in piece.split(b"\n"):
            if not raw_line.startswith(b"F64:"):
                continue
            try:
                frame = base64.b64decode(raw_line[len("F64:"):])
            except Exception:
                continue
            for result in decoder.push(frame):
                if (result["message"].get("type") == "HELLO_REQUEST"
                        and self.hello_reply):
                    conn.sendall(self.hello_reply)


class BoardCase:
    """Start, stop, and wait for the server thread so no socket is torn down
    while in use."""

    def __init__(self, **kwargs):
        self.board = FakeBoard(**kwargs).start()

    def __enter__(self):
        return self.board

    def __exit__(self, *exc):
        self._stop()
        return False

    def _stop(self):
        if self.board._client is not None:
            try:
                self.board._client.close()  # unblocks the server thread's recv
            except OSError:
                pass
        self.board._done.wait(timeout=5)
        self.board._server.close()

    def read_loop_running_for(self, seconds=0.1):
        """Server handshake done? Not exact; give the test a beat."""
        time.sleep(seconds)


def open_link(board, **kwargs):
    kwargs.setdefault("keepalive_s", 0.05)
    return wifi_link.WifiLink("127.0.0.1", PASSWORD, tcp_port=board.port, handshake_timeout_s=2, **kwargs)


def spec_hello_message():
    """One spec-real HELLO (interfaces/protocol/SPEC.md §HELLO: required fields
    present), so the protocol decoder accepts it as the CLI's wait_for does."""
    return {
        "type": "HELLO",
        "chipType": "ESP32-S3",
        "runtimeVersion": {"major": 15, "minor": 1, "patch": 0},
        "runtimeBuild": "test-build",
        "freeFlashBytes": 8_000_000,
        "freeRamBytes": 1_000_000,
        "freeIdfHeapBytes": 7_000_000,
        "largestIdfHeapBlockBytes": 6_000_000,
        "safeMode": False,
        "hostname": HOSTNAME,
        "authRequired": True,
        "authScheme": "hmac-sha256-nonce",
        "hasWifi": True,
        "networkAddress": "192.168.1.42:7462",
        "dependencies": {},
    }


def collected(link, count=6, quiet_s=0.15):
    """read_line() a few times with short silence gaps, keeping None."""
    link.set_read_timeout(quiet_s)
    return [link.read_line() for _ in range(count)]


# --- the happy path ---------------------------------------------------------------------------


def test_handshake_and_round_trip_both_ways():
    helo = protocol.encode_message({"type": "HELLO", "chipType": "ESP32-S3"})
    frame = "F64:" + base64.b64encode(helo).decode()
    with BoardCase(lines=("hello\nworld\n" + frame + "\n").encode()) as board:
        link = open_link(board)
        try:
            # the challenge is answered with the right HMAC and hostname is learned
            assert link.hostname == HOSTNAME
            assert board.answer.decode().strip() == "TSAUTH1 %s" % want_mac()
            # the board's plain lines then its frame, in order; blanks skipped
            got = [line for line in collected(link) if line is not None]
            assert got == ["hello", "world", frame]
            # the CLI's HELLO_REQUEST arrives F64-framed as the protocol says
            link.send_message({"type": "HELLO_REQUEST"})
            link.set_read_timeout(0.05)
            time.sleep(0.1)
            sent = next(l for l in board.post_ok.split(b"\n") if l.startswith(b"F64:"))
            decoded = list(link.decoder.push(base64.b64decode(sent[len("F64:"):])))
            assert decoded[0]["message"]["type"] == "HELLO_REQUEST"
        finally:
            link.close()


# --- the refusals, in the backend's code vocabulary -------------------------------------------


@pytest.mark.parametrize("mode,code", [
    ("busy", "busy"),
    ("nopassword", "board_no_password"),
    ("wrong_password", "auth_failed"),
    ("garbage", "handshake"),
    ("gone", "network"),  # backend: "connection closed before the challenge" -> TcpRelayError network
    ("silent", "timeout"),
])
def test_handshake_failures_carry_named_codes(mode, code):
    with BoardCase(mode=mode) as board:
        try:
            open_link(board)
            pytest.fail("handshake should have failed")
        except wifi_link.HandshakeError as err:
            assert err.code == code


def test_a_port_nothing_is_listening_on_is_a_refusal():
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    dead_port = probe.getsockname()[1]
    probe.close()
    with pytest.raises(wifi_link.HandshakeError) as err:
        open_link(_FakePort(dead_port))
    assert err.value.code == "refused"


class _FakePort:
    def __init__(self, port):
        self.port = port


def test_a_dead_session_raises_link_gone_and_stays_dead():
    with BoardCase() as board:
        link = open_link(board)
        link.close()
        with pytest.raises(wifi_link.LinkGone):
            link.read_line()
        with pytest.raises(wifi_link.LinkGone):
            link.send_message({"type": "HELLO_REQUEST"})
        link.join_keepalive()


def test_the_board_closing_mid_session_raises_link_gone_not_a_quiet_read():
    with BoardCase() as board:
        link = open_link(board)
        board_interrupts(board)
        try:
            with pytest.raises(wifi_link.LinkGone):
                link.read_line()
        finally:
            link.close()


def board_interrupts(board):
    board._client.close()


def test_blank_lines_from_the_board_are_never_console_output():
    with BoardCase(lines=b"\n\nsurvivor!\n") as board:
        link = open_link(board)
        try:
            got = [line for line in collected(link) if line is not None]
            assert got == ["survivor!"]
        finally:
            link.close()


def test_the_keepalive_sends_blank_lines_like_the_backend_relay():
    with BoardCase() as board:
        link = open_link(board, keepalive_s=0.05)
        try:
            deadline = time.time() + 2.0
            while time.time() < deadline:
                if board.post_ok:
                    break
                time.sleep(0.05)
            assert board.post_ok.rstrip(b"\n") == b"", board.post_ok
        finally:
            link.close()


def test_clear_input_drops_buffered_console_lines():
    with BoardCase(lines=b"stale\nfresh\n") as board:
        link = open_link(board)
        try:
            collected(link, 2, 0.05)  # both lines arrive into the client...
            link.clear_input()        # ...and hello() throws them away
            assert link.read_line() is None
        finally:
            link.close()


# --- the two link classes share one waiting loop ----------------------------------------------


def test_dutlink_delegates_to_the_shared_message_loop():
    import hil_common
    import inspect

    source = inspect.getsource(hil_common.DutLink.wait_for_message)
    assert "wifi_link.wait_for_message" in source
    assert hil_common.F64_PREFIX == wifi_link.F64_PREFIX


# --- the CLI glue ------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def device_cli():
    sys.path.insert(0, os.path.join(REPO_ROOT, "test-flows"))
    yield __import__("device_cli")


def test_device_cli_hello_over_the_network(device_cli, capsys):
    helo = protocol.encode_message(spec_hello_message())
    frame = "F64:" + base64.b64encode(helo).decode()
    with BoardCase(lines=(frame + "\n").encode(),
                   hello_reply=(frame + "\n").encode()) as board:
        code = device_cli.main([
            "hello", "--host", "127.0.0.1", "--password", PASSWORD,
            "--tcp-port", str(board.port), "--json", "--timeout", "2",
        ])
        assert code == 0
        out = capsys.readouterr().out
        helo_line = next(l for l in out.splitlines()
                         if l.startswith("{") and json.loads(l).get("type") == "HELLO")
        summary = json.loads(helo_line)
        assert summary["chipType"] == "ESP32-S3"
        assert summary["runtimeVersion"]["major"] == 15


def test_device_cli_hello_over_the_network_by_environment(device_cli, capsys, monkeypatch):
    frame = "F64:" + base64.b64encode(protocol.encode_message(spec_hello_message())).decode()
    with BoardCase(lines=(frame + "\n").encode(),
                   hello_reply=(frame + "\n").encode()) as board:
        monkeypatch.setenv("THINGSTUDIO_HOST", "127.0.0.1")
        monkeypatch.setenv("THINGSTUDIO_BOARD_PASSWORD", PASSWORD)
        code = device_cli.main(["hello", "--tcp-port", str(board.port), "--json", "--timeout", "2"])
        assert code == 0
        assert any(json.loads(l).get("type") == "HELLO" for l in capsys.readouterr().out.splitlines())


def test_device_cli_refuses_a_lost_password(device_cli, capsys, monkeypatch):
    monkeypatch.delenv("THINGSTUDIO_HOST", raising=False)
    monkeypatch.delenv("THINGSTUDIO_BOARD_PASSWORD", raising=False)
    code = device_cli.main(["hello", "--host", "127.0.0.1", "--json"])
    assert code == 1
    err = capsys.readouterr().err
    assert "THINGSTUDIO_BOARD_PASSWORD" in err


def test_device_cli_refuses_stop_over_wifi(device_cli, capsys):
    code = device_cli.main(["stop", "--host", "127.0.0.1", "--password", PASSWORD, "--json"])
    assert code == 1
    assert "USB" in capsys.readouterr().err


def test_device_cli_refuses_runtime_install_over_wifi(device_cli, capsys):
    code = device_cli.main(["runtime", "install", "--host", "127.0.0.1", "--password", PASSWORD, "--json"])
    assert code == 1
    assert "USB" in capsys.readouterr().err


# --- the answer is the backend's own implementation, checked independently ---------------------


def test_the_answer_is_an_independent_hmac():
    from thingstudio_backend.tcp_relay import answer_challenge

    assert answer_challenge(CHALLENGE, PASSWORD) == "TSAUTH1 %s" % want_mac()
