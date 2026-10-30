# Pin/resource-conflict detection — never built
> **2026-10-30 sweep:** Compile-time conflict detection is built and tested (`compile.ts` + `hardware-shared.ts`,
  `resource-check.test.ts`; resolved 2026-10-12). Already closed in `outstanding-
  items/resolved.md`. Banner added 2026-10-30 sweep.


Two nodes claiming the same physical pin in different modes get two independently-correct but conflicting `Pin` objects instead of a compile-time error. Confirmed still open as of the 2026-08-14 GPIO/timer batch. Single-flow-only gap, not just the deferred multi-flow version.
