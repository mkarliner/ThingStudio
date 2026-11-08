// GoatCounter page counting for the public docs site.
//
// Same counting site as the thingstudio.net landing page (ts-stats.minus1.com, Mike's own
// server) -- the counts for both land in one dashboard. Docs paths get a "docs" prefix (docs/,
// docs/getting-started/ ...), because both sites have a page at / and would otherwise be counted as one
// (2026-11-08). The editor demo has its own GoatCounter site, counted from its server log.
//
// The built site ships in two places: here, and inside every Thingstudio install (the
// backend serves it at /docs/ for Help -> User guide). Only the public host counts:
// anything else -- the offline copy, Mike's LAN review server, someone running the
// editor from a laptop -- loads nothing, sends nothing. Matches the product's rule:
// no telemetry from the product, measurement is external only.
if (location.hostname === 'docs.thingstudio.net') {
    // Read by count.js when it loads, so it must be set before the script is added.
    window.goatcounter = { path: function (p) { return 'docs' + p; } };
    var s = document.createElement('script');
    s.async = 1;
    // Same snippet as the landing page: data-goatcounter names the count endpoint.
    s.dataset.goatcounter = 'https://ts-stats.minus1.com/count';
    s.src = 'https://ts-stats.minus1.com/count.js';
    document.head.appendChild(s);
}
