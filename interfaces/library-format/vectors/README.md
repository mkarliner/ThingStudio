# Library-format conformance vectors

Each case in `libraries.json` is a `.thingstudio` folder tree and the catalog it must produce. They are the
executable half of `../SPEC.md`; the prose is the contract. Bundle-layout cases live in
`../../node-descriptor/vectors/bundles.json` and use the same format.

```json
{
  "name": "module-requires-builtin",
  "tree": { "libraries/sensors.py": "import ts_mqtt\nimport machine\n" },
  "expect": {
    "libraries": [{ "name": "sensors", "files": [["sensors.py", "sensors.py"]], "requires": ["ts_mqtt"], "origin": "libraries" }],
    "refused": []
  }
}
```

- **`tree`** maps paths relative to the `.thingstudio` folder to file contents. Missing folders are created.
- **Built-ins** come from the real `runtime_manifest.py`. Cases use only `ts_mqtt`, `mqtt_as` and `ts_wifi`, which
  are stable.
- **Tokens** in a file's contents stand for a minimal valid file the test generates:
  - `@node:source`, `@node:sink`, `@node:transform`: a valid `.node.json` of that kind, `type` `custom/<file stem>`.
  - `@py:source`, `@py:sink`, `@py:transform`: a valid `.node.py` for that kind.
- **`expect.libraries`**: the user entries in the merged catalog, in catalog order, compared exactly (`requires`
  sorted). Built-in entries are not listed.
- **`expect.refused`**: `{library, origin, contains}`; the console line for that library must contain `contains`.
  The order is not significant.
- **`expect.skippedBundles`** (bundle cases): `{bundle, contains}`, likewise.
- **`expect.packages`** (bundle cases): the custom node package names loaded, in load order.
- **`checkedBy: "editor"`** on a case: the refusal comes from the editor's `mpy-cross` check at deploy, so the backend
  test skips it (an editor test for it is still to add, `../SPEC.md` §9).
