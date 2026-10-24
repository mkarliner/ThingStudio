# Thingstudio wire protocol — v1 specification

This is the single home for the protocol the Thingstudio editor, device runtime and backend all speak. It has three
parts: this prose spec, a machine-readable message table (`messages.json`), and conformance vectors (`vectors/`) that
every implementation runs. It is the seed of the planned `thingstudio-protocol` component (see
`../../docs/working-notes/architecture-review-continuation-briefing.md`).

The design doc (`../../docs/thingstudio-design-doc.md` §13) gives the intent. **This file and `messages.json` are
authoritative for the bytes on the wire** — where an implementation disagrees, the implementation is wrong.

Three implementations must agree:

| Implementation | Language | Framing | CBOR |
|---|---|---|---|
| `editor/src/protocol/` | TypeScript | `framing.ts` | `codec.ts` (cborg) |
| `device-runtime/src/` | MicroPython | `framing.py` | `messages.py` + `cbor.py` |
| `backend/src/thingstudio_backend/` | Python | `framing.py`, `line_framing.py` | — (relays bytes, never decodes) |

## 1. A worked example

The simplest message, `HELLO_REQUEST` (type 10, no fields):

1. The body is an empty CBOR map: `a0` (one byte).
2. The length header counts the type byte plus the body: `1 + 1 = 2`, big-endian: `0002`.
3. The type byte is `0a` (10).
4. So the frame is `0002 0a a0`, i.e. the four bytes `00 02 0a a0`.
5. Over the transport, the whole frame is base64-encoded into one line: `F64:AAIKoA==`.

Everything else in this document is a variation on those five steps.

## 2. Frame layout

```
+----------------+-----------+------------------------------+
| length (2, BE) | type (1)  | CBOR body (length - 1 bytes) |
+----------------+-----------+------------------------------+
```

| Part | Size | Meaning |
|---|---|---|
| length | 2 bytes, big-endian | The type byte **plus** the body, not counting the length header itself. So `length == 1 + len(body)`. |
| type | 1 byte | One of the ids in `messages.json`. `0` is never used. |
| body | `length - 1` bytes | CBOR (see §3). An empty map (`a0`) for a message with no fields. |

The largest type-plus-body is `0xffff` (65535) bytes. A `DEPLOY` whose flow exceeds that does not fit one frame
under v1.

**Recovering from damage.** There is no checksum and no resync marker. A damaged *body* is contained to its own
frame, because the next frame boundary is still found from that frame's length header. A damaged *length header* is
not recoverable: the decoder drops everything buffered and the transport decides whether to reconnect. A declared
length smaller than the one-byte type field is nonsense and also drops the buffer.

## 3. CBOR body

The body is always a CBOR **map** with text-string keys. The device's codec is hand-rolled
(`device-runtime/src/cbor.py`) and understands only these value types:

| CBOR type | Encoding | Example use |
|---|---|---|
| unsigned / negative integer | shortest form | byte counts, versions, pins |
| byte string | | `DEPLOY.bytecode`, `DEP_PUT.data` |
| text string | UTF-8 | node ids, hostnames |
| boolean | `f4`/`f5` | `ok`, `hard` |
| double float | `fb` + 8 big-endian IEEE-754 bytes | a `number` port value |
| map | string keys | `runtimeVersion`, the message body itself |

Deliberately **not** supported: arrays, CBOR tags, indefinite-length items, `null`/`undefined`, and half/single
floats (`f9`/`fa`) — only the canonical double (`fb`) is carried. Both implementations must encode a double as
`fb`; the device's `cbor.py` once emitted a non-canonical form and could not read `fb`, so the two ends could not
exchange a float at all. Found and fixed 2026-10-14 by the conformance vectors (§8).

**Optional fields are left out, never sent as null.** Both encoders drop a `null`/`None` before encoding, because
the device decoder has no null. On decode, a missing key and an explicit null both mean "not provided".

Encoders are canonical: no duplicate keys, minimal integer/length encodings, no `undefined`, no NaN or Infinity,
integers within the safe range. Map key order does not matter to a decoder, so byte-identical output across
languages is not required — see §8.

## 4. Transport encoding

One complete frame is base64-encoded into a single line prefixed `F64:` and ended with a newline. This is the same
on USB serial and WiFi TCP: a deliberate workaround for partial `read(n)` returns on some USB-UART bridges. Plain
device `print()` lines share the stream without the prefix and reach the editor as debug text.

