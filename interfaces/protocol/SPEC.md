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
exchange a float at all. Found and fixed 2026-10-14 by the conformance vectors (§7).

**Optional fields are left out, never sent as null.** Both encoders drop a `null`/`None` before encoding, because
the device decoder has no null. On decode, a missing key and an explicit null both mean "not provided".

Encoders are canonical: no duplicate keys, minimal integer/length encodings, no `undefined`, no NaN or Infinity,
integers within the safe range. Map key order does not matter to a decoder, so byte-identical output across
languages is not required — see §7.

## 4. Transport encoding

One complete frame is base64-encoded into a single line prefixed `F64:` and ended with a newline. This is the same
on USB serial and WiFi TCP: a deliberate workaround for partial `read(n)` returns on some USB-UART bridges. Plain
device `print()` lines share the stream without the prefix and reach the editor as debug text. The backend moves
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
2026-10-14). The type id stays reserved so it costs nothing; see §7.

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

## 6. Auth and version negotiation

Authentication is at the **session** level, not per message. The WiFi transport authenticates the session
(`TSAUTH1`, a random-nonce HMAC-SHA256); every message on an authenticated session is trusted. USB serial carries
no authentication. `HELLO`'s `authRequired` and `authScheme` report whether the board has a transport password set.

`runtimeVersion` (major.minor.patch) arrives in `HELLO` and again on `HELLO_REQUEST`. The deploy gate
(`editor/src/protocol/version.ts`) blocks a DEPLOY only on a **major** mismatch; minor and patch differences are
logged but allowed. An unknown type byte is ignored and logged, never fatal — which is what makes the append-only
id rule safe.

## 7. Conformance

`vectors/` holds the shared cases that every implementation runs:

- `messages.json` — for each case, the logical `message` and its canonical `frameHex`. An implementation must encode
  a message so a decoder recovers it, and decode `frameHex` back to the same message.
- `framing.json` — byte-level reassembly: `chunks` fed in order to the decoder, and the expected result sequence
  (this is what checks a frame split across reads, and several frames in one read).
- `invalid.json` — frames that must be rejected at the named stage (`framing` or `decode`), never a hang or a crash.

Byte strings cross the JSON boundary as `{"$bytes": "<lowercase hex>"}` (see `README.md`). The checks are
**semantic**: decoded maps compare equal whatever the key order. Only the framing cases are byte-exact.

Runner: `editor/test/protocol-conformance.test.ts`, `device-runtime/test/test_conformance.py`,
`backend/test/test_conformance.py`.
