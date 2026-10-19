#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/network-packages-pass.py
#
# One-command hardware pass for the 2026-10-19 network package conversions and the shared ts_wifi bring-up.
# Generates small flows, deploys each with device_cli.py, reads the console for a while, and reports PASS/FAIL
# against what that node must print. The point is the ESP32 + MQTT path (where the WiFi-flapping bug lived) and
# the nodes whose generated WiFi setup changed (all of them: they now call ts_wifi.ensure_station).
#
# Nothing is written into the repo: flows go to a temporary folder (or --keep DIR). Credentials passed here are
# written into those generated flow files -- keep them out of git.
#
# Example:
#   cd editor && npm run build:cli && cd ..
#   python3 test-flows/network-packages-pass.py \
#     --ssid MyNetwork --wifi-password secret \
#     --broker 192.168.1.10 --broker-port 1883 \
#     --http-url http://192.168.1.10/ \
#     --mpy-cross ~/micropython/mpy-cross/build/mpy-cross
#
# Add --port /dev/ttyACM0 (or THINGSTUDIO_PORT) for a board; --only mqtt,ntp to run a subset.

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEVICE_CLI = REPO / "test-flows" / "device_cli.py"


def configs(a: argparse.Namespace) -> list[dict]:
    wifi = {"id": "wifi1", "type": "thingstudio/config/wifi", "properties": {"ssid": a.ssid, "password": a.wifi_password, "security": a.security}}
    broker = {"id": "broker1", "type": "thingstudio/config/mqtt-broker", "properties": {"broker": a.broker, "port": a.broker_port}}
    if a.broker_user:
        broker["properties"]["username"] = a.broker_user
    if a.broker_password:
        broker["properties"]["password"] = a.broker_password
    return [wifi, broker]


def edge(a: str, out_slot: int, b: str, in_slot: int) -> list:
    return [a, out_slot, b, in_slot]


def flow(name: str, nodes: list[dict], edges: list[list], configs_: list[dict]) -> dict:
    return {
        "formatVersion": 1,
        "flowName": name,
        "nodes": nodes,
        "edges": edges,
        "layout": {n["id"]: {"pos": [80 + 180 * i, 80]} for i, n in enumerate(nodes)},
        "configs": configs_,
    }


def timer(id_: str, interval_ms: int) -> dict:
    return {"id": id_, "type": "thingstudio/timer", "properties": {"intervalMs": interval_ms}}


def debug(id_: str) -> dict:
    return {"id": id_, "type": "thingstudio/debug", "properties": {}}


def wifi_status(id_: str, poll_ms: int = 1000) -> dict:
    return {"id": id_, "type": "thingstudio/wifi_status", "properties": {"pollMs": poll_ms}}


def build_flow(name: str, a: argparse.Namespace) -> dict | None:
    cfg = configs(a)
    if name == "mqtt":
        topic = a.mqtt_topic or "thingstudio/pass/" + secrets.token_hex(4)
        nodes = [
            timer("t1", a.mqtt_interval_ms),
            {"id": "p1", "type": "thingstudio/mqtt_publish", "properties": {"topic": topic, "retain": False, "qos": 0, "brokerConfigId": "broker1"}},
            {"id": "s1", "type": "thingstudio/mqtt_subscribe", "properties": {"topic": topic, "qos": 0, "brokerConfigId": "broker1"}},
            debug("d1"),
            wifi_status("w1", 1000),
            debug("d2"),
        ]
        return flow(name, nodes, [edge("t1", 0, "p1", 0), edge("s1", 0, "d1", 0), edge("w1", 0, "d2", 0)], cfg)
    if name == "ntp":
        nodes = [
            timer("t1", 3000),
            {"id": "n1", "type": "thingstudio/ntp", "properties": {"format": "time_seconds"}},
            debug("d1"),
            wifi_status("w1", 2000),
        ]
        return flow(name, nodes, [edge("t1", 0, "n1", 0), edge("n1", 0, "d1", 0)], cfg)
    if name == "http":
        nodes = [
            timer("t1", 3000),
            {"id": "h1", "type": "thingstudio/http_request", "properties": {"url": a.http_url, "method": "GET", "timeoutMs": 5000}},
            debug("d1"),
            wifi_status("w1", 2000),
        ]
        return flow(name, nodes, [edge("t1", 0, "h1", 0), edge("h1", 0, "d1", 0)], cfg)
    if name == "udp":
        nodes = [
            timer("t1", 2000),
            {"id": "u1", "type": "thingstudio/udp_send", "properties": {"host": a.udp_host, "port": a.udp_port, "timeoutMs": 2000}},
            {"id": "u2", "type": "thingstudio/udp_receive", "properties": {"port": a.udp_port, "pollMs": 20}},
            debug("d1"),
            wifi_status("w1", 2000),
        ]
        return flow(name, nodes, [edge("t1", 0, "u1", 0), edge("u2", 0, "d1", 0)], cfg)
    if name == "gate":
        nodes = [timer("t1", 2000), {"id": "g1", "type": "thingstudio/wifi_gate", "properties": {}}, debug("d1"), wifi_status("w1", 2000)]
        return flow(name, nodes, [edge("t1", 0, "g1", 0), edge("g1", 0, "d1", 0)], cfg)
    return None


