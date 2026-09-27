/* SPDX-License-Identifier: Apache-2.0
 * packaging/macos/thingstudio-python.c
 *
 * The macOS bundle's Python executable: CPython's own main (Py_BytesMain), linked by tools/make_bundle.py
 * with Info.plist (NSLocalNetworkUsageDescription) embedded in its __TEXT,__info_plist section and signed
 * as org.thingstudio.backend, so macOS can ask the user for Local Network access for "Thingstudio".
 *
 * That alone isn't enough (found 2026-09-27 on Mike's Mac): a process started from a terminal app is
 * attributed to that app -- its "responsible process" -- and macOS decides Local Network access for iTerm,
 * never showing a prompt or a Thingstudio entry, and refusing connections ("No route to host"). So on start
 * this program replaces itself (POSIX_SPAWN_SETEXEC: same process, same pid, so Ctrl-C and exit codes are
 * unchanged) with a copy of itself spawned with responsibility disclaimed, making it its own responsible
 * process: the approach terminal apps use for their shells and Qt Creator's `disclaim` helper uses for
 * programs it runs. responsibility_spawnattrs_setdisclaim is a private libSystem call, looked up with dlsym;
 * if it's missing or the re-exec fails, this falls back to running as before, with a note on stderr.
 * THINGSTUDIO_NO_DISCLAIM=1 skips it (for diagnosis).
 */
#include <Python.h>

#ifdef __APPLE__
#include <dlfcn.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdlib.h>
#include <string.h>

extern char **environ;

typedef int (*disclaim_fn)(posix_spawnattr_t *attrs, int disclaim);

#define DISCLAIMED_MARK "THINGSTUDIO_DISCLAIMED"

static void become_responsible(char **argv) {
    if (getenv(DISCLAIMED_MARK) != NULL) { /* this is the re-exec'd copy: done */
        unsetenv(DISCLAIMED_MARK);
        return;
    }
    if (getenv("THINGSTUDIO_NO_DISCLAIM") != NULL) return;
    disclaim_fn disclaim = (disclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    if (disclaim == NULL) {
        fprintf(stderr, "thingstudio: this macOS has no responsibility_spawnattrs_setdisclaim; local network "
                        "access will be decided for the app that started Thingstudio\n");
        return;
    }
    char path[PATH_MAX];
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) != 0) return;
    posix_spawnattr_t attr;
    if (posix_spawnattr_init(&attr) != 0) return;
    int rc = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETEXEC);
    if (rc == 0) rc = disclaim(&attr, 1);
    if (rc == 0) {
        setenv(DISCLAIMED_MARK, "1", 1);
        rc = posix_spawn(NULL, path, NULL, &attr, argv, environ); /* returns only on failure */
        unsetenv(DISCLAIMED_MARK);
    }
    posix_spawnattr_destroy(&attr);
    fprintf(stderr, "thingstudio: couldn't take responsibility for local network access (%s); it will be "
                    "decided for the app that started Thingstudio\n", strerror(rc));
}
#endif

int main(int argc, char **argv) {
#ifdef __APPLE__
    become_responsible(argv);
#endif
    return Py_BytesMain(argc, argv);
}
