# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/net_interfaces.py
#
# The IPv4 broadcast address of every broadcast-capable network interface that's up (WiFi, Ethernet),
# for tcp_relay's board discovery. Sending the probe to each of these, rather than to 255.255.255.255
# alone, is what Apple's TN3179 recommends, and it's needed in practice: found 2026-09-27 on Mike's Mac
# (macOS, iTerm, Tailscale running) that a probe to 255.255.255.255 failed with "No route to host" while
# the same probe to 192.168.10.255 found the board at once. It also reaches a board on the second network
# of a machine with both Ethernet and WiFi, which the limited broadcast never did (it leaves by one
# interface only).
#
# getifaddrs(3) through ctypes, so no new dependency. macOS and Linux lay out struct ifaddrs the same
# way; struct sockaddr differs (macOS starts with a length byte), handled in _family(). Where getifaddrs
# isn't available (Windows), or anything about it fails, this returns an empty list and discovery falls
# back to 255.255.255.255 -- never raises.

from __future__ import annotations

import ctypes
import ctypes.util
import ipaddress
import logging
import socket
import sys

logger = logging.getLogger(__name__)

_IFF_UP = 0x1
_IFF_BROADCAST = 0x2
_IFF_LOOPBACK = 0x8


class _Sockaddr(ctypes.Structure):
    _fields_ = [("raw", ctypes.c_uint8 * 16)]


class _Ifaddrs(ctypes.Structure):
    pass


_Ifaddrs._fields_ = [
    ("ifa_next", ctypes.POINTER(_Ifaddrs)),
    ("ifa_name", ctypes.c_char_p),
    ("ifa_flags", ctypes.c_uint),
    ("ifa_addr", ctypes.POINTER(_Sockaddr)),
    ("ifa_netmask", ctypes.POINTER(_Sockaddr)),
    ("ifa_broadaddr", ctypes.POINTER(_Sockaddr)),
    ("ifa_data", ctypes.c_void_p),
]


def _family(sa: _Sockaddr) -> int:
    raw = bytes(sa.raw)
    if sys.platform == "darwin" or "bsd" in sys.platform:
        return raw[1]  # uint8 sa_len, uint8 sa_family
    return int.from_bytes(raw[0:2], sys.byteorder)  # uint16 sa_family


def _ipv4(sa_ptr) -> ipaddress.IPv4Address | None:
    if not sa_ptr:
        return None
    sa = sa_ptr.contents
    if _family(sa) != socket.AF_INET:
        return None
    return ipaddress.IPv4Address(bytes(sa.raw)[4:8])  # sockaddr_in: family(2), port(2), addr(4)


def broadcast_addresses() -> list[str]:
    """Directed broadcast addresses (e.g. "192.168.10.255") of every IPv4 interface that is up,
    broadcast-capable and not loopback, in interface order, without duplicates. Empty if they can't
    be read. Computed from address and netmask rather than trusting ifa_broadaddr."""
    if sys.platform == "win32":
        return []
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c") or None, use_errno=True)
        getifaddrs = libc.getifaddrs
        freeifaddrs = libc.freeifaddrs
    except (OSError, AttributeError) as exc:
        logger.debug("board discovery: getifaddrs unavailable (%s); using 255.255.255.255", exc)
        return []
    getifaddrs.argtypes = [ctypes.POINTER(ctypes.POINTER(_Ifaddrs))]
    getifaddrs.restype = ctypes.c_int
    freeifaddrs.argtypes = [ctypes.POINTER(_Ifaddrs)]
    freeifaddrs.restype = None

    head = ctypes.POINTER(_Ifaddrs)()
    if getifaddrs(ctypes.byref(head)) != 0:
        logger.debug("board discovery: getifaddrs failed (errno %d); using 255.255.255.255", ctypes.get_errno())
        return []
    found: list[str] = []
    try:
        node = head
        while node:
            ifa = node.contents
            flags = ifa.ifa_flags
            if flags & _IFF_UP and flags & _IFF_BROADCAST and not flags & _IFF_LOOPBACK:
                addr = _ipv4(ifa.ifa_addr)
                mask = _ipv4(ifa.ifa_netmask)
                if addr is not None and mask is not None and int(mask) != 0xFFFFFFFF:
                    net = ipaddress.IPv4Network(f"{addr}/{mask}", strict=False)
                    bcast = str(net.broadcast_address)
                    if bcast not in found:
                        found.append(bcast)
            node = ifa.ifa_next
    except (ValueError, OSError) as exc:  # a malformed entry: use what was found so far
        logger.debug("board discovery: reading interfaces stopped early: %s", exc)
    finally:
        freeifaddrs(head)
    return found
