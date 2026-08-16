# Working note: §6 wire-type system — scoping, not a decision

Status: scoping pass, 2026-08-16, this session — started as scoping, ended
as a real decision, worked out live in conversation rather than derived
from evidence already in hand the way `rete-migration-decision.md` was.
Written before touching any code, per this project's own established
pattern (every prior real call got its own note with an explicit "needs
Mike" section before implementation started). All open questions below are
now resolved; nothing here is still waiting on Mike. Explicit governing
call, stated plainly so it isn't lost in the detail below: **ship this
narrow and loose, see how it holds up hands-on, tighten specific rules
later if real use shows real pain — not an attempt to get the matrix
"right" up front.**

Triggered by: `rete-migration-decision.md`'s sub-decision 3 named this as
the task that follows "immediately after" the Rete migration, as its own
task, not bundled in. That migration is now closed (Phase 4 step 17 + Phase
5, this same session).

## What already exists (grounded in the actual code, this session)

**The interception mechanism is already built and live**, deliberately as a
seam for this task — nobody has to build it now:

- `editor/src/app/rete/validation.ts`: `editor.addPipe` intercepts every
  `connectioncreate` message before a connection is added to the graph.
  `canCreateConnection()` calls `target.isCompatibleWith(source)` on the
  sockets and refuses the connection outright if it returns false — exactly
  §6's "the editor refuses the connection outright" contract, already
  wired into the real editor, not a stub.
- `editor/src/app/rete/sockets.ts`: defines the `ThingstudioSocket`
  interface (`isCompatibleWith`) that `validation.ts` depends on. Today it
  has exactly one implementation, `AnySocket`, whose `isCompatibleWith`
  always returns `true` — this is sub-decision 3's "preserve current
  behavior exactly" placeholder, not a partial type system.
- Every port on every node class in `editor/src/app/rete/nodes.ts` is
  constructed with `new AnySocket()`. There is no port-type information
  anywhere in that file today.

**So the actual work is entirely additive to `sockets.ts` plus retrofitting
real socket types onto `nodes.ts`'s ports** — the validation plumbing this
task would otherwise have to build first already exists.

**Prior art worth reusing:** `pocs/poc-rete/src/sockets.ts` already has
`BoolSocket`/`NumberSocket`/`StringSocket`/`AnySocket` classes and a
`socketForPayloadType()` mapper, and `pocs/poc-rete/src/nodes.ts`'s
`InjectNode.retypeOutput()` already solved swapping a node's output socket
when its `payloadType` property changes. **Caveat:** the spike's
`isCompatibleWith` is strict same-class-only (`socket instanceof
BoolSocket`) — it never implements coercion (int feeding number). The real
task needs asymmetric compatibility (a source type being *acceptable to* a
different target type), which the spike never needed to build.

**One structural thing noticed, not part of this task, flagged so it isn't
rediscovered as a surprise mid-task:** `editor/src/node-library/registry.ts`
registers 16 node types for the compiler, but `editor/src/app/rete/nodes.ts`
and `palette.ts` only expose 5 of them on the actual canvas (inject,
function, debug, gpio_out, timer). The other 11 — boolean, arithmetic,
comparator, variable_get/set, gpio_in, pwm_out, wifi_status, http_request,
mqtt_publish, mqtt_subscribe — have compiler-side codegen and no editor
representation at all yet. That gap predates this task and isn't caused by
it, but it bounds this task's real scope: a wire-type system can only be
demonstrated end-to-end, hands-on, against the 5 node types actually on the
canvas today. Whether to fold "expose the other 11 node types on the
canvas" into this task or treat it as its own separate task is an open
question below, not assumed either way.

## Where port types should live

`node-definition-model.md`'s original "proposed contract" already called
this: ports should be "read by both the editor's wire-connect check (§6)
and eventually the compiler's graph walk" — one declaration, not two that
can drift. Today, `editor/src/compiler/node-definition.ts`'s
`NodeDefinition` interface (the compiler-facing registry every
`node-library/*.ts` file implements) carries zero port information — only
`type`, `kind`, and codegen hooks.

**Proposed (not yet built): add a `ports` field to `NodeDefinition`** —
each input/output's name and payload type — populated in each of the 16
`node-library/*.ts` files, and have `editor/src/app/rete/nodes.ts` read it
when constructing each node class's sockets, instead of hardcoding
`AnySocket` per port. This keeps the compiler and the editor reading the
same source of truth, matching the original design intent, and it's the
kind of thing worth getting right once rather than maintaining two
declarations that can silently drift.

One real question this raises: `NodeDefinition` currently lives in
`editor/src/compiler/`, which the Rete/editor layer already imports from
(`node-library/*.ts` → `compiler/node-definition.ts`). Adding ports there
doesn't introduce a new dependency direction, so this seems like the
lower-friction option versus a parallel editor-side descriptor table — but
it does mean `compiler/node-definition.ts`, currently untouched by anything
canvas-related, gets a new field the compiler's own graph walk doesn't
necessarily need to read. Worth confirming this framing is right before 16
files get touched on the strength of it.

## Coercion matrix — resolved 2026-08-16 (conversation, this session)

The original draft below framed this as one binary allow/refuse call per
type pair, anchored only on §6's two examples. **Mike's steer, this
session: be loose in general, and only add friction where it actually
prevents real pain** — explicitly not a call to import Node-RED's own
coercion behavior, which rides on JavaScript's looseness (`==`, implicit
string/number juggling) and isn't a good reference for a statically
type-checked wire. The resolution ended up in three buckets by *kind* of
coercion, not one flat matrix, because the three kinds fail differently:

