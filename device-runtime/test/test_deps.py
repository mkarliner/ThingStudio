# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_deps.py
#
# deps.py (flow dependencies, 2026-10-07) under the real MicroPython unix port: install, replace,
# the index, the pre-import check, cleanup of unused dependencies, and the failure cases (bad
# names, a stale other-format copy, a missing file). LIB_DIR goes to a temp directory via
# THINGSTUDIO_LIB_DIR, set before importing, same hook style as listener.py's own paths.

import os
import sys

import minitest

minitest.add_src_to_path()

_DIR = "/tmp/ts_deps_test_lib"
try:
    os.putenv("THINGSTUDIO_LIB_DIR", _DIR)
except AttributeError:
    os.environ["THINGSTUDIO_LIB_DIR"] = _DIR

import deps  # noqa: E402


def _fresh():
    try:
        for name in os.listdir(_DIR):
            os.remove(_DIR + "/" + name)
        os.rmdir(_DIR)
    except OSError:
        pass


def _ls():
    try:
        return sorted(os.listdir(_DIR))
    except OSError:
        return []


def _read(name):
    with open(_DIR + "/" + name, "rb") as f:
        return f.read()


def _raises(code, fn, *args):
    try:
        fn(*args)
    except deps.DepError as e:
        assert e.code == code, (e.code, e.message)
        return e
    raise AssertionError("expected DepError %s" % code)


def test_lib_dir_comes_from_env():
    assert deps.LIB_DIR == _DIR, deps.LIB_DIR


def test_put_installs_files_and_index():
    _fresh()
    deps.put("mqtt_as", "aaaa", [("mqtt_as.mpy", b"MPY1")])
    assert _ls() == ["_deps.json", "mqtt_as.mpy"], _ls()
    assert _read("mqtt_as.mpy") == b"MPY1"
    assert deps.inventory() == {"mqtt_as": "aaaa"}, deps.inventory()


def test_put_replaces_and_drops_old_files():
    _fresh()
    deps.put("events", "h1", [("events.mpy", b"A"), ("old_helper.mpy", b"B")])
    deps.put("events", "h2", [("events.mpy", b"C")])
    assert _ls() == ["_deps.json", "events.mpy"], _ls()
    assert _read("events.mpy") == b"C"
    assert deps.inventory() == {"events": "h2"}


def test_put_removes_stale_other_format_copy():
    _fresh()
    deps.put("st7789py", "h1", [("st7789py.py", b"source")])
    deps.put("st7789py", "h2", [("st7789py.mpy", b"bytecode")])
    # MicroPython imports x.py before x.mpy: the old .py must go or it would shadow the new .mpy.
    assert _ls() == ["_deps.json", "st7789py.mpy"], _ls()


def test_put_leaves_no_tmp_files():
    _fresh()
    deps.put("a_lib", "h", [("a_lib.mpy", b"x"), ("a_lib_extra.mpy", b"y")])
    for name in _ls():
        assert not name.endswith(".tmp"), _ls()


def test_bad_names_rejected_before_anything_is_written():
    _fresh()
    _raises("BadName", deps.put, "../evil", "h", [("x.mpy", b"")])
    _raises("BadName", deps.put, "ok", "h", [("../x.mpy", b"")])
    _raises("BadName", deps.put, "ok", "h", [("sub/x.mpy", b"")])
    _raises("BadName", deps.put, "ok", "h", [("x.txt", b"")])
    _raises("BadName", deps.put, "ok", "h", [("runtime.mpy", b"")])  # the runtime's own module
    _raises("BadName", deps.put, "ok", "", [("x.mpy", b"")])
    _raises("BadName", deps.put, "ok", "h", [])
    assert _ls() == [], _ls()


def test_pieces_then_commit():
    _fresh()
    deps.put_chunk("mqtt_as", "mqtt_as.mpy", 0, 6, b"ABC")
    deps.put_chunk("mqtt_as", "mqtt_as.mpy", 3, 6, b"DEF")
    assert "mqtt_as.mpy" not in _ls(), "nothing under the real name before commit"
    deps.commit("mqtt_as", "h", {"mqtt_as.mpy": 6})
    assert _read("mqtt_as.mpy") == b"ABCDEF"
    assert deps.inventory() == {"mqtt_as": "h"}
    assert _ls() == ["_deps.json", "mqtt_as.mpy"], _ls()