**A line holds exactly one whole frame, and a receiver decodes each line on its own.** A line whose bytes
are not one whole frame (it ends inside a frame, or has bytes left over) was damaged on the way: the
receiver drops it as one error and keeps nothing for "the rest of the frame". The board answers it like any
line it couldn't read (§7.1). Keeping the bytes instead would make the next, good line read as the damaged
one's continuation. The backend moves
frame bytes verbatim between WebSocket binary messages and `F64:` lines, and never decodes the CBOR.

## 5. Messages

Ids and directions are in `messages.json`, which is authoritative. Direction is shown below as **→ device**
(editor to device) or **← device** (device to editor).

Types used in the tables: `uint` is a non-negative integer; `optional` means the key may be absent (never null).

The id numbering is **append-only**: a new message takes the next free id, and existing ids are never reused or
renumbered.

### HELLO — ← device
| Field | Type | |
|---|---|---|
| `chipType` | string | required |
| `runtimeVersion` | map `{major, minor, patch}` of uint | required |
| `runtimeBuild` | string | optional (git SHA stamp) |
| `currentFlowName` | string | optional |
| `currentFlowDeployId` | string | optional |
| `freeFlashBytes` | uint | required |
| `freeRamBytes` | uint | required |
| `freeIdfHeapBytes` | uint | optional (ESP32 only) |
| `largestIdfHeapBlockBytes` | uint | optional (ESP32 only) |
| `safeMode` | bool | optional, default false |
| `hostname` | string | optional |
| `authRequired` | bool | optional, default false |
| `authScheme` | string | optional |
| `hasWifi` | bool | optional, default false |
| `networkAddress` | string | optional |
| `dependencies` | map string→string | optional |

### DEPLOY — → device
| Field | Type | |
|---|---|---|
| `bytecode` | bytes | required |
| `staticData` | bytes | required (reserved, empty today) |
| `flowName` | string | optional |
| `deployId` | string | optional |
| `wifiProvision` | map `{selfProvision, allowReprovision}` of bool | optional |
| `dependencies` | map string→string | optional |

### DEPLOY_ACK — ← device
| Field | Type | |
|---|---|---|
| `freeFlashBytes` | uint | required |
| `freeRamBytes` | uint | required |
| `freeIdfHeapBytes` | uint | optional |
| `largestIdfHeapBlockBytes` | uint | optional |

### DEPLOY_ERROR — ← device
| Field | Type | |
|---|---|---|
| `code` | string | required |
| `message` | string | required |

### VALUE_STREAM — ← device (reserved; decided not to build)
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |
| `portId` | string | required |
| `payload` | any CBOR in the §3 profile | required |
| `timestampMs` | uint | required |

Reserved, not emitted, and not planned: live value streaming targets real-time events and would slow flows (Mike,
2026-10-14). The type id stays reserved so it costs nothing.

### NODE_ERROR — ← device
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |
| `exceptionType` | string | required |
| `exceptionMessage` | string | required |

### STATE_READ — both (reserved; the listener ignores it)
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |
| `key` | string | required |
| `value` | any CBOR | optional — absent on a request, present on a response |

### STATE_WRITE — → device (reserved)
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |
| `key` | string | required |
| `value` | any CBOR | required |

### TRIGGER — → device
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |

### HELLO_REQUEST — → device
No fields.

### NODE_STATUS — ← device
| Field | Type | |
|---|---|---|
| `nodeId` | string | required |
| `state` | one of `connected`, `disconnected`, `connecting`, `error` | required |
| `text` | string | optional |

### EXEC — → device
| Field | Type | |
|---|---|---|
| `code` | string | required |

### STOP_TO_PROMPT — → device
No fields.

### SET_BOARD_SETTINGS — → device (USB serial only)
| Field | Type | |
|---|---|---|
| `hostname` | string | optional |
| `password` | string | optional (8–64 characters) |
| `clearPassword` | bool | optional, default false |

### BOARD_SETTINGS_RESULT — ← device
| Field | Type | |
|---|---|---|
| `ok` | bool | required |
| `error` | string | optional |

### DEP_PUT — → device
| Field | Type | |
|---|---|---|
| `name` | string | required (library name) |
| `file` | string | required |
| `offset` | uint | required (bytes already sent for this file) |
| `total` | uint | required |
| `data` | bytes | required (this piece) |

### DEP_RESULT — ← device
| Field | Type | |
|---|---|---|
| `name` | string | required |
| `ok` | bool | required |
| `code` | string | optional |
| `error` | string | optional |
| `freeFlashBytes` | uint | optional |

### DEP_COMMIT — → device
| Field | Type | |
|---|---|---|
| `name` | string | required |
| `hash` | string | required |
| `files` | non-empty map string→uint (file name → size) | required |

