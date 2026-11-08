# Full editor both online and fully offline (proposed 2026-11-08)

Status: proposed, not scoped; timing open. Split on 2026-11-08 (Mike) from the quick online demo, which has its
own item: `online-editor-demo.md`. This item is the full product in both forms: the same editor hosted on
thingstudio.net and installed locally, each able to do everything. Mike thinks that pairing is fairly unique.
Raised from the ThingStudioMarketing repo (`marketing-plan.md`, sections 7 and 14), after an outside review
said the drop-off is download, trust a binary, plug in a board.

## The idea

Publish the editor as a static page on thingstudio.net, using the frozen direct (WebSerial) transport. People
could open the editor, load an example, compile it and see the generated MicroPython with no download. In
Chrome or Edge on a desktop they could also deploy to a board. The local install stays as it is.

Mike, 2026-11-08: the web version should be current, since only the transport differs. Browser limits are
acceptable if the call to action states them. Credentials and similar settings could live in the browser's
local storage, so an online and a fully local version can both exist. The "local only" message gets adjusted
to match.

## What a read of the working notes found (2026-11-08, not checked against code)

The compile is already client-side (mpy-cross and the MicroPython WASI interpreter run as WASM), so the
no-hardware path looks cheap. Several features are backend-only today, though, so "only the transport
differs" holds for deploy but not for everything a newcomer meets:

- **Runtime install** is backend-only (raw REPL in `raw_repl.py`; `decisions/runtime-install-from-editor.md`,
  2026-09-22: "web serial is deprecated").
- **Firmware flashing** is backend-only by decision (`esptool` subprocess; "no browser flasher, no new npm
  dependency"; `decisions/editor-firmware-flashing.md`). The marketing plan's "about 15 minutes" for testers
  rests on this.
- **Credential store**: direct mode has no externally stored credentials (`credential-storage-design.md`).
- **Custom node packages** load from `~/.thingstudio` through the backend.
- **Flow save/open** uses the File System Access API, which is Chrome/Edge only. Same browsers as WebSerial,
  so no new limit.
- **Direct transport freshness**: frozen since 2026-08/09, hidden 2026-09-23. Serial fixes since then (for
  example the classic ESP32 serial link and the 2026-11-07 serial mangling work) may have gone into the
  backend path only.

## Possible slices, smallest first (for Mike to pick, not a plan)

The no-board slice is now the separate demo item.

1. Deploy over WebSerial to a board that already has MicroPython and the runtime.
2. Plus runtime install over WebSerial (a browser port of the raw-REPL install).
3. Plus flashing a blank board in the browser (reverses part of the flashing decision).

## Open questions

- When, relative to launch?
- Does the online version keep feature parity with the local one, or carry a stated subset?
- Does the hosted page make any request beyond its own assets and GoatCounter? Needed before the landing page
  says what is and isn't sent anywhere.
- `ambiguous-browser-only-claim.md` may be closed by whatever is decided here.
