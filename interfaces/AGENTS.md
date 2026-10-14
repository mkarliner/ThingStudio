# Thingstudio interface specs

Shared rules are in the repo root `AGENTS.md`; `README.md` in this directory is the index and the working rules.
This file exists so an agent editing a spec here loads the rule automatically.

Read a spec before implementing code that emits, parses, stores or transmits what it defines, and run its
conformance test in the same change. Change an interface itself (an id, field, framing rule, descriptor shape or
API signature — adding or removing one) only with Mike's explicit permission in the session; adding vectors and
fixing an implementation that has drifted is allowed. Keep the specs readable: plain language, tables, a worked
example.