EXPECT = {
    # name: (description, predicate over the console text)
    "mqtt": (
        "wifi_status reports connected once and stays there; an MQTT publish comes back through subscribe",
        lambda t: "payload=True" in t and "DEBUG node=d1" in t and "payload=False" not in t,
    ),
    "ntp": ("a formatted time arrives from NTP", lambda t: "DEBUG node=d1" in t and "payload=" in t),
    "http": ("an HTTP response body arrives", lambda t: "DEBUG node=d1" in t and "payload=" in t),
    "udp": ("the datagram sent by udp_send is received by udp_receive", lambda t: "DEBUG node=d1" in t and "payload=b'" in t),
    "gate": ("messages pass through wifi_gate while connected", lambda t: "DEBUG node=d1" in t and "payload=" in t),
}


def run_flow(path: Path, a: argparse.Namespace) -> tuple[int, str]:
    cmd = [sys.executable, str(DEVICE_CLI), "flow", "deploy", str(path), "--timeout", str(a.seconds)]
    if a.port:
        cmd += ["--port", a.port]
    if a.mpy_cross:
        cmd += ["--mpy-cross", a.mpy_cross]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO))
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    ap = argparse.ArgumentParser(description="Hardware pass: network packages, ts_wifi and the ESP32 + MQTT path", formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default=os.environ.get("THINGSTUDIO_PORT"), help="serial port (default: the one port found)")
    ap.add_argument("--ssid", required=True)
    ap.add_argument("--wifi-password", default="", help="empty for an open network")
    ap.add_argument("--security", default="password", choices=["password", "open", "unmanaged"])
    ap.add_argument("--broker", required=True, help="MQTT broker host (LAN address)")
    ap.add_argument("--broker-port", type=int, default=1883)
    ap.add_argument("--broker-user", default="")
    ap.add_argument("--broker-password", default="")
    ap.add_argument("--http-url", default="http://example.com/", help="plain http:// URL the board can reach")
    ap.add_argument("--udp-host", default="127.0.0.1", help="udp_send target (127.0.0.1 loops back on the board)")
    ap.add_argument("--udp-port", type=int, default=9918)
    ap.add_argument("--mqtt-topic", default="", help="default: a random thingstudio/pass/<hex> topic")
    ap.add_argument("--mqtt-interval-ms", type=int, default=2000)
    ap.add_argument("--seconds", type=float, default=15, help="console time per flow (default 15 s)")
    ap.add_argument("--mpy-cross", default=None)
    ap.add_argument("--only", default="", help="comma-separated subset of: " + ",".join(EXPECT))
    ap.add_argument("--keep", default=None, help="keep the generated flows in this directory")
    ap.add_argument("--dry-run", action="store_true", help="write the flows and stop; no board needed")
    args = ap.parse_args()

    if not (REPO / "editor" / "dist-cli" / "thingstudio-compile.mjs").exists():
        print("build the compiler first: cd editor && npm run build:cli", file=sys.stderr)
        return 2

    names = [n.strip() for n in args.only.split(",") if n.strip()] or list(EXPECT)
    unknown = [n for n in names if n not in EXPECT]
    if unknown:
        print("unknown flow(s): " + ", ".join(unknown), file=sys.stderr)
        return 2

    out_dir = Path(args.keep) if args.keep else Path(tempfile.mkdtemp(prefix="thingstudio-network-pass-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"generated flows: {out_dir}")
    if not args.keep:
        print("(temporary; deleted at the end -- credentials are in these files)")

    results = []
    try:
        for name in names:
            data = build_flow(name, args)
            assert data is not None
            path = out_dir / f"{name}.flow.json"
            path.write_text(json.dumps(data, indent=2) + "\n")
            if args.dry_run:
                results.append((name, True, "dry run: flow written", "", 0.0))
                print(f"dry run  {name}: {path}")
                continue
            print(f"\n=== {name}: deploying (watch for {args.seconds:g}s) ===")
            started = time.time()
            code, text = run_flow(path, args)
            elapsed = time.time() - started
            desc, ok = EXPECT[name]
            crashed = any(s in text for s in ("NODE_ERROR", "Traceback", "COMPILE ERROR", "DEPLOY failed"))
            passed = code == 0 and not crashed and ok(text)
            results.append((name, passed, desc, text, elapsed))
            print(f"{'PASS' if passed else 'FAIL'}  {name}: {desc} ({elapsed:.1f}s)")
            if not passed:
                print("--- console ---")
                print(text[-4000:])
    finally:
        if not args.keep and not args.dry_run:
            shutil.rmtree(out_dir, ignore_errors=True)

    print("\n=== summary ===")
    for name, passed, desc, _text, elapsed in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name:<6} {elapsed:5.1f}s  {desc}")
    failed = [r for r in results if not r[1]]
    if failed:
        print("\nnotes for a failure:")
        print("- wifi_status flipping to False, or repeatedly reconnecting, is the flapping bug: capture the")
        print("  whole console and the broker's connection log.")
        print("- wifi_status reports connected but MQTT never sees a message: check broker reachability/credentials.")
        print("- a compile/deploy failure naming a compile hook means the interpreter/worker path, not this flow.")
        return 1
    print("\nall selected flows passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
