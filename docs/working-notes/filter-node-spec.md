# Filter node spec

Status: decision, 2026-09-26 (agreed with Mike in session; built the same day).

The `filter` node (`thingstudio/filter`) passes a message on only when it's worth sending and drops the rest.
Messages that pass are unchanged. A transform: returning `None` drops, as with `function`. No compiler change.

## Modes

| Mode | Passes when |
| --- | --- |
| `change` (default) | payload `==` differs from the last one passed |
| `deadband` | payload, as a number, is `abs(new - reference) >= threshold`; reference = last value passed |
| `rate` | `ticks_diff(now, last passed) >= intervalMs`; extras are dropped, not queued |

Properties: `mode`, `threshold` (>= 0, default 1), `intervalMs` (positive integer, default 1000), `ignoreFirst`
(default false; `change`/`deadband` only), `perTopic` (default true, as in Node-RED).

## Decisions made while specifying

- Deadband compares with the last *passed* value, so a slow drift passes once it adds up. Falls count (abs).
  Threshold 0 passes any numeric change. A `direction` option (rising/falling) is left for later, additive.
- Numbers: int and float. Numeric str/bytes are parsed with `float()` (MQTT payloads are text); the original
  payload is still what goes out. bool, NaN and inf are not numbers.
- Rate limiting lives in `filter`, per mvp-feature-priorities.md Tier 1 item 5 point 2 (Node-RED puts it in
  `delay`). Mike didn't object when asked; revisit if Node-RED users look for it in `delay`.
- State is module-level per node, keyed by topic (or `''`), so it resets on Deploy and boot. Max 32 topics; a
  33rd clears the table, with one `FILTER_INFO` console line per deploy.
- A non-number in deadband is dropped and reported once via `runtime._report_error` (NODE_ERROR, flow keeps
  running), then quiet until a number arrives. Raising instead would end the source's coroutine.
  `_report_error` exists in every runtime with NODE_ERROR, so no runtime change or version bump. Don't rename
  it in `runtime.py` without a major bump.

## Later, all additive

Percentage deadband, direction, Node-RED's narrowband, filtering on a property other than `payload`, and a
rate mode that sends the last dropped value when the window ends (needs a task per node).

**2026-09-26, Mike: no field option.** Filtering on one field of a dict payload (e.g. a bme280's temperature) stays
a small `function` node before the filter -- "there are other use cases where other msg processing needs to be
done." Don't add a `field` property.
