# interfaces/

The single home for Thingstudio's cross-subsystem interface specifications. Each interface — a contract between
components that have to agree (editor, device runtime, backend, flow files, boards) — has exactly one spec here,
and every implementation is written *against that spec*, not against another implementation's behaviour.

This is the concrete form of the rule in `../AGENTS.md`, **"Interface specs: read before you implement, change only
with permission."**

## The interfaces

| Interface | Status | Spec |
|---|---|---|
| Wire protocol (editor ↔ backend ↔ device) | shipped | [`protocol/`](protocol/README.md) |

Planned (each gets a folder here as it lands, per the architecture review): the device runtime API
(`runtime.py`'s functions that generated flow code calls) and its dependency manifest, the node descriptor, and the
board/processor descriptor.

## How to work with one

1. **Read the spec before implementing or changing anything that emits, parses, stores or transmits what it
   defines.**
2. **Run its conformance test** in the same change. For the wire protocol: `editor/test/protocol-conformance.test.ts`,
   `device-runtime/test/test_conformance.py`, `backend/test/test_conformance.py`.
3. **Do not change the interface** (an id, field, framing rule, descriptor shape, or API signature — adding or
   removing one) **without Mike's explicit permission in the session.** Adding conformance vectors and fixing an
   implementation that has drifted is allowed; moving the contract under boards and saved flows already in the
   field is not. Propose the change and its blast radius, then wait.

## House style for a spec in here

Written for people: plain language, short sections, tables for field lists, and a worked example showing real bytes.
A spec only its author can follow is a spec that will drift. See `protocol/SPEC.md` as the model.
