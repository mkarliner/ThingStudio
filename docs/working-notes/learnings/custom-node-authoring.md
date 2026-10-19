# Learnings — Custom node authoring

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **A custom node's top-level `.node.py` code runs inside a generated
  per-instance wrapper function, not at true module scope — `nonlocal`,
  not `global`, is the correct idiom for persistent state.** First-party
  node codegen (e.g. `timer.ts`) inlines its code directly at true
  module/coroutine scope, where `global` is correct; a custom-node author
  following that same familiar pattern would hit a `NameError` at deploy
  time instead, since no module-level name exists inside the wrapper.
  Self-caught while writing `custom-node.test.ts`'s closure-isolation
  test, not by a real deploy failure — documented prominently in
  `custom-node.ts`'s header comment and in `docs/user-guide/custom-nodes.md` (its own
  dedicated section) given the project's fault-handling-first priority.
  `custom-node-authoring-scoping.md`.

- **`@micropython.viper` inside a custom node: works, but can't read the wrapper's variables.** 2026-10-16,
  the RM68090 node. A viper function defined in `.node.py` compiles (mpy-cross `-march=xtensawin`) and runs as a
  nested function of the per-instance wrapper, but viper code can't read enclosing variables (no closures), so
  every value goes in as an argument or a literal: the node's GPIO register addresses are literals inside its
  viper functions. `const()` likewise only optimises at true module scope; plain names in the wrapper.
- **MicroPython has no PEP 448 dict unpacking — `{**a, **b}` fails at mpy-cross, though CPython runs it.** 2026-10-19,
  the compile-hook property merge. The generated package setup used `{**declared, **hookProperties}` to override
  fields; every pymock test (CPython) passed and the flow compiled in the CLI with `--no-syntax`. Compiling a
  generated hardware-pass flow with mpy-cross rejected it: `SyntaxError` on that line. MicroPython supports
  `dict.update()` but not multiple unpacking in a display. Fixed in `custom-node.ts` by emitting
  `_props = {...}` then `_props.update({...})`. The general lesson: pymock runs CPython, so a syntax or stdlib
  feature MicroPython lacks only surfaces through mpy-cross or a board. The hardware-pass script's flows go
  through the CLI's real syntax check for this reason.
