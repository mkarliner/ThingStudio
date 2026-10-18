# Node compile context — v1 specification (draft)

Status: **draft, 2026-10-18, pending Mike's review.** This defines the compile-time half a package may have: the
optional `<name>.compile.py` hook, the context it receives, and the data it may return. It is the interface behind
`package-compile-hooks-scoping.md` (option 3) and the architecture review
`reviews/2026-10-18-node-parity-architecture.md`.
Until reviewed it is a proposal, not a contract.

The authoritative field list is `api.json`. The hook runs at compile time only — never on a board — in a fresh
MicroPython WASI instance with no filesystem, network, environment, clock or randomness. It returns data; the core
owns the generated Python.

## 1. The hook

A package may include one extra file beside its `<name>.node.json` and `<name>.node.py`:

```
<name>.compile.py
```

It defines exactly one entry point:

```python
def compile(ctx, properties):
    ...
    return {"properties": {...}, "warnings": [...]}
```

- `ctx` is this spec's context dict (JSON-shaped).
- `properties` is the node's properties after the descriptor's field resolution (`configRef`, pins, `target`,
  `nodeId`), i.e. the same dict its `.node.py` will receive, before the hook's own additions.
- The result is a dict, or `None` (nothing to add). Never Python source.
- The hook may `import` only the sandbox's built-in modules (`json`, `math`, `re`, `binascii`, `sys`). There is no
  filesystem, network, environment, clock or randomness: `open` and the `os` file functions are unavailable.
- Hooks are deterministic: the same context and properties must produce the same result.

The core runs the hook once per node instance during a compile, after all data-driven field resolution and before
the `.node.py` is wrapped into generated code. A package without the file behaves exactly as today.

## 2. The context

```json
{
  "version": 1,
  "node": {
    "id": "b3f1…",
    "type": "custom/dht22",
    "properties": {"bus": "c1"},
    "wired": {"inputs": [false], "outputs": [true]}
  },
  "flow": {
    "nodes": [{"id": "b3f1…", "type": "custom/dht22", "properties": {"bus": "c1"}}],
    "configs": [{"id": "c1", "type": "thingstudio/config/i2c-bus", "properties": {"bus": 0, "scl": 22, "sda": 21}}]
  },
  "referencedConfigs": {
    "c1": {"bus": 0, "scl": 22, "sda": 21}
  },
  "target": {"boardId": "esp32-devkit", "boardName": "ESP32 DevKit", "processorId": "esp32",
             "processorName": "ESP32", "label": "ESP32 DevKit", "capabilities": ["wifi", "bled"]}
}
```

| Field | Meaning |
|---|---|
| `version` | Context version. A hook that needs a newer one should say so in an error rather than guessing. |
| `node` | This instance: `id`, `type`, resolved `properties`, and `wired`. `wired.inputs`/`wired.outputs` are booleans positionally matching the descriptor's ports. |
| `flow.nodes` | Every node in the flow, in graph order: `id`, `type`, **non-secret** `properties`. |
| `flow.configs` | Every config: `id`, `type`, **non-secret** `properties` (`credentialName`, not the secret). |
| `referencedConfigs` | The configs this node's `configRef` fields point at, with their resolved secrets — the same values the node already receives on the board today. |
| `target` | The board/processor compiled for, or `null` when none is known. Same fields as a `target` property field, plus nothing board-specific beyond `capabilities`. |

Wiring is a boolean per port, not a target id: the first version covers "is this port connected", which is what
non-GUI nodes use. `findWiredTargets` (used only by the GUI, out of node-format scope) is not in v1.

## 3. The result

```json
{
  "properties": {"madctl": 96, "stride": 320},
  "claims": [{"resource": "GPIO 22", "use": "I2C0 SCL"}],
  "warnings": ["this board has no PSRAM, the buffer is capped at 16 KB"],
  "errors": ["pin 35 is input-only on the ESP32"],
  "setupKey": "display-spi-0"
}
```

