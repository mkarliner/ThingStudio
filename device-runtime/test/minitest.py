# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/minitest.py
#
# A tiny hand-rolled test runner, not a dependency -- MicroPython's unix
# port (the actual off-device verification target per
# docs/working-notes/validation/mvp-validation-plan.md's "off-device first"
# convention) has no `unittest` module built into the minimal build used
# for this project's own headless tests (confirmed: `import unittest`
# fails with the build these tests are run against), and pulling in a
# third-party test framework for MicroPython isn't worth it for what's
# needed here -- a list of (name, fn) pairs, run in order, with a pass/fail
# summary and a nonzero exit code on any failure. Same
# "prefer fewer dependencies" reasoning as cbor.py.
#
# Usage, from a test_*.py file:
#   import minitest
#   def test_something():
#       assert 1 + 1 == 2
#   minitest.run([test_something, ...])

import sys


def add_src_to_path():
    """Puts device-runtime/src/ on sys.path so test_*.py files can `import
    cbor`, `import framing`, etc. directly, matching how the real runtime
    imports them on-device (flat modules on the filesystem, no package
    structure). Resolved from this file's own __file__ rather than cwd, so
    it works regardless of which directory tests are invoked from."""
    this_dir = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
    src_dir = this_dir + "/../src"
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)


def run(tests):
    passed = 0
    failed = []
    for t in tests:
        name = t.__name__
        try:
            t()
            passed += 1
            print("PASS %s" % name)
        except Exception as e:  # noqa: BLE001 -- deliberately broad, this IS the test-failure boundary
            failed.append((name, e))
            print("FAIL %s: %r" % (name, e))

    total = passed + len(failed)
    print("---")
    print("%d/%d passed" % (passed, total))
    if failed:
        sys.exit(1)