A map, not a list, because the device codec has no arrays.

### RESTART — → device
| Field | Type | |
|---|---|---|
| `hard` | bool | optional, default false (false = soft reset, true = full chip reset) |

### DEP_ACK — ← device
| Field | Type | |
|---|---|---|
| `name` | string | required |
| `file` | string | required |
| `offset` | uint | required |
| `ok` | bool | required |
| `code` | string | optional |
| `error` | string | optional |

### FLOW_PUT — → device
One piece of the next flow's bytecode, for a board that cannot take the whole `DEPLOY` in one message.

| Field | Type | |
|---|---|---|
| `offset` | uint | required |
| `total` | uint | required |
| `data` | bytes | required |

### FLOW_ACK — ← device
Answer to one `FLOW_PUT`. The editor sends the next piece only after this.

| Field | Type | |
|---|---|---|
| `offset` | uint | required |
| `ok` | bool | required |
| `code` | string | optional |
| `error` | string | optional |

### FLOW_COMMIT — → device
Every piece has been sent: save the flow, start it, answer `DEPLOY_ACK` or `DEPLOY_ERROR`.

| Field | Type | |
|---|---|---|
| `total` | uint | required |
| `flowName` | string | optional |
| `deployId` | string | optional |
| `wifiProvision` | map | optional |
| `dependencies` | map string→string | optional |
| `staticData` | bytes | optional (empty today) |

### Chunked deploy (2026-10-22)

`DEPLOY` carries the whole flow in one message, so the board needs one contiguous block the size of that message
(~1.3× the bytecode, base64-inflated). A classic ESP32 runs MicroPython on a **split heap**
(`MICROPY_GC_SPLIT_HEAP`): `gc.mem_free()` sums several regions, and after a display flow has run no single region
may hold a 10 KB block even with 100 KB free — the reason a 9.5 KB flow could not be deployed over a running GUI
flow.

`FLOW_PUT` pieces plus `FLOW_COMMIT` are the same treatment `DEP_PUT`/`DEP_COMMIT` gave libraries in runtime 8.0.0:
every allocation is one piece, which fits wherever there is room. The message carries no piece size — that is the
sender's choice. The editor sends **5 KB** pieces (12.0.0): big enough that a deploy is not slow, small enough that a
fragmented heap can usually find room. A board that cannot take 5 KB has a memory problem worth seeing, so the
editor does not shrink around it. This editor always uses the chunked messages — there is no whole-`DEPLOY` fallback,
because that path needs the one contiguous block chunking exists to avoid. `DEPLOY` stays valid in the spec for older
editors. A board that predates 11.3.0 is refused by the major-version gate before anything is sent, **when the editor
has seen a `HELLO` on this connection**; without one the editor deploys unchecked and says so.

**Nothing is repaired automatically.** When a flow cannot be received, or is refused before it starts (incomplete,
missing library), the board answers `DEPLOY_ERROR` and changes nothing: the running flow keeps running and the flow
saved on flash is untouched. Once the new flow is being started the old one has already been stopped, so a flow that
fails to start leaves no flow running (§7.3). Either way the board does not free memory or restart to make a retry
fit. The editor reports that one failure with what the user can do. A deploy is a
fixed sequence, not a search (see `AGENTS.md`, "one deterministic path, not a recovery chain").

## 6. Auth and version negotiation

Authentication is at the **session** level, not per message. The WiFi transport authenticates the session
(`TSAUTH1`, a random-nonce HMAC-SHA256); every message on an authenticated session is trusted. USB serial carries
no authentication. `HELLO`'s `authRequired` and `authScheme` report whether the board has a transport password set.

`runtimeVersion` (major.minor.patch) arrives in `HELLO` and again on `HELLO_REQUEST`. The deploy gate
(`editor/src/protocol/version.ts`) blocks a DEPLOY only on a **major** mismatch; minor and patch differences are
logged but allowed. An unknown type byte is ignored and logged, never fatal, and never answered — which is what makes the
append-only id rule safe.

## 7. Exchanges

§5 says what each message looks like. This section says how they are used together: what answers what,
what the board remembers between messages, and what may be sent again. **The state machines in `states.json` are
the ground truth**: both sides run them as data, and `STATES.md` (generated from them) shows each as a diagram and a
table. `SEQUENCES.md` draws the exchanges; `vectors/exchanges.json` tests them on both sides (§8). Added 2026-10-24 after the protocol audit
(`docs/working-notes/reviews/2026-10-24-protocol-audit.md`): until then these rules lived only in the code,
and the gaps between them left a board refusing every deploy.