**1. Truthiness into `bool` — allow, unconditionally, from every type,
including `any`.** Python's `bool(x)` is well-defined and total (never
raises): `0`/`0.0`/`""`/`None`/empty collections are false, everything
else true. This isn't new behavior — `node-library/gpio-out.ts`'s codegen
already does exactly this (`1 if msg.get('payload') else 0`),
unconditionally, regardless of what payload type feeds it, and it's
already hardware-proven. The wire-type system's job at this boundary is to
not add friction to something that already works, not to gate it.

**Self-correction, same session:** an earlier pass at this table had a
separate blanket "`any` → anything typed: refuse" row that contradicted
this bucket for the specific case of `any → bool` — `bool(x)` is just as
total and safe when the source is statically untyped as when it's a known
concrete type, so there was never a real reason to refuse it. Fixed below:
`any → bool` is bucket 1 (allow), `any` into the *other* concrete types
stays refused (bucket 3). This is more than a wording fix — it means
`function → gpio_out` (an `any`-typed output into a `bool`-typed input,
probably the single most common real pattern once function nodes are
doing anything) needs no conversion node and no declared-output-type
mechanism. It just works, unchanged from today.

**2. Numeric widening — `int → number` allowed, `number → int` refused.**
`int → number` can't fail or lose information (§6, explicit). The reverse
is different in kind: it can't *fail* either, but it silently succeeds
with a truncated answer (`int(3.7)` → `3`, no error, easy to not notice) —
narrowing without an explicit rounding decision is exactly the kind of
quiet-wrong-answer case worth keeping refused. `string → number` sits in
its own spot here: it's allowed, but unlike the other two, it's a coercion
that *can* fail at runtime (`float("abc")` raises). Consistent with "loose
except where it hurts," and consistent with how the rest of this system
already treats exceptions (attributed via `NODE_ERROR`, not fatal) — a bad
string value becomes a reported runtime error instead of a wire-connect-
time refusal, not a silent wrong answer. Worth being aware this is a real
behavior choice (fails later, not never), not a free lunch.

**3. Ambiguous/format conversions — refused, explicit conversion node
required.** `bytes ↔ string` (encoding is a real decision — utf-8, hex,
base64 all give different answers), and by extension anything JSON/CSV/
HTML-shaped. This is the bucket Node-RED's own `json`/`csv`/`xml`/`base64`
parser nodes model correctly — explicit, dedicated nodes, kept separate
from ordinary untyped wires. Confirmed this session: that pattern is still
the right one for this bucket specifically, even though the rest of the
matrix is being loosened.

| Source → Target | Resolved | Bucket |
|---|---|---|
| `X` → `X` (same type) | Allow | identity |
| anything → `bool` | **Allow** | truthiness (bucket 1) |
| `int` → `number` | Allow | numeric widening (bucket 2) |
| `number` → `int` | Refuse | numeric narrowing (bucket 2) |
| `string` → `number`/`int` | Allow (can fail at runtime, reported via `NODE_ERROR`) | numeric widening (bucket 2) |
| `bytes` ↔ `string` | Refuse — needs an explicit conversion node | ambiguous (bucket 3) |
| anything → `any` | Allow | an `any` input has to accept everything |
| `any` → `bool` | **Allow** | bucket 1 — truthiness is total and safe regardless of the source's static type; see self-correction above |
| `any` → `number`/`int`/`string`/`bytes` | Refuse — needs an explicit conversion node | bucket 3 — these conversions genuinely can be ambiguous or fail for an arbitrary unknown-typed value, unlike `bool(x)` |

The declared-output-type softening mechanism raised earlier (`function`
gets an optional user-declared output type, like `inject`'s `payloadType`
dropdown) is no longer needed to unblock the common case — noted here only
so it isn't silently reinvented later; genuinely not needed given the
`any → bool` fix above.

