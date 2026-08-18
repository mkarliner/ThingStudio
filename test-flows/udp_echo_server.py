#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/udp_echo_server.py
#
# The real local UDP peer this batch's own implementation briefing called
# for -- "a real test here needs a real network peer -- a local UDP/TCP
# echo server or listener on Mike's own machine, not the witness GPIO rig"
# -- for exercising udp-echo-tester.flow.json's udp_send/udp_receive pair
# against real hardware (a Pico W and/or ESP32-C3 on the same WiFi
# network as this machine).
#
# Two independent UDP flows, not one request/response pair on a single
# port: listens on --listen-port for datagrams from a board's udp_send
# node, prints each one, and echoes "ECHO:<payload>" back to the sender's
# IP on --reply-port -- deliberately the FIXED reply port, not the
# sender's own (ephemeral) source port. A board's udp_send socket never
# reads anything back (it's a fire-and-forget sink -- no recvfrom in its
# generated code at all, see editor/src/node-library/udp-send.ts); only
# the board's separate udp_receive node, bound to --reply-port, is set up
# to actually pick the echo up.
#
# stdlib only, run directly:
#   python3 test-flows/udp_echo_server.py --listen-port 9999 --reply-port 9998

import argparse
import socket
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen-port", type=int, required=True, help="port boards send TO (udp_send's configured port)")
    parser.add_argument("--reply-port", type=int, required=True, help="port boards listen ON (udp_receive's configured port)")
    parser.add_argument("--bind", default="0.0.0.0", help="local address to bind (default: all interfaces)")
    args = parser.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.bind, args.listen_port))
    print("Listening on %s:%d, echoing to <sender-ip>:%d ... Ctrl-C to stop." % (args.bind, args.listen_port, args.reply_port))

    try:
        while True:
            data, addr = sock.recvfrom(2048)
            ts = time.strftime("%H:%M:%S")
            print("[%s] RECEIVED from %s: %r" % (ts, addr, data))
            reply = b"ECHO:" + data
            sock.sendto(reply, (addr[0], args.reply_port))
            print("[%s] REPLIED to %s:%d: %r" % (ts, addr[0], args.reply_port, reply))
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
