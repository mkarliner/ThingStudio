# The deploy link, the 5 KB pieces, and the image's first numbers — briefing

Written 2026-10-23, end of session. Topic: 12.0.0's 5 KB deploy pieces failed on real hardware for a reason that
had nothing to do with memory — the board's serial input buffer — and the custom image went from "boots" to "installs
and deploys repeatedly". Scope and history: `classic-esp32-image-hardware-session-briefing.md`,
`decisions/classic-esp32-firmware.md`. Rule this session strengthened: `AGENTS.md`, "fail well, not work badly".

## Where the work stands, in one paragraph

The custom classic-ESP32 image is **installed, documented and deploying**: the hero GUI flow deploys three times in
a row over a running GUI flow on a CYD, where stock MicroPython cannot start it at all. The 12.0.0 deploy that
shipped yesterday's decisions failed on hardware at the third piece — not for memory, but because the esp32 port
keeps a 260-byte REPL input buffer and a display refresh blocks the VM longer than 22 ms, so bytes were silently
dropped mid-line. The image now patches that buffer to 8 KB, the listener reports a garbled line instead of going
quiet, and the user-facing page exists with measured memory figures. What is left is shipping: a release to download
the image from, and a CI build that proves the patch applies in the container.

## Done and verified on hardware

- **12.0.0 shipped the rules, then met the board.** 5 KB pieces, no automatic recovery, a warn-don't-refuse memory
  line, the power-cycle recipe, and "fail well, not work badly" spelled out in `AGENTS.md` (five points: no
  automatic recovery in a user action; warn on a prediction, refuse on a fact; three things in every failure line;
  honest size over safe size; a retransmit is not a repair).
- **5 KB pieces met the link, not the heap.** `ports/esp32/mphalport.c` hardcodes `stdin_ringbuf_array[260]` (rp2
  has a macro; esp32 does not). At 115200 that is 22 ms; a full-frame SPI draw is ~30 ms; `ringbuf_put()` drops
  bytes silently. Third deploy: `MessageDecodeError('unsupported CBOR additional-info value 29 ...')` twice, then
  the editor gave up. 101 KB free at the time — memory was never the problem.
- **The fix is in the image**: `firmware/classic-esp32/patches/0001-esp32-stdin-ringbuf-8192.patch`, applied
  idempotently by `build.sh` (fatal if it stops applying), 8 KB of static RAM for ~690 ms of tolerance. Recorded in
  the third-party ledger as a patch, not a vendored copy.
- **Silence became a message** (runtime 12.1.0): an unreadable line answers `FLOW_ACK{ok:false, code:"Garbled"}` for
  the offset the board has stored, so the editor resends at once and reports the real problem. No new recovery.
- **Installer runs on a Mac**: esptool 3.x spellings (`no_reset`, `erase_region`), `shasum` fallback, `esptool.py`
  or `esptool`, and the reset uses `esptool run` instead of pyserial in the system Python (pipx installs mpremote's
  pyserial into its own venv). Clean install verified by Mike on macOS.
- **Three consecutive deploys over a running GUI flow**, no garbled pieces, on the 12.1.0 image.
- **Numbers measured** (KB, MicroPython free/block then ESP-IDF free/block): idle 142/105 and 129/108; GUI flow
  running 108/50 and 70/52; after two more deploys 120/27 and 18/14. Repeated deploys fragment the MicroPython heap
  and take the chip heap permanently until a reset — at 18 KB IDF, WiFi may not start.
- **User docs**: `docs/user-guide/custom-firmware.md` (standalone, linked from Boards and from the GUI node page),
  plus the power-cycle recipe in `debugging.md` and two FAQ entries.

## Open, and what the next session should pick up

1. **Attach the image to the v0.4.0 draft release by hand.** The firmware page tells people to download the image,
   `_deps.json` and `main.py` from releases; the Release run made a draft, the image still has to go on it. Use the
   binary that was tested: `out/thingstudio-classic-esp32-12.1.0-8e2f87d.bin` (sha256 `f931ca3f…7151cead0`), built
   from `8e2f87d` -- earlier than the tag, so its build stamp differs from the release commit while the code is the
   same.
2. **Build path: local, by decision (Mike, 2026-10-23).** `firmware.yml` is not the build path and no longer
   triggers on tags; it has never completed a build (submodules need `idf.py` from the container, and the container
   has no node for the index). `decisions/classic-esp32-firmware.md` records it and when to revisit.
3. **The stop-first sequence** (`outstanding-items.md`): still settled as "stop the flow first", still unbuilt, and
   now only needed for boards *without* the image — on the image a deploy over a running flow works.
4. **Release of the 8 KB buffer?** Worth offering upstream (rp2 has the macro; esp32 hardcodes the array). Not
   required for us.
5. **The five-cycle curve, if anyone wants it**: I got to three deploys before the port wedged; four to six would
   show where it actually fails. The page does not need it.

## Environment left behind (agent VM)

- `agent` is now in **`dialout`** (Mike ran `usermod -aG dialout agent`), so `/dev/ttyUSB0` can be opened from the
  agent shell with `sg dialout -c '...'`.
- `/dev/ttyUSB0` gives `EIO` after the last close (CH340 through VMware; the powered hub has not arrived). An
  unplug/replug clears it. Do not probe the port by opening and closing it — that is what wedges it.
- Image artifacts (gitignored): `firmware/classic-esp32/out/thingstudio-classic-esp32-12.1.0-8e2f87d.bin`, plus
  `.sha256` and `_deps.json`.
- Hand-off of the image to the Mac was over a temporary `python3 -m http.server 8043` on the VM's LAN address
  (`192.168.10.165`), now stopped. There is no shared mount between the VM and Mike's Mac.
- Measurement scripts, not committed: `/tmp/opencode/numbers.py`, `more.py` (serial protocol driver: HELLO, EXEC,
  FLOW_PUT/COMMIT, block bisect). Worth keeping for the next hardware pass.

## Commits this session (in order)

`ac6b9e8` 12.0.0: no repairs, 5 KB pieces, power cycle, warn not refuse · `942e629` install.sh on esptool 3.x and
macOS · `b8cb286` use `esptool.py` when that is the name · `8e2f87d` 12.1.0 + image patch: Garbled answer and the
8 KB buffer · `27a6666` reset with `esptool run`, not pyserial · `77abd76` three deploys on hardware · `dc9e93a`
the firmware page · `4eaabd0` the S0/S4/S5 numbers.

## Questions for Mike

- Tag a release now (the workflow builds and drafts it), or upload the 12.1.0 artifacts by hand?
- After the release: does the image stay optional, as decided, or does "works on the CYD, unlike stock" change that?
