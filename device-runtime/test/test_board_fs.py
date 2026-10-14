# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_board_fs.py
#
# board_fs.py (2026-10-14): the one filesystem root every persisted path is built from, so paths
# work on the stm32 port (mounted at /flash, not /). Under the real MicroPython unix port, ROOT is
# just the process's own cwd, and under_root() joins onto it.

import os

import minitest

minitest.add_src_to_path()

import board_fs  # noqa: E402


def test_root_is_absolute_and_slash_terminated():
    assert board_fs.ROOT.startswith("/"), board_fs.ROOT
    assert board_fs.ROOT.endswith("/"), board_fs.ROOT


def test_root_matches_getcwd():
    cwd = os.getcwd()
    expected = cwd if cwd.endswith("/") else cwd + "/"
    assert board_fs.ROOT == expected, (board_fs.ROOT, expected)


def test_under_root_joins_a_bare_name():
    assert board_fs.under_root("_flow.mpy") == board_fs.ROOT + "_flow.mpy"
    assert board_fs.under_root("lib") == board_fs.ROOT + "lib"


minitest.run([test_root_is_absolute_and_slash_terminated, test_root_matches_getcwd, test_under_root_joins_a_bare_name])
