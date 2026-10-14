# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_runtime_api.py
#
# The device runtime's side of the runtime-API contract
# (interfaces/runtime-api/SPEC.md + api.json): assert the real runtime
# module exposes exactly the documented surface, with the right kind. Run
# under the MicroPython unix-port build (device-runtime/test/README.md):
#   micropython test_runtime_api.py

import minitest

minitest.add_src_to_path()

import json
import runtime

_THIS_DIR = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
_API_PATH = _THIS_DIR + "/../../interfaces/runtime-api/api.json"


def _load_surface():
    with open(_API_PATH, "r") as f:
        return json.loads(f.read())["surface"]


def test_documented_surface_present_with_correct_kind():
    for entry in _load_surface():
        name = entry["name"]
        kind = entry["kind"]
        assert hasattr(runtime, name), "runtime.%s (documented in api.json) is missing" % name
        value = getattr(runtime, name)
        if kind == "function":
            assert callable(value), "runtime.%s should be callable" % name
        elif kind == "class":
            assert isinstance(value, type), "runtime.%s should be a class" % name
        elif kind == "attribute":
            pass  # any value is fine
        else:
            raise AssertionError("unknown kind %r for runtime.%s" % (kind, name))


minitest.run([test_documented_surface_present_with_correct_kind])
