# A board recipe cannot write the files a custom image needs

Status: open, found 2026-10-25 while writing the user docs for **Tools → Install firmware…**.

## The problem

The `firmware` block flashes one image. Thingstudio's own classic-ESP32 image is not self-sufficient: it holds
the runtime and every library frozen, but a frozen module cannot be the boot script, so
`firmware/classic-esp32/install.sh` also writes two files over `mpremote`:

- `/main.py` — the three-line boot script (`import listener; listener.main()`)
- `/lib/_deps.json` — the library inventory, so Deploy skips what is already frozen

A board flashed with the image alone boots to the REPL and never sends `HELLO`. So the CYD's recipe, as written
(`runtime: "none"`, image only), would have produced a board that looks like a failed flash. The CYD's
`firmware` block was removed on 2026-10-25 rather than left as a trap; the editor now offers it **Choose a
file…** with the stock MicroPython image and the normal runtime install.

`runtime: "install"` is not the answer for this image: it would push the runtime to the filesystem, so the board
would run the filesystem listener and give up exactly the memory the frozen image exists to save.

## The shape of the fix

The block needs a post-flash file step, as data:

```json
"firmware": {
  "tool": "esptool",
  "transport": "serial",
  "image": { "url": "…", "sha256": "…" },
  "runtime": "none",
  "flash": { "chip": "esp32", "baud": 460800, "offset": 0 },
  "files": [
    { "url": "…/main.py", "sha256": "…", "to": "/main.py" },
    { "url": "…/_deps.json", "sha256": "…", "to": "/lib/_deps.json" }
  ]
}
```

- Backend: after a successful flash, download and verify each file (same cache), open the serial port at the
  REPL, and write them. The existing raw-REPL path (`raw_repl.py` / `runtime_installer.py`) already does this
  for the runtime install; this is the same mechanism with a file list from the board.
- Job: a third step, `files`, so the dialog's progress line says which one failed.
- Editor: nothing beyond showing that step.
- Board data: the CYD gets the block back with its two files pinned from the same release as the image.

`files` is an interface change (the board-descriptor schema and SPEC), so it needs Mike's explicit OK.

## Before re-adding the CYD recipe

- The release publishes `main.py` and `_deps.json` next to the image (`publish.sh` verifies all four assets),
  so pin their URLs and sha256 from the same tag as the image.
- The board re-enumerates after a flash on some USB-serial bridges; the file step must open the port it is
  given and refuse once if it never appears — no retry chain.
- Then the hardware pass: blank CYD, one click, and the board sends `HELLO` with the runtime version.
