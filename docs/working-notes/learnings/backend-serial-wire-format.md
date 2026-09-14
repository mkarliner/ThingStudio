# Learnings — Backend / serial wire format

Status: detail file, started 2026-09-07 (editor-backend-wiring session). See `learnings.md` for the index and this log's own maintenance rule.

- **A previously-"all tests passing" backend module can still be wrong against the real wire it talks to, if nothing ever exercised it against that wire's actual contract.** `ws_relay.py`/`framing.py` (built in the 2026-09-07 minimal-backend session, 25 tests passing) assumed §13's raw binary frame layout (2-byte length header + type + CBOR body) rides the physical serial byte stream directly — reasonable-looking, since that IS the frame layout, and `framing.py` is a faithful, correct port of `editor/src/protocol/framing.ts`. But the real device listener (`device-runtime/src/listener.py`) never puts that layout directly on the wire: it base64-encodes each complete frame and sends it as one `"F64:"`-prefixed text line, specifically to route around a real hardware bug (POC-D: `read(n)`/`readexactly(n)` on `sys.stdin` hung the device's event loop outright; `readline()` was reliable throughout — design doc §5, `listener.py`'s own header). `editor/src/protocol/transport.ts`'s `WebSerialTransport` already does this same base64/line encoding on the browser-direct path — the information needed to catch this was already in the repo, just not cross-checked when `ws_relay.py` was built against `framing.ts`'s frame layout directly. All 25 of that session's tests passed because they used a fake serial connection fed with raw `encode_frame()` output — internally consistent with the (wrong) assumption, so nothing in the test suite could have caught it. Only surfaced when a second, independent thing (the editor-side `BackendTransport` client, which has to actually agree with whatever the backend does) needed to reason about the real end-to-end wire shape. Fixed same-session: `backend/src/thingstudio_backend/line_framing.py` (a Python port of `transport.ts`'s own base64/F64-line encode/decode, inserted between `serial_relay.py`'s raw byte stream and the WS relay) plus updated tests in `backend/test/test_ws_relay.py`/new `test_line_framing.py`. Full incident: `docs/working-notes/outstanding-items/editor-backend-wiring.md`.
- **The general lesson, worth restating:** when two independently-built components are each internally tested but have never actually been run against each other (or against the real third thing both are supposed to agree with), "all tests green on both sides" is not evidence they agree with each other or with reality — it's evidence each side is internally consistent with its own assumptions. The backend's serial layer and the device's listener were built in different sessions, months apart in this project's own timeline sense, each with good test coverage, and still diverged on a load-bearing detail neither side's own tests could have caught. Building the client that has to bridge two such components is exactly the point where this kind of gap surfaces — worth treating that moment as a deliberate cross-check opportunity, not just "now write the client," next time two sides of an interface were built in separate sessions.
- **Same class of bug, third occurrence, 2026-09-14: the editor-side CBOR encoder never filtered
  `null`-valued optional fields, and the device's hand-rolled decoder has never supported decoding
  a CBOR null at all.** `editor/src/protocol/codec.ts`'s `encodeMessageBody()` just spread the
  message object into `cborg`'s `encode()` with no filtering; `device-runtime/src/cbor.py`'s
  decoder explicitly raises `CBORDecodeError("unsupported CBOR simple/float value ...")` on major
  type 7 / additional info 22 (CBOR null) by design (its own header: optional fields are "omitted
  from the map entirely, never encoded as CBOR null/undefined"). `device-runtime/src/messages.py`'s
  `encode_message_body()` already carries the matching filter (`v is not None`) and its own
  docstring cites an earlier, identical failure this exact gap caused for HELLO's `runtimeBuild`
  field, confirmed 2026-09-05 -- that fix was made only on the device-to-editor (Python encode)
  path and never mirrored to the editor-to-device (TypeScript encode) path. Went unnoticed for
  over a week because `DeployMessage`'s only nullable fields (`flowName`/`deployId`) are, in
  practice, always populated by a current editor (`flow-file.ts`'s `DEFAULT_FLOW_NAME`, a fresh
  `deployId` per Deploy click) -- surfaced for real only once `wifiProvision` (added 2026-09-14,
  `wifi-provisioning-captive-portal.md`) gave DEPLOY a field that's genuinely, routinely `null` in
  the ordinary case (any flow without an "unmanaged" WiFi config). Real-hardware symptom: every
  such DEPLOY crashed the device's decoder on arrival (`LISTENER_ERR protocol
  MessageDecodeError(...)`, "recovering, not crashing" -- caught Mike testing the brand new
  `wifi_gate` node's own test flow, unrelated to that node's own logic). **Same root lesson as the
  entry above, restated once more:** `editor/test/protocol.roundtrip.test.ts` already had
  `wifiProvision: null`/`flowName: null`/`deployId: null` sample messages and passed regardless --
  that test round-trips entirely through `cborg` on both ends, and `cborg` decodes its own CBOR
  null just fine, so an all-green in-repo test suite proved only that the editor's encoder and
  decoder agreed with each other, never that either agreed with the device's actual, stricter
  decoder. Fixed same session: `encodeMessageBody()` now filters `null`-valued keys before
  encoding, mirroring `messages.py` exactly; a new structural test (walks the decoded body
  recursively, not a raw-byte scan, since arbitrary binary fields like `bytecode` could
  coincidentally contain the CBOR-null byte as data) asserts no encoded message body ever contains
  an actual CBOR null.
