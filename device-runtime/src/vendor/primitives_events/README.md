# Vendored: `ESwitch`/`EButton` (`primitives.events`) and `Delay_ms`

Source: [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async),
`v3/primitives/events.py` and `v3/primitives/delay_ms.py` on the `master`
branch. License: MIT (confirmed via each file's own header comment and the
repo's root `LICENSE` file, both fetched and read directly).

Fetched 2026-09-17, for `editor/src/node-library/eswitch.ts`/`ebutton.ts`
(`outstanding-items.md`'s "[P4] eswitch/ebutton nodes" item, 2026-09-08).
Pin reference, per-file exact commit SHA (last commit to actually touch that
path, via a real clone's own `git log -- <path>`, not just `master` HEAD at
fetch time -- same tightened-pin standard `threadsafe_event/README.md` set):

- `events.py`: commit `0fb2f22d1b130d63be2ec4d66958c4f6eb8106b3` (2024-05-09,
  "Docs and code: Remove all references to uasyncio.")
- `delay_ms.py`: commit `74e4dbcece1baa51e0e1df48cb474bcf304373c5`
  (2025-11-20, "All: Purge code references to u libraries.")

SHA-256, upstream files exactly as fetched (before the local patches below):

- `events.py`: `63ad5b78347b8e6199fa5bb1e9bd4e2dee0d2d0be6af462f3471e68b0a518c91`
- `delay_ms.py`: `f2d2811035075bc8c750324c0cf5c2cb71e5e8bd7bad722888d8dae890208a25`

SHA-256, as committed here (after the local patches below):

- `events.py`: `6d273933d065c30449a34cb65fce65fb4c170c7b5b48f4c43f70a1c46036ffac`
- `delay_ms.py`: `48e4cf6cbb9305555eb5f06dbe12ef635731c5185a954d82bbfcd6b2023103a8`

Verification note, an improvement on the prior two vendorings' own honesty
caveats (both fetched via a web-fetch tool with no way to diff against a
second independent download): this session had normal outbound shell
network access, so the upstream files were fetched twice independently --
once via a raw-file download, once via a full `git clone` of the upstream
repo -- and `diff`ed byte-for-byte identical before any local patch was
applied. The two SHA-256 sets above are the actual before/after of the
patches, not a re-derivation from memory.

## Why vendored rather than hand-rolled

Design doc §11 names this exact question ("whether to adopt Peter Hinch's
`micropython-async` -- hardware driver primitives (switches/buttons/ADC/
encoders) ... Not evaluated yet") as an open question. This vendoring
resolves it for switches/buttons specifically (`docs/working-notes/
decisions.md`, 2026-09-17) -- ADC/encoders stay open, tracked as a
follow-up in `outstanding-items.md`.

`ESwitch`/`EButton` cover exactly the debounce-plus-multi-event surface the
`eswitch`/`ebutton` outstanding item asks for: a poll-based debounce loop, a
long-press timer, and double-click detection with the timing edge cases
that come with it (a press arriving mid-double-click-window, a long press
racing a double click) already reasoned through and worth not re-deriving,
matching this project's existing "prefer a maintained implementation over
re-deriving subtle concurrency logic" standard (`threadsafe_event/
README.md`'s own justification). `interrupt.ts`'s hand-rolled debounce
(ignore-transitions-within-N-ms) only ever had to solve the single-edge
case; `EButton` additionally needs to disambiguate a double-click from two
independent single presses and a long-press from a click, genuinely more
state-machine surface than that node's own cooldown check.

## Why `Delay_ms` too, and not just `events.py`

`EButton` constructs two `Delay_ms` instances (`_ltim`/`_dtim`, for the long-
press and double-click timers) -- a real dependency, not an incidental one,
so it's vendored alongside `events.py` rather than reimplemented. `ESwitch`
doesn't use it at all; it's pulled in only because `EButton` needs it.

## Local patches

Two, both import-only, needed because this project's vendor files land flat
on the device filesystem (`test-flows/deploy_runtime.py`'s `VENDOR_FILES`
push mechanism -- see that file's own comment on why `mqtt_as/__init__.py`
gets renamed to `mqtt_as.py` for the same flat-namespace reason), not as a
`primitives` package with its lazy `__getattr__` loader
(`v3/primitives/__init__.py`) mediating cross-file imports:

1. **`events.py`**: `from . import Delay_ms` → `from delay_ms import Delay_ms`
   (flat import -- `delay_ms.py` sits alongside `events.py` in this same
   vendor directory and lands alongside it on-device too).
2. **`events.py`**: `from . import RingbufQueue` deleted outright. Read the
   whole file before vendoring (222 lines) to confirm: `RingbufQueue` is
   never referenced anywhere else in it -- an unused import in the upstream
   file itself, not something this project's usage happens not to need.
   Keeping it would have pulled in `ringbuf_queue.py` (and, transitively,
   whatever *it* imports) for a name nothing in the vendored file, or in
   Thingstudio's own node codegen, ever touches.
3. **`delay_ms.py`**: `from . import launch` → the 5-line `launch()`
   function (and its `_g`/`type_coro` helpers) inlined verbatim from
   upstream's `v3/primitives/__init__.py`, rather than vendoring that whole
   file. Traced the actual call path before doing this: `EButton` only ever
   constructs `Delay_ms(duration=...)` (no `func=`), so `_timer()`'s
   `if self._func is not None: launch(...)` branch is dead code for every
   node this project builds on top of `Delay_ms` -- but `_timer()` still
   references the name unconditionally, so the import must resolve, or a
   deploy that never triggers a long-press timer at all would already have
   failed to boot with a `NameError`/`ImportError` the first time any
   `EButton` timer actually fired.

No other changes. Everything else -- including `WaitAll`/`ELO`/`ELO_x` in
`events.py`, unused by this project's nodes today -- is vendored exactly as
upstream wrote it; per this project's own established vendoring convention
(`mqtt_as/README.md`'s "What's NOT vendored" is about leaving out whole
*files* that are genuinely never imported, not about trimming *within* a
file that is vendored), don't cherry-pick classes out of a file that's
otherwise unmodified.

## A real, structural limitation of the upstream class itself, worth
knowing before debugging a flow that has more than one `ebutton` node

`EButton.long_press_ms`/`double_click_ms`/`debounce_ms` are **class**
attributes, read via the class name (`EButton.long_press_ms`, not
`self.long_press_ms`) exactly once, inside `__init__`, to size that
instance's own `Delay_ms` timers and debounce-poll interval. There is no
per-instance constructor argument for any of the three. `editor/src/
node-library/ebutton.ts`'s codegen works around this correctly, not by
accident: it sets `EButton.long_press_ms`/`double_click_ms` immediately
before constructing each `EButton()` instance, in flow-declaration order,
so each instance's own `Delay_ms` timers bake in *that* instance's
configured values at construction time before the next `ebutton` node's
setup code changes the class attribute again for the next instance. This
is correct because `__init__` never re-reads the class attribute after
construction -- but it's exactly the kind of ordering-dependent codegen
that's easy to break by accident in a future refactor (e.g. reordering
setup statements, or ever changing any `ebutton` instance's config *after*
construction expecting it to take effect). See `ebutton.ts`'s own header
for the codegen side of this; this note exists so the constraint is legible
from the vendored code's own directory too, not only from the one file that
currently depends on it.

`debounce_ms` has no such workaround needed for a single-value default (all
`ebutton`/`eswitch` nodes in a flow share Thingstudio's own fixed 50ms
default unless a future change adds a per-node property for it, at which
point the same construction-order technique applies).
