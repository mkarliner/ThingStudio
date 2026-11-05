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