| Key | Type | Meaning |
|---|---|---|
| `properties` | object | Merged over the properties dict the `.node.py` receives. Values must be JSON-safe. |
| `claims` | list of `{resource, use}` | Hardware claims, validated by the same `resource-check.ts` rules as descriptor `resources`. `who` is the node id. |
| `warnings` | list of strings | Shown in the compile warnings, attributed to the node. |
| `errors` | list of strings | Any entry turns the compile into a `CompileError` naming the node and the messages. |
| `setupKey` | string | Optional setup-dedup key: node instances returning the same key emit setup once (the first instance wins). The hook is responsible for the setup being identical. |

Unknown keys are an error, not ignored — the one-vocabulary rule. A malformed result (wrong type, non-JSON-safe
value, too large) is a `CompileError`, and no part of it is applied.

### Limits (v1)

| Limit | Value |
|---|---|
| `properties` serialized size | 64 KB |
| `claims` | 64 |
| `warnings` / `errors` | 32 each |
| `setupKey` | 64 characters |
| Wall clock per hook | 1 s |
| Wall clock per compile (all hooks) | 5 s |

Exceeding a limit is a compile error naming the package and the limit. The wall clock is enforced by terminating
the hook worker, not by trusting the hook.

## 4. Fault handling

| Situation | Result |
|---|---|
| The hook raises | `CompileError`: `<package>: compile hook failed: <message> (line N)`, with the traceback in the compile output. |
| The hook times out | `CompileError`: `<package>: compile hook timed out after 1 s`. The worker is discarded. |
| The result is malformed | `CompileError`: `<package>: compile hook returned <reason>`. |
| `ctx.version` is newer than the core | `CompileError`: `<package>: needs a newer Thingstudio (compile context v2, this editor has v1)`. |

Failures never fall back to "compile anyway without the hook": a package that ships one either runs it or the
compile stops. This is the same rule the rest of the compiler follows.

## 5. Worked example: the network family

A network package's hook derives WiFi from the flow instead of asking for new vocabulary:

```python
def compile(ctx, properties):
    wifi = None
    for config in ctx['flow']['configs']:
        if config['type'] == 'thingstudio/config/wifi':
            wifi = config['properties']
            break
    if wifi is None:
        return {'errors': ['no WiFi config in this flow']}

    mqtt = any(n['type'].startswith('thingstudio/mqtt_') for n in ctx['flow']['nodes'])
    return {
        'properties': {
            'ssid': wifi.get('ssid', ''),
            'security': wifi.get('security', 'password'),
            'deferToMqtt': mqtt,
        },
    }
```

The `.node.py` then calls `ts_wifi.ensure_station(...)` with those values. The hook sees no more than the node
would receive on the board; the credentials land in generated Python exactly as a `configRef`'s do today.

## 6. Relationship to built-in hooks

Built-in TS codegen hooks already see a superset of this context (`CodegenContext`). The adapter that makes them
conform to this spec is not required for the first package hook, but the field names here are the contract: a
built-in and a package must not diverge in what "the flow", "wired" or "target" means. This is the structural half
of the parity goal (`reviews/2026-10-18-node-parity-architecture.md` §7).

## 7. What this spec does not cover

- Editor-side port types that follow a property (`inject`, `startup`, `variable_get`). That stays descriptor
  vocabulary (decision 2026-10-18).
- GUI layout (`screens`, `findWiredTargets`) — out of node-format scope.
- Passing Python source, importing a package's other files, or any on-device effect. The `.node.py` remains the
  only device-side code.

## 8. Conformance

Vectors live in `interfaces/node-compile-context/vectors/` and are run by
`editor/test/node-compile-context-conformance.test.ts` (to be added with the first implementation). A vector is a
context, a hook body, and either the expected result or the expected error. The conformance test must cover: the
worked example above, a malformed result, an `errors` entry, a timeout, and a version mismatch.