def test_out_of_order_piece_is_refused():
    _fresh()
    deps.put_chunk("a_lib", "a_lib.mpy", 0, 6, b"ABC")
    e = _raises("BadPiece", deps.put_chunk, "a_lib", "a_lib.mpy", 4, 6, b"EF")  # byte 3 never arrived
    assert "at byte 4" in e.message and "3 bytes had arrived" in e.message, e.message
    _raises("BadPiece", deps.put_chunk, "a_lib", "a_lib.mpy", 0, 2, b"ABC")  # longer than total
    _raises("BadPiece", deps.put_chunk, "b_lib", "b_lib.mpy", 2, 6, b"xx")  # no file started


def test_incomplete_commit_is_refused_and_cleaned_up():
    _fresh()
    deps.put("a_lib", "old", [("a_lib.mpy", b"OLD")])
    deps.put_chunk("a_lib", "a_lib.mpy", 0, 6, b"NEW")
    e = _raises("Incomplete", deps.commit, "a_lib", "new", {"a_lib.mpy": 6})
    assert "3 of 6 bytes" in e.message, e.message
    assert _read("a_lib.mpy") == b"OLD", "the installed version is untouched"
    assert deps.inventory() == {"a_lib": "old"}
    assert _ls() == ["_deps.json", "a_lib.mpy"], _ls()
    _raises("Incomplete", deps.commit, "a_lib", "new", {"a_lib.mpy": 6})  # nothing arrived at all


def test_missing_reports_each_problem():
    _fresh()
    deps.put("mqtt_as", "aaaa", [("mqtt_as.mpy", b"x")])
    deps.put("bme280", "bbbb", [("bme280_float.mpy", b"x")])
    assert deps.missing({"mqtt_as": "aaaa", "bme280": "bbbb"}) == []
    problems = deps.missing({"mqtt_as": "zzzz", "ssd1306": "cccc", "bme280": "bbbb"})
    assert problems == ["mqtt_as on the board is a different version", "ssd1306 is not on the board"], problems
    os.remove(_DIR + "/bme280_float.mpy")
    problems = deps.missing({"bme280": "bbbb"})
    assert problems == ["bme280 is incomplete (bme280_float.mpy missing)"], problems


def test_remove_unused_keeps_required():
    _fresh()
    deps.put("mqtt_as", "a", [("mqtt_as.mpy", b"x")])
    deps.put("ssd1306", "b", [("ssd1306.mpy", b"x")])
    deps.put("events", "c", [("events.mpy", b"x")])
    removed = deps.remove_unused({"mqtt_as": "a"})
    assert sorted(removed) == ["events", "ssd1306"], removed
    assert _ls() == ["_deps.json", "mqtt_as.mpy"], _ls()
    assert deps.inventory() == {"mqtt_as": "a"}


def test_remove_unused_with_nothing_required_clears_all():
    _fresh()
    deps.put("mqtt_as", "a", [("mqtt_as.mpy", b"x")])
    deps.remove_unused({})
    assert _ls() == ["_deps.json"], _ls()
    assert deps.inventory() == {}


def test_remove_unused_tolerates_file_already_gone():
    _fresh()
    deps.put("mqtt_as", "a", [("mqtt_as.mpy", b"x")])
    os.remove(_DIR + "/mqtt_as.mpy")
    assert deps.remove_unused({}) == ["mqtt_as"]
    assert deps.inventory() == {}


def test_corrupt_index_means_nothing_installed():
    _fresh()
    deps.put("mqtt_as", "a", [("mqtt_as.mpy", b"x")])
    with open(_DIR + "/_deps.json", "w") as f:
        f.write("{not json")
    assert deps.inventory() == {}
    assert deps.missing({"mqtt_as": "a"}) == ["mqtt_as is not on the board"]
    # and a new put repairs it
    deps.put("mqtt_as", "a", [("mqtt_as.mpy", b"x")])
    assert deps.inventory() == {"mqtt_as": "a"}


def test_index_with_wrong_shapes_is_filtered():
    _fresh()
    os.mkdir(_DIR)
    with open(_DIR + "/_deps.json", "w") as f:
        f.write('{"good": {"hash": "h", "files": ["good.mpy"]}, "bad1": 5, "bad2": {"hash": 3, "files": []}}')
    assert deps.inventory() == {"good": "h"}, deps.inventory()


