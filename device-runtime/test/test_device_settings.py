# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_device_settings.py
#
# device_settings.py under the real MicroPython unix port: namespacing by
# flow name, persistence across a simulated reboot, fail-safe load (missing
# vs corrupt, moved aside), the JSON-native value rules, and the explicit
# cleanup surface (clear/clear_all/prune). File path comes from
# THINGSTUDIO_SETTINGS_PATH -- set before importing, same hook style as
# test_board_settings.py.

import os
import json

import minitest

minitest.add_src_to_path()

_PATH = "/tmp/ts_device_settings_test.json"
try:
    os.putenv("THINGSTUDIO_SETTINGS_PATH", _PATH)
except AttributeError:
    os.environ["THINGSTUDIO_SETTINGS_PATH"] = _PATH

import device_settings as ds  # noqa: E402


def _exists(path):
    try:
        with open(path):
            return True
    except OSError:
        return False


def _fresh(namespace="flow-a"):
    for path in (ds._PATH, ds._CORRUPT, ds._PATH + ".tmp"):
        try:
            os.remove(path)
        except OSError:
            pass
    ds._reset_cache_for_tests()
    ds.set_namespace(namespace)


def _raises(fn):
    try:
        fn()
    except ds.SettingsError:
        return True
    return False


def _write(text):
    with open(ds._PATH, "w") as f:
        f.write(text)


def test_fresh_reads_default_and_no_keys():
    _fresh()
    assert ds.get("theme") is None
    assert ds.get("theme", "light") == "light"
    assert ds.keys() == []
    assert ds.namespaces() == {}


def test_set_get_survives_reboot():
    _fresh()
    ds.set("theme", "dark")
    assert ds.get("theme") == "dark"
    # Simulate a reboot: drop the in-RAM cache and reload from flash.
    ds._reset_cache_for_tests()
    ds.set_namespace("flow-a")
    assert ds.get("theme") == "dark"
    with open(ds._PATH) as f:
        data = json.loads(f.read())
    assert data["flow-a"]["theme"] == "dark"
    assert not _exists(ds._PATH + ".tmp")


def test_namespace_isolation():
    _fresh("flow-a")
    ds.set("theme", "dark")
    ds.set_namespace("flow-b")
    assert ds.get("theme", "light") == "light"  # cannot see flow-a's value
    ds.set("theme", "blue")
    ds.set_namespace("flow-a")
    assert ds.get("theme") == "dark"  # and flow-a is unchanged
    counts = ds.namespaces()
    assert counts["flow-a"] == 1 and counts["flow-b"] == 1


def test_unnamed_flow_is_its_own_namespace():
    _fresh("flow-a")
    ds.set("units", "kg")
    ds.set_namespace("")
    assert ds.get("units", "lbs") == "lbs"
    ds.set("units", "lbs")
    with open(ds._PATH) as f:
        data = json.loads(f.read())
    assert data[""] == {"units": "lbs"}
    assert data["flow-a"] == {"units": "kg"}


def test_corrupt_file_moved_aside_and_boots_empty():
    _fresh()
    _write("{not json")
    assert ds.get("theme", "light") == "light"  # never raises
    assert _exists(ds._CORRUPT)
    assert not _exists(ds._PATH)  # moved, so a fresh save can start clean
    with open(ds._CORRUPT) as f:
        assert f.read() == "{not json"
    ds.set("theme", "dark")
    assert ds.get("theme") == "dark"


def test_malformed_namespace_dropped_others_kept():
    _fresh()
    _write('{"good": {"k": 1}, "bad": 5, "also": [1, 2]}')
    ds._reset_cache_for_tests()
    ds.set_namespace("good")
    assert ds.get("k") == 1
    assert ds.namespaces() == {"good": 1}


def test_unencodable_values_rejected_before_write():
    _fresh()
    ds.set("theme", "dark")
    for bad in (b"bytes", bytearray(b"x"), {1: "int key"}, float("nan"), float("inf"), (1, 2)):
        assert _raises(lambda b=bad: ds.set("theme", b)), bad
        assert ds.get("theme") == "dark"  # the old value is intact


def test_key_must_be_a_non_empty_string():
    _fresh()
    assert _raises(lambda: ds.set("", 1))
    assert _raises(lambda: ds.set(5, 1))
    assert ds.keys() == []


def test_nested_json_values_round_trip():
    _fresh()
    value = {"a": [1, 2, None, True], "b": {"c": 1.5}}
    ds.set("cfg", value)
    ds._reset_cache_for_tests()
    ds.set_namespace("flow-a")
    assert ds.get("cfg") == value


def test_delete():
    _fresh()
    ds.set("theme", "dark")
    ds.delete("theme")
    assert ds.get("theme", "light") == "light"
    ds.delete("never-there")  # no-op, not an error


def test_clear_current_and_named():
    _fresh("flow-a")
    ds.set("a", 1)
    ds.set_namespace("flow-b")
    ds.set("b", 2)
    ds.clear()  # current = flow-b
    assert ds.get("b") is None
    ds.set_namespace("flow-a")
    assert ds.get("a") == 1
    ds.clear("flow-a")
    assert ds.get("a") is None
    ds.clear("not-there")  # no-op


def test_clear_all_removes_corrupt_copy():
    _fresh()
    ds.set("theme", "dark")
    with open(ds._CORRUPT, "w") as f:
        f.write("{bad")
    ds.clear_all()
    assert ds.namespaces() == {}
    assert not _exists(ds._PATH)
    assert not _exists(ds._CORRUPT)


def test_prune_keeps_only_named_namespaces():
    _fresh("a")
    ds.set("x", 1)
    ds.set_namespace("b")
    ds.set("x", 2)
    ds.set_namespace("c")
    ds.set("x", 3)
    removed = ds.prune(["a"])
    assert sorted(removed) == ["b", "c"]
    assert ds.namespaces() == {"a": 1}
    ds.set_namespace("a")
    assert ds.get("x") == 1


def test_write_failure_is_an_attributed_settings_error():
    _fresh()
    ds.set("theme", "dark")
    old_path, old_corrupt = ds._PATH, ds._CORRUPT
    ds._PATH = "/nonexistent_ts_settings_dir/settings.json"
    ds._CORRUPT = ds._PATH + ".corrupt"
    try:
        assert _raises(lambda: ds.set("theme", "blue"))
        assert ds.get("theme") == "dark"  # the failed save did not corrupt state
    finally:
        ds._PATH, ds._CORRUPT = old_path, old_corrupt


minitest.run(
    [
        test_fresh_reads_default_and_no_keys,
        test_set_get_survives_reboot,
        test_namespace_isolation,
        test_unnamed_flow_is_its_own_namespace,
        test_corrupt_file_moved_aside_and_boots_empty,
        test_malformed_namespace_dropped_others_kept,
        test_unencodable_values_rejected_before_write,
        test_key_must_be_a_non_empty_string,
        test_nested_json_values_round_trip,
        test_delete,
        test_clear_current_and_named,
        test_clear_all_removes_corrupt_copy,
        test_prune_keeps_only_named_namespaces,
        test_write_failure_is_an_attributed_settings_error,
    ]
)
