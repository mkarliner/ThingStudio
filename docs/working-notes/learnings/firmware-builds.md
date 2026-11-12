# Learnings — Building the custom firmware images

Status: detail file, started 2026-11-04. See `learnings.md` for the index.

- **2026-11-05 — Mike's Linux session VM is a build host, unlike the cloud container:** `micropython.org`,
  `dl.espressif.com`, `components.espressif.com` and GitHub are all reachable, the repo is a native checkout (git
  writes are safe), and the toolchain persists (`~/esp/esp-idf-5.5.2/`, `~/micropython-1.29.0/`, 4 cores, ~26 GB).
- **2026-11-05 — A Linux build host needs `cmake` and `ninja`, and `sudo` may not be available.** The brief's
  `brew install cmake ninja dfu-util` is the Mac recipe; on the VM `cmake` was missing (`make submodules` failed
  with "`cmake` must be available on the PATH to use idf.py") and `sudo` wanted a password. Both install as wheels
  into the IDF Python env, which `export.sh` puts on the PATH, so nothing else is needed:
  `~/.espressif/python_env/idf5.5_py3.13_env/bin/pip install cmake ninja`. Entry point: every new shell is
  `. ~/esp/esp-idf-5.5.2/export.sh && cd ~/Src/ThingStudio`-shaped, with the VM's path here.
  Builds here need no registry stand-ins — the `override_path` recipe below applies only on a blocked network — and
  `build.sh` still refuses a checkout at any other tag. Decision: `decisions/custom-firmware.md` 2026-11-05.
- **2026-11-04 — A cloud session can build every target's image**, despite the BLE briefing's "this cloud session
  can't install ESP-IDF". ESP-IDF v5.5.2 (`git clone --depth 1 --branch v5.5.2 --recursive --shallow-submodules`)
  and its toolchains come from GitHub; only two things are blocked: `dl.espressif.com` (the Python constraints file:
  `IDF_PYTHON_CHECK_CONSTRAINTS=no python3 tools/idf_tools.py install-python-env`) and `components.espressif.com`
  (the component registry). For the registry, the MicroPython checkout's `ports/esp32/main/idf_component.yml` gets
  `override_path` entries pointing at GitHub clones of the locked versions: `espressif/esp-protocols` tag
  `mdns-v1.3.2` (`components/mdns`) and `espressif/esp-eth-drivers` tag `lan867x@v1.0.3` (`lan867x`, classic only).
  `make submodules` also contacts the registry, so init `lib/berkeley-db-1.xx` and `lib/micropython-lib` with git
  instead. An image built that way is a check that the target builds, not a release image: the component sources
  differ from the registry's archives and the tree is patched, so it is named `-dirty` and never recorded.
- **2026-11-04 — Image sizes at runtime 15.0.0** (MicroPython v1.29.0, ESP-IDF v5.5.2, everything frozen): classic
  ESP32 1.75 MB, ESP32-C3 1.85 MB, ESP32-C5 2.06 MB (app 2.0 MB). All fit the 3 MB single app slot; none would fit
  MicroPython's 1.5 MB dual-OTA slot, which is the 2026-10-22 partition decision measured.
- **2026-11-04 — NimBLE allows 4 connections** on every ESP32 MicroPython build: the port's `boards/sdkconfig.ble`
  sets `CONFIG_BT_NIMBLE_MAX_CONNECTIONS=4`, stock and custom images alike. That is the per-board connection limit
  the BLE briefing's open item 3 asked for (central peers plus centrals connected to the GATT server).
- **2026-11-04 — macOS's default `esptool.py` (3.x) has no `esp32c5`.** `install.sh` now checks the chip with
  `esptool --chip <chip> version` before touching the port; esptool 5.x (what the backend bundles) knows every
  target.
- **2026-11-06 — The ESP32-C5-340X stays in the bootloader after flashing.** Its CH340E has no auto-reset wiring,
  so `esptool run` cannot restart it and `install.sh`'s `mpremote` step failed with `could not enter raw repl`
  (Mike's first C5 install). The image was written; RESET by hand, then copying `main.py`, finished it.
  `install.sh` now stops there with those steps instead of a traceback.
- **2026-11-06 — v0.12.0 shipped without its own images in the dialog.** The editor reads the `builds.json` it was
  installed with, and the 15.0.0 entries were committed after the tag (`f3f957a`), so an installed 0.12.0 offered
  only the classic 14.x images its runtime refuses. Release URLs are known before the release exists, so
  `firmware/README.md` "Publishing" now runs `firmware_catalogue.py --image` before the tag; v0.12.1 carries the
  entries.
- **2026-11-13 — A stale `/lib` copy silently shadows a custom image's frozen library.** The S3 on image
  `8790056` served the pre-`7e143d8a` remote page and lacked the reconnect fix; the last session concluded the
  flash had never taken. It had: a deploy from a checkout older than the image found the board's `ts_remote` hash
  different from its own and pushed its older copy into `/lib`, which is ahead of `.frozen` on `sys.path`
  (runtime 11.1.0, deliberate). Nothing said so: HELLO reports one hash per library (the `/lib` one), the page
  looked like "old image", and the board password, set again at each USB bring-up, looked as if it had survived a
  flash. How to tell: compare the HELLO hash with `deps_frozen.INVENTORY` on the board, or grep the `.bin` for the
  hash (the inventory is frozen in as strings). Fix: delete `/lib/<name>` and rewrite `/lib/_deps.json` from
  `deps_frozen.INVENTORY` (write with `with open(...)`: an unclosed MicroPython file is empty until closed), then
  restart. Prevent: deploy only from a checkout at or after the image's commit, CLI bundle rebuilt. Open design
  question for Mike: should a deploy refuse or warn when it would push an older library over a frozen one?
