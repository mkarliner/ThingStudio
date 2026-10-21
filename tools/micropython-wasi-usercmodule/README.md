# micropython-wasm host usercmodule (vendored)

The C usercmodule `simonw/micropython-wasm` adds to MicroPython's WASI build
(`micropython_wasm/usercmodule/host/`). The compiled module imports a
`micropython_wasm.host_call` / `host_result_cap` host module; Thingstudio's WASI shim stubs both, so the hook
interpreter has no host capabilities beyond stdout and argv.

Vendored unmodified from <https://github.com/simonw/micropython-wasm> (Apache-2.0) so
`tools/build_micropython_wasi.py` can reproduce the pinned artifact. See `docs/third-party-licenses.md`.
