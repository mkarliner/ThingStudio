# Wire protocol: CBOR float support — real gap, latent, not scoped

Found 2026-10-14 by the first run of the shared protocol conformance vectors (`interfaces/protocol/vectors/`,
`docs/working-notes/decisions/subsystem-interfaces.md`).

The editor encodes a CBOR **float** (cborg, major type 7) happily; the device's hand-rolled decoder
(`device-runtime/src/cbor.py`) rejects major type 7 outright ("unsupported CBOR simple/float value"). So any
message field carrying a float would encode in the editor and fail to decode on the board.

Latent today: the only field typed "any CBOR" is `VALUE_STREAM.payload`, and `VALUE_STREAM` is reserved and never
emitted. But it becomes real the moment live-value streaming is built — every `number`-typed port value is a float
in both languages — or when any other float-carrying field is added.

Options, none chosen: teach `cbor.py` to encode/decode a float; or keep the wire profile integer-only and carry
floats as scaled ints (a fixed-point convention) with the conversion in codegen; or restrict `VALUE_STREAM.payload`
to the profile. Decide alongside the `VALUE_STREAM` design (Tier 2, design doc §8/§10). Until then, `interfaces/protocol/SPEC.md`
documents the profile as int/text/bytes/bool/map and the vectors stay inside it.
