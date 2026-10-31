# Learning: fetching a public page returns a stale cached copy

Cache-busting with a query parameter (`?fresh=2`) gets live data; a plain GET of
`hackaday.io/project/...` returned a stale CDN snapshot byte-identical across
minutes, indistinguishable from "no edits made". Verified 2026-10-30 while
checking Mike's Hackaday updates with him: the page he had just edited still
showed the old state until the request carried a query string.

Trap for any "fetch the live site and check my change" check: a stale fetch can
look exactly like "the edit didn't land". Always compare with a parameterised
URL, and say in the report that the earlier fetches may have been cache-copies.
