# Working note: how a node is defined (and where the model needs to grow)

Status: reference note, not a spec. Written 2026-08-11 during MVP planning, to
have something concrete to point at when node-related architecture calls come
up, rather than re-deriving this from §6/§7 of the design doc each time.
Grounded in what POC-D actually built (`poc-d/nodes.js`, `poc-d/compiler.js`,
`poc-d/harness.py`), generalized toward what the real v1 compiler (§6) needs.
Update this note as that generalization actually happens — it should track
reality, not the other way around.

## The two halves (§7's framing, made concrete)

Every node type the POCs have built so far has two separate definitions that
have to agree with each other, matching §7's "small JSON descriptor for the
editor... and a Python module implementing the node's behavior":

1. **Editor descriptor** — currently a hand-written Litegraph node class
   (`poc-d/nodes.js`): a `properties` object (the node's configurable state —
   `pin`, `code`, `payloadValue`), typed input/output ports declared via
   `addInput`/`addOutput` (the type string is what §6's wire-connect-time
   type check reads), and widgets that edit `properties` from the canvas.
   This is code today, not literally standalone JSON — worth flagging as a
   real decision still open for v1: keep hand-writing a Litegraph subclass
   per node type (what all three POCs did — fast to build, but every new
   node type means new JS), or move to a data-driven descriptor (an actual
   JSON/object shape) consumed by one generic node class, closer to what §7
   describes literally. The POCs deliberately didn't need to answer this —
   3–5 node types each, hand-writing was cheap. v1's real node list (§10:
   roughly a dozen types) is the point where that cost starts to matter.

2. **Device-side behavior** — what the compiler emits into the generated
   flow module for that node instance. This is the part POC-D actually
   proves out, and it's not one uniform pattern — see below.

## Three codegen patterns POC-D already demonstrates

`poc-d/compiler.js` is a hardcoded compiler for exactly one graph shape
(`inject → function → gpio_out`), not a general per-node-type registry — see
"What POC-D deliberately doesn't generalize" below. But the *shape* of what
it emits per node type is real signal for what the general case needs to
support, because it already shows three genuinely different patterns:

**Pattern 1 — native primitive, parameterized.** `gpio_out` compiles to a
call into a MicroPython builtin (`machine.Pin`), parameterized by the node's
configured property (`pin`):

```python
_pin = machine.Pin(12, machine.Pin.OUT)
def _node_gpio_out(msg):
    _pin.value(1 if msg.get('payload') else 0)
```

There is no separately-shipped "gpio_out node module" here — the codegen
*is* the node's device-side implementation. For a real native node type,
that codegen template is the thing a node's implementer writes once; the
compiler just fills in each instance's configured properties.

**Pattern 2 — folded into flow control structure, not a callable at all.**
`inject` doesn't compile to a function the flow calls — its properties
(`payloadValue`, `repeat`) become the `msg` construction and the loop
condition directly:

```python
async def _flow_main():
    while True:
        msg = {'payload': True, 'topic': ''}
        result = _node_function(msg)
        ...
        if 0 <= 0:
            break
        await asyncio.sleep_ms(0)
```

Not every node is "a function the compiler calls" — some nodes shape the
generated control flow itself. Timers/intervals and other scheduling-facing
nodes will likely need this pattern too, not the callable pattern.

**Pattern 3 — user code, inlined verbatim.** `function` is the one node type
where the "device-side Python module" is written by the flow author, not the
node's implementer — the node's `code` property is indented and dropped
directly into a generated function body:

```python
def _node_function(msg):
    <user's code, indented 4 spaces>
```

This is the one pattern with no separate "node implementation" to design at
all — the contract is just "you're a function that takes and returns a
`msg` dict," which is exactly §6's envelope, imposed on user code rather
than on a node author's code.

## The envelope every pattern has to speak

Regardless of pattern, every node's generated code communicates over §6's
`msg` envelope — a dict with `payload` (typed: `int`/`number`/`bool`/
`string`/`bytes`/`any`), `topic`, and room for extra properties. POC-D's
generated code already uses the real shape (`{'payload': ..., 'topic': ''}`),
just without the extra-properties or full type range exercised yet (bool
only, per its own scope note). Any node's codegen — in any of the three
patterns above — needs to read/write this same dict shape; that's the actual
inter-node contract, more than any shared function signature.

## How deploy actually reaches the device (relevant to what "a node" needs to survive)

Worth having straight, since it shapes what a node's device-side code can
assume: the whole compiled flow is one generated Python module
(`poc-d/compiler.js`'s output), cross-compiled client-side to one `.mpy` file,
written to `/_flow.mpy` on the device, and `import`ed as a whole
(`poc-d/harness.py`'s `_deploy_mpy`) — its top-level code runs immediately on
import, which is what calls `harness_api.spawn(...)` to register the flow's
coroutines with the runtime's task tracking (needed so a redeploy can cancel
exactly those tasks). There's no per-node deploy step and no per-node module
file — a node's "device-side implementation" only ever exists as inlined
text inside the one flow module the compiler emits. That's consistent with
§11's now-resolved call that v1 doesn't need node distribution/versioning:
nothing about a node is shipped independently of the whole flow (user code,
Pattern 3) or the whole runtime image (native primitives, Pattern 1/2).

## What POC-D deliberately doesn't generalize (the real gap to §6's compiler)

Worth being honest about, since it's the actual v1-scope work, not proven
yet:

- **Exactly one hardcoded graph shape.** `compiler.js` checks for exactly 1
  inject, 1 function, 1 gpio_out, wired in that exact chain, and rejects
  anything else with a compile error. No topological sort, no arbitrary
  wiring, no fan-in/fan-out.
- **No per-node-type codegen registry.** The three patterns above are all
  bespoke string-building in one file (`compiler.js`), not something a new
  node type could plug into without editing the compiler itself. The real
  §6 compiler needs each node type to own its codegen (a template or
  function keyed by node type, called during a graph walk), not one
  function that already knows about all three node types by name.
- **One flow, not several.** No node-ID-uniqueness-across-flows bookkeeping
  (§6's multi-flow section already flags this as v2-scope, not v1).
- **No resource-conflict checking.** Two `gpio_out` nodes both claiming pin
  12 in the same flow wouldn't be caught anywhere in this pipeline today —
  worth a node-level "declares which pins/buses it claims" contract before
  v1 ships more than one peripheral-touching node type, independent of the
  multi-flow version of this same problem §6 already names.

## Proposed contract for a real v1 node type (for discussion, not decided)

Pulling the above together, a v1 node type plausibly needs to declare:

- **Type ID** (`thingstudio/gpio_out`) and palette metadata (title, color,
  icon).
- **Ports**: typed inputs/outputs, read by both the editor's wire-connect
  check (§6) and eventually the compiler's graph walk.
- **Properties**: the widget-editable config (§6/§7's descriptor half).
- **A codegen hook**: given a node instance (its properties) and its
  resolved input/output wiring, emit whichever of the three patterns above
  fits — a native-primitive call, a control-flow fragment, or (function node
  only) verbatim user code.
- **Claimed resources** (optional, only for peripheral-touching nodes): pins
  or buses it uses, for the conflict check named above.

None of this is committed — it's the shape the evidence from POC-D points
toward, offered as a starting draft for whoever designs the real §6 compiler.
