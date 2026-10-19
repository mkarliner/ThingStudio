// SPDX-License-Identifier: Apache-2.0
// editor/src/compile-hook/wasi.ts
//
// A minimal WASI preview1 shim for the vendored MicroPython WASI module (micropython-wasi/). It implements
// only the calls the module imports, with no filesystem, network or environment: stdout/stderr go to
// buffers, argv is the command line, and proc_exit ends the run. Standard WebAssembly only, so the same
// code runs in the browser, in Node and in tests (no node:wasi).
//
// This is NOT the containment boundary. A runaway hook blocks the caller forever here; the worker that
// hosts this module is what enforces the wall-clock budget by terminating.

export interface WasiRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface Host {
  memory: WebAssembly.Memory;
}

const ERRNO = { SUCCESS: 0, BADF: 8, INVAL: 28, NOTSUP: 58 } as const;

function makeImports(args: readonly string[], host: Host): WebAssembly.Imports {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let stdout = "";
  let stderr = "";
  // Expose the captured streams to the caller through a mutable object.
  const streams = { get stdout() { return stdout; }, get stderr() { return stderr; } };
  (host as Host & { streams: typeof streams }).streams = streams;

  const view = (): DataView => new DataView(host.memory.buffer);
  const bytes = (): Uint8Array => new Uint8Array(host.memory.buffer);
  const u32 = (p: number, v: number): void => view().setUint32(p, v, true);
  const u64 = (p: number, v: bigint): void => view().setBigUint64(p, v, true);

  const wasi: Record<string, (...a: number[]) => number> = {
    args_sizes_get(argc, bufSize) {
      u32(argc, args.length);
      u32(bufSize, args.reduce((n, a) => n + enc.encode(a).length + 1, 0));
      return 0;
    },
    args_get(argv, buf) {
      let off = buf;
      args.forEach((a, i) => {
        const b = enc.encode(a);
        u32(argv + i * 4, off);
        bytes().set(b, off);
        view().setUint8(off + b.length, 0);
        off += b.length + 1;
      });
      return 0;
    },
    environ_sizes_get(count, bufSize) {
      u32(count, 0);
      u32(bufSize, 0);
      return 0;
    },
    environ_get() {
      return 0;
    },
    clock_time_get(_id, _precision, out) {
      // A monotonic-ish wall clock; hooks must not depend on it (determinism, SPEC §1).
      u64(out, BigInt(Date.now()) * 1_000_000n);
      return 0;
    },
    fd_write(fd, iovs, iovsLen, nwritten) {
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const p = iovs + i * 8;
        const buf = view().getUint32(p, true);
        const len = view().getUint32(p + 4, true);
        const chunk = dec.decode(bytes().slice(buf, buf + len));
        if (fd === 1) stdout += chunk;
        else if (fd === 2) stderr += chunk;
        total += len;
      }
      u32(nwritten, total);
      return 0;
    },
    fd_fdstat_get(_fd, ptr) {
      // filetype = 2 (character device), no flags, all rights.
      for (let i = 0; i < 24; i++) view().setUint8(ptr + i, 0);
      view().setUint8(ptr, 2);
      u64(ptr + 8, 0xffffffffffffffffn);
      u64(ptr + 16, 0xffffffffffffffffn);
      return 0;
    },
    fd_close() {
      return 0;
    },
    fd_seek() {
      return ERRNO.INVAL;
    },
    fd_sync() {
      return 0;
    },
    fd_read() {
      return ERRNO.BADF;
    },
    fd_readdir() {
      return ERRNO.BADF;
    },
    fd_prestat_get() {
      return ERRNO.BADF;
    },
    fd_prestat_dir_name() {
      return ERRNO.BADF;
    },
    poll_oneoff(_in, _out, _nsubs, nevents) {
      u32(nevents, 0);
      return 0;
    },
    proc_exit(code) {
      throw { wasiExit: code };
    },
    sched_yield() {
      return 0;
    },
    path_open() {
      return ERRNO.NOTSUP;
    },
    path_create_directory() {
      return ERRNO.NOTSUP;
    },
    path_filestat_get() {
      return ERRNO.NOTSUP;
    },
    path_readlink() {
      return ERRNO.NOTSUP;
    },
    path_remove_directory() {
      return ERRNO.NOTSUP;
    },
    path_rename() {
      return ERRNO.NOTSUP;
    },
    path_unlink_file() {
      return ERRNO.NOTSUP;
    },
  };

  return {
    wasi_snapshot_preview1: wasi,
    // The wheel's build added a host-function bridge module; the hook has no host capabilities, so these
    // stubs are never meaningfully called (a hook importing `host` would get an error from `host_call`).
    micropython_wasm: {
      host_result_cap: () => 0,
      host_call: () => 1,
    },
  };
}

function finish(host: Host & { streams?: { stdout: string; stderr: string } }, instance: WebAssembly.Instance): WasiRunResult {
  host.memory = instance.exports.memory as WebAssembly.Memory;
  let exitCode = 0;
  try {
    (instance.exports._start as () => void)();
  } catch (err) {
    const sentinel = err as { wasiExit?: number };
    if (typeof sentinel?.wasiExit === "number") exitCode = sentinel.wasiExit;
    else throw err;
  }
  return { stdout: host.streams?.stdout ?? "", stderr: host.streams?.stderr ?? "", exitCode };
}

/** Instantiate the module and run `args`. No timeout: the caller's worker owns that. */
export async function runWasi(wasmBytes: Uint8Array, args: readonly string[]): Promise<WasiRunResult> {
  const copy = new Uint8Array(wasmBytes.length);
  copy.set(wasmBytes);
  const host = {} as Host & { streams?: { stdout: string; stderr: string } };
  const module = await WebAssembly.compile(copy.buffer);
  const instance = await WebAssembly.instantiate(module, makeImports(args, host));
  return finish(host, instance);
}

/** Synchronous variant for the CLI, where check-flow is synchronous and has no worker. Containment: none --
 * a runaway hook hangs the command (Ctrl-C is the escape), unlike the editor's worker. */
export function runWasiSync(wasmBytes: Uint8Array, args: readonly string[]): WasiRunResult {
  const copy = new Uint8Array(wasmBytes.length);
  copy.set(wasmBytes);
  const host = {} as Host & { streams?: { stdout: string; stderr: string } };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(copy.buffer), makeImports(args, host));
  return finish(host, instance);
}
