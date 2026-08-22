# Pin/resource-conflict detection — never built

Two nodes claiming the same physical pin in different modes get two independently-correct but conflicting `Pin` objects instead of a compile-time error. Confirmed still open as of the 2026-08-14 GPIO/timer batch. Single-flow-only gap, not just the deferred multi-flow version.