**One editor at a time is assumed.** Replies carry no request id, and a board connected over USB and WiFi
at once sends every message to both. Two editors talking to one board can each take the other's replies.

**How a transition runs.** The row's action (`do`) runs in the state the event arrived in; the machine moves to
the row's `to` after the action returns, or to its `onError` target when the action fails (§7.5). An illegal move
is announced first (§7.6), then the machine's illegal rule runs. Both sides follow that order, and each machine's
`about` in `states.json` says so.

### 7.1 Who answers what

Which event is answered with which message is a property of the `board.listener` rows themselves (`replies`), so
the list is generated into `STATES.md` ("Who answers what") rather than restated here, where it could drift from
the table the board runs. A row with no replies sends nothing: `EXEC` output and the `STOP_TO_PROMPT`/`RESTART`
notices are printed console lines, not protocol messages, and a restart ends with the boot `HELLO`.

The board also sends, unasked: `HELLO` at boot and when a WiFi session starts, `NODE_ERROR` and
`NODE_STATUS` while a flow runs, and printed lines.

**A line the board can't read.** Bad base64, a frame that doesn't decode, or a `MemoryError` while reading.
The board can't tell which message it was, so it answers `FLOW_ACK` `ok: false`, `code: "Garbled"`, with
`offset` set to the flow bytes it has stored so far (0 when no flow transfer is under way). The editor sends
one line at a time and waits, so a `Garbled` answer is about **the line it sent last**, whatever that was. The
`offset` only means something when that line was a `FLOW_PUT`. When the cause was a `MemoryError`, the board
also sends `DEPLOY_ERROR` `MemoryError`. That keeps an older editor, which sent a whole `DEPLOY`, from waiting
out its timeout. An editor that has not yet sent `FLOW_COMMIT` ignores it (§7.4).

### 7.2 A file arriving in pieces

A flow (`FLOW_PUT`) and each file of a library (`DEP_PUT`, one per `name` + `file`) arrive the same way: as a
**stream** that is always **idle**, **receiving** (*stored* bytes out of *total*) or **failed** (a write
failed). The machine is `board.stream` in **`states.json`**, which is the ground truth; `STATES.md` shows it as a
diagram and a table. Two rules follow from it, and the editor relies on both:

- **Any piece may be sent again.** Writing at an offset already stored rewrites the same bytes, so when an
  answer is lost the editor resends the piece and gets `ok`.
- **`offset` 0 always starts over**, whatever came before: an abandoned transfer, a refused commit, a failed
  write.

Every other piece is illegal and answered `BadPiece`: a gap, a different `total`, a piece that runs past the end,
a piece at `offset` > 0 when nothing is under way. A library piece is checked before this: a `name` or `file`
that isn't a plain module name is `BadName`, and a first piece larger than the free flash space is `NoSpace`.

### 7.3 Commit