def test_forget_modules_drops_dependency_modules_only():
    _fresh()
    deps.put("fake_dep", "h", [("fake_dep_mod.py", b"VALUE = 1\n")])
    deps.ensure_on_path()
    import fake_dep_mod  # noqa: F401

    assert "fake_dep_mod" in sys.modules
    assert "deps" in sys.modules
    deps.forget_modules()
    assert "fake_dep_mod" not in sys.modules
    assert "deps" in sys.modules
    deps.put("fake_dep", "h2", [("fake_dep_mod.py", b"VALUE = 2\n")])
    import fake_dep_mod as again

    assert again.VALUE == 2, again.VALUE


def test_ensure_on_path_once():
    deps.ensure_on_path()
    deps.ensure_on_path()
    assert sys.path.count(_DIR) == 1, sys.path


def test_index_entry_with_no_files_reads_as_installed():
    """A custom firmware image freezes libraries into flash and ships an index entry for each with no
    files (2026-10-22, firmware/classic-esp32/gen_deps_index.mjs): the bytes are frozen code, not
    files on the filesystem. That must read as installed -- a Deploy that looks for the files and
    calls the install incomplete would refuse every flow on such an image."""
    _fresh()
    deps._ensure_dir()
    deps._write_index({"mqtt_as": {"hash": "h", "files": []}})
    assert deps.missing({"mqtt_as": "h"}) == [], deps.missing({"mqtt_as": "h"})
    assert deps.inventory() == {"mqtt_as": "h"}
    # The same entry at a different hash is still missing: an editor that compiled differently gets
    # to push its own copy, which then wins on the path.
    assert deps.missing({"mqtt_as": "other"}) != []


def test_remove_unused_keeps_frozen_entries():
    """remove_unused is about files. A frozen library has none, and dropping its entry would make the
    next Deploy push a copy into /lib over the frozen one (found on hardware, 2026-10-22: the first
    GUI deploy pruned 20 frozen libraries out of the index)."""
    _fresh()
    deps._ensure_dir()
    deps._write_index({
        "mqtt_as": {"hash": "a", "files": []},
        "events": {"hash": "b", "files": ["events.mpy"]},
    })
    with open(_DIR + "/events.mpy", "wb") as f:
        f.write(b"x")
    removed = deps.remove_unused({})
    assert removed == ["events"], removed
    assert deps.inventory() == {"mqtt_as": "a"}, deps.inventory()


def test_lib_dir_beats_ahead_of_path_entries():
    """A custom firmware image freezes libraries ahead of /lib on sys.path (2026-10-22). A pushed
    copy must still win, or a library update through Deploy silently does nothing."""
    _fresh()
    shadow = "/tmp/ts_deps_test_shadow"
    try:
        os.mkdir(shadow)
    except OSError:
        pass
    with open(shadow + "/shadowed_mod.py", "w") as f:
        f.write("VALUE = 'frozen'\n")
    deps.put("shadowed", "h", [("shadowed_mod.py", b"VALUE = 'pushed'\n")])

    sys.path.insert(0, shadow)  # the image's order: something frozen/first wins today
    deps.ensure_on_path()
    import shadowed_mod

    assert shadowed_mod.VALUE == "pushed", shadowed_mod.VALUE
    assert sys.path[0] == _DIR, sys.path
    sys.path.remove(shadow)


minitest.run(
    [
        test_lib_dir_comes_from_env,
        test_put_installs_files_and_index,
        test_put_replaces_and_drops_old_files,
        test_put_removes_stale_other_format_copy,
        test_put_leaves_no_tmp_files,
        test_bad_names_rejected_before_anything_is_written,
        test_pieces_then_commit,
        test_out_of_order_piece_is_refused,
        test_incomplete_commit_is_refused_and_cleaned_up,
        test_missing_reports_each_problem,
        test_remove_unused_keeps_required,
        test_remove_unused_with_nothing_required_clears_all,
        test_remove_unused_tolerates_file_already_gone,
        test_corrupt_index_means_nothing_installed,
        test_index_with_wrong_shapes_is_filtered,
        test_forget_modules_drops_dependency_modules_only,
        test_ensure_on_path_once,
        test_lib_dir_beats_ahead_of_path_entries,
        test_index_entry_with_no_files_reads_as_installed,
        test_remove_unused_keeps_frozen_entries,
    ]
)