## Scope of protection — what this catches and what it doesn't

Worth stating plainly, raised directly by Mike this session: **in real
Node-RED usage, most payloads past the first node or two are objects, not
scalars** (an HTTP response body, an MQTT JSON payload, a multi-field
sensor reading), and the dominant real bug is "this key isn't on the
object I expected," not "this value is the wrong scalar type." This
project's fixed type set (`int`/`number`/`bool`/`string`/`bytes`/`any`) has
no dict/object type at all — a structured payload is just `any` to this
system, and always will be, short of a much larger structural/shape-typing
effort this project isn't taking on.

**So this system is deliberately narrow, not a general correctness net.**
It catches scalar-type mismatches at the point they'd hit an unforgiving
native primitive — `gpio_out`'s `machine.Pin.value()` being handed
something that isn't sensibly boolean-ish, say. It does not, and structurally
cannot, catch `msg.payload.reading.celsius` against a payload that turned
out not to have a `reading` key. That failure mode stays exactly where it
already lives: the per-task exception boundary plus `NODE_ERROR`
attribution (§5), already built, already hardware-proven this same session
against a real "function node referencing an undefined name" case. That's
CLAUDE.md's fault-handling priority doing its actual job — the mitigation
for shape/schema errors was never going to be a wire-time check, it's
supposed to be good runtime attribution, and it already is one.

## Former open questions — all resolved 2026-08-16

1. ~~Confirm or amend the matrix above.~~ **Resolved** — three-bucket
   framing above.
2. ~~`any` as a source, specifically.~~ **Resolved** — refused into
   `number`/`int`/`string`/`bytes`, allowed into `bool` (self-correction
   above).
3. ~~Dynamic/retypeable sockets.~~ **Resolved, and currently moot in
   practice.** General rule for when it does matter: a property change
   that would retype a port drops the now-invalid wire rather than
   blocking the edit (matches "loose, low-friction"), and reuses the
   existing node-highlight mechanism to flag the drop transiently rather
   than doing it silently. Currently moot because, per the scope-of-
   protection section above and the `any → bool` fix, nothing in today's
   5-node canvas can actually produce an invalid wire from an
   `inject.payloadType` change — `gpio_out`'s `signal` is the only
   concretely-typed *input* that exists today, and everything reaches
   `bool` fine. This becomes live again once a non-`bool`-typed input port
   exists (one of the other 11 registry node types).
4. ~~Conversion nodes: build now, or defer?~~ **Resolved: defer.** No
   node in the current 5-type canvas has a port that would ever hit a
   refuse case (see scope-of-protection section) — there is nothing for a
   conversion node to unblock yet. Build one (parser-node-shaped, per the
   Node-RED precedent) when a real node with a `bytes`/`string`-typed
   port that actually needs one gets added to the canvas, not before.
5. ~~Scope boundary: the 5-vs-16 node type gap.~~ **Resolved: keep
   separate**, per this project's standing scope-creep caution — this task
   builds the socket/coercion infrastructure against the 5 node types
   already on the canvas; exposing the other 11 is its own task. Worth
   being explicit about the limitation this leaves: the "refuse" half of
   this system can only be unit-tested until one of those 11 lands, not
   proven hands-on in a real browser the way this project otherwise
   insists on.

## Governing call and rough blast radius

**Ship narrow and loose, tighten later if real use shows real pain** — the
explicit call from this session's conversation, restated here since it's
the thing that should survive if only one line of this note is read later.
Given the resolutions above, the actual v1 build is smaller than the
original draft implied: `sockets.ts` (real socket classes — `Bool`/
`Number`/`Int`/`String`/`Bytes`/`Any` — with coercion-aware
`isCompatibleWith`, not poc-rete's strict same-class check),
`compiler/node-definition.ts` (a `ports` field), the 5 currently-canvas
`node-library/*.ts` files (declare their ports' types — the other 11 stay
untouched, out of scope per question 5), and `rete/nodes.ts` (read real
socket types instead of hardcoded `AnySocket`, plus the drop-invalid-wire
mechanic from question 3, dormant until it's reachable). No conversion
node, no declared-output-type mechanism on `function` — both resolved as
not-needed-yet above. The compiler's codegen itself shouldn't need to
change — §6 frames this as an editor-side, wire-connect-time check; the
compiler already trusts the graph it's handed. Worth confirming that
framing holds once real work starts, rather than assuming it from this
session's reading alone.

## Not done this session

No code changed — this note is decision-complete but implementation
hasn't started. Next session on this task can go straight to the blast
radius above without re-litigating the matrix, same as
`rete-migration-decision.md` handed a settled plan to its own first
implementation session.
