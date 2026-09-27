/* SPDX-License-Identifier: Apache-2.0
 * packaging/macos/thingstudio-python.c
 *
 * The macOS bundle's Python executable: identical in behaviour to python3 (CPython's own main is this
 * one call), but linked by tools/make_bundle.py with Info.plist embedded in its __TEXT,__info_plist
 * section and signed as org.thingstudio.backend. macOS attributes Local Network access to this executable,
 * and only shows the permission prompt for one that declares NSLocalNetworkUsageDescription this way; an
 * undeclared command-line tool is denied silently (learnings/backend-security-research.md). The plist
 * can't be added to python-build-standalone's already-linked python3, hence this file.
 */
#include <Python.h>

int main(int argc, char **argv) { return Py_BytesMain(argc, argv); }