A commit ends every stream it covers (`board.stream`'s `commit` event): afterwards they are **idle** whatever the outcome, and their
temporary files are gone. The checks happen **before** anything under a real name changes.

`FLOW_COMMIT` (answered `DEPLOY_ACK` or `DEPLOY_ERROR`), in order:

| Step | If it fails | Running flow | Saved flow |
|---|---|---|---|
| 1. the flow stream is receiving and *stored* = `total` | `Incomplete` | unchanged | unchanged |
| 2. every library in `dependencies` is installed, at that hash | `MissingDependency` | unchanged | unchanged |
| 3. move the temporary file over the saved flow | `WriteFailed` | unchanged | unchanged |
| 4. stop the running flow, save `flowName`/`deployId`, start the new flow | the exception's name (`ImportError`, `MemoryError`, ...) | **none running** | the new flow |
| 5. remove libraries the new flow doesn't use (best effort), answer `DEPLOY_ACK` | — | the new flow | the new flow |

`DEP_COMMIT` (answered `DEP_RESULT`): every file in `files` must have a stream that is receiving with
*stored* equal to its listed size (else `Incomplete`, or the stream's own code if it failed). Then the files
are moved into place and the library index updated (`WriteFailed` if that fails, and the library is then
dropped from the index so the editor resends it).

### 7.4 What the editor does

The machine is `editor.transfer` in `states.json`. Its waits:

| Step | Waits for | Up to | Then |
|---|---|---|---|
| Connect | `HELLO` after `HELLO_REQUEST` | 3 s | explains what the board printed instead; stays connected |
| Each piece | the matching `FLOW_ACK`/`DEP_ACK` | 10 s | no answer, or `Garbled`: send the same piece again, at most 2 more times; any other refusal ends the deploy |
| `DEP_COMMIT` | `DEP_RESULT` | 30 s | a `Garbled` answer: send the commit again, at most 2 more times |
| `FLOW_COMMIT` | `DEPLOY_ACK`, `DEPLOY_ERROR`, or a `HELLO` it didn't ask for (the board restarted while starting the flow) | 30 s | a `Garbled` answer: send the commit again, at most 2 more times |
| `SET_BOARD_SETTINGS` | `BOARD_SETTINGS_RESULT` | 10 s | |
| `RESTART` | a `HELLO` | 20 s | sends `HELLO_REQUEST` once |

The editor starts waiting for a commit's answer when it sends the commit, not before. A `DEPLOY_ERROR` that
arrives while pieces are still being sent is not the answer to anything this editor sent (§7.1); the
editor logs it and carries on.

Over WiFi the backend sends a blank line every 30 s, and the board closes a session that has sent nothing
for 90 s.

### 7.5 Codes

Codes the editor acts on are part of the protocol: renaming one changes the editor's behaviour.

| Code | In | Meaning | The editor |
|---|---|---|---|
| `Garbled` | `FLOW_ACK` | the board couldn't read the last line | resends that line |
| `BadPiece` | `FLOW_ACK`, `DEP_ACK` | the piece doesn't fit the stream (§7.2) | ends the deploy |
| `WriteFailed` | `FLOW_ACK`, `DEP_ACK`, `DEP_RESULT`, `DEPLOY_ERROR` | writing to flash failed | ends the deploy |
| `NoSpace` | `DEP_ACK`, `DEP_RESULT` | flash is full | ends the deploy |
| `BadName` | `DEP_ACK`, `DEP_RESULT` | a library or file name isn't allowed | ends the deploy |
| `Incomplete` | `DEP_RESULT`, `DEPLOY_ERROR` | committed before every byte arrived | ends the deploy |
| `MissingDependency` | `DEPLOY_ERROR` | a library the flow needs isn't installed | forgets what it thought the board had, so the next deploy sends every library |
| `Unsupported` | `DEP_ACK`, `DEP_RESULT`, `DEPLOY_ERROR` | the board's runtime is missing `deps.py` | ends the deploy |
| `MemoryError` | `DEPLOY_ERROR` | no room to receive or start the flow | memory advice |
| `ImportError` | `DEPLOY_ERROR` | the flow imports something the board doesn't have | names the module |
| any other | `DEPLOY_ERROR` | the Python exception raised while starting the flow | shows it |

`HELLO.authScheme` is `"none"` when no WiFi password is set, otherwise the scheme name (`"hmac-sha256-nonce"`, the `TSAUTH1` handshake).

### 7.6 Illegal transitions

The machines in `states.json` list every legal move. A (state, event) with no row is **illegal**, and the
side running that machine raises an alert before doing what the machine's `illegal` rule says:

- **Board:** a console line `PROTOCOL_ILLEGAL <machine> <state> <event>: <detail>`, which reaches the editor's
  console like any printed line. Illegal pieces and commits are also answered (`BadPiece`, `Incomplete`).
- **Editor:** a red console line, `[protocol] illegal: <event> while <state> (<detail>)`.

An alert means one side broke the protocol, or the table is missing a legal case. Either way it is a bug to
report, not a condition to work around. The exchange vectors (§8) say where alerts must, and must not, happen.

## 8. Conformance

`vectors/` holds the shared cases that every implementation runs:

- `messages.json` — for each case, the logical `message` and its canonical `frameHex`. An implementation must encode
  a message so a decoder recovers it, and decode `frameHex` back to the same message.
- `framing.json` — byte-level reassembly: `chunks` fed in order to the decoder, and the expected result sequence
  (this is what checks a frame split across reads, and several frames in one read).
- `invalid.json` — frames that must be rejected at the named stage (`framing` or `decode`), never a hang or a crash.
- `exchanges.json` — whole conversations (§7): what the editor sends and what the board must answer, including lost
  and garbled lines. The board runs them against its real listener; the editor runs them against its sender,
  playing the board's lines back. One script for both, so the two sides can't each pass while disagreeing.

Byte strings cross the JSON boundary as `{"$bytes": "<lowercase hex>"}` (see `README.md`). The checks are
**semantic**: decoded maps compare equal whatever the key order. Only the framing cases are byte-exact.

Runner: `editor/test/protocol-conformance.test.ts`, `device-runtime/test/test_conformance.py`,
`backend/test/test_conformance.py`. Exchanges: `editor/test/protocol-exchanges.test.ts` and
`device-runtime/test/test_exchanges.py` (CPython driving a MicroPython listener, like
`test_listener_integration.py`).
