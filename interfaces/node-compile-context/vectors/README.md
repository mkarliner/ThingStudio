# Compile-context conformance vectors

Each `*.json` file is one hook + context + expected outcome, run by
`editor/test/compile-context-vectors.test.ts` against the real vendored MicroPython WASI interpreter. They are the
executable half of `../SPEC.md`; the prose is the contract.

```json
{
  "name": "worked-example",
  "hook": "def compile(ctx, properties):\n    ...",
  "context": { "version": 1, "node": {...}, "flow": {...}, "nodesOfType": [...], "referencedConfigs": {}, "target": null },
  "properties": {},
  "expect": { "properties": {...}, "warnings": [...] }
}
```

`expect` is one of:

| Key | Meaning |
|---|---|
| `properties` / `claims` / `warnings` | the validated result; each compared exactly |
| `errors` | the hook returned these `errors`; the runner must refuse the compile with them |
| `validation_error` | the raw result fails `validateCompileHookResult`, matching this substring |
| `raised` | the hook raised; `runHookOnce` rejects matching this substring |

`timeout.json` is the containment case. The WASI runner has no timeout by design (the editor's worker terminates a
runaway hook), so it is exercised by `editor/test/compile-hook-runner.test.ts` (fake worker, real budget) and by
`tools/compile_hook_smoke.py`'s `runaway` case in a real browser.
