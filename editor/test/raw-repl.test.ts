// SPDX-License-Identifier: Apache-2.0
// editor/test/raw-repl.test.ts
//
// The browser raw-REPL client (src/raw-repl/raw-repl.ts) against a scripted fake port: the cases of
// backend/test/test_raw_repl.py, ported with the code, plus catchPrompt() and the install plan.
import { describe, expect, it } from "vitest";
import {
  CATCH_STEP,
  ENTER_STEP,
  RawReplError,
  catchPrompt,
  classifyReply,
  enterRawRepl,
  execRaw,
  hardReset,
  installRuntime,
  isFrozenImage,
  removeFlow,
  writeFileChunked,
  type ClosableLink,
} from "../src/raw-repl/raw-repl.js";
import { RUNTIME_BUILD_FILE, frozenInstall, fullInstall, type RuntimeSources } from "../src/raw-repl/runtime-files.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const b = (s: string): Uint8Array => enc.encode(s);
const BANNER = "raw REPL; CTRL-B to exit\r\n>";
const FAST = { enterMs: 200, execMs: 200 };

/** Pops scripted reply chunks in order, whatever is asked for; records every write. */
class FakePort implements ClosableLink {
  written: Uint8Array[] = [];
  closed = false;
  constructor(
    public script: (Uint8Array | string)[] = [],
    private readonly failWritesAfter = Infinity,
  ) {}
  async write(data: Uint8Array): Promise<void> {
    if (this.written.length >= this.failWritesAfter) throw new Error("Write timeout");
    this.written.push(data);
  }
  async read(timeoutMs: number): Promise<Uint8Array> {
    const next = this.script.shift();
    if (next === undefined) {
      await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 5)));
      return new Uint8Array();
    }
    return typeof next === "string" ? b(next) : next;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  text(): string[] {
    return this.written.map((w) => dec.decode(w));
  }
}

const ok = (stdout = "", stderr = ""): string => `OK${stdout}\x04${stderr}\x04>`;

describe("raw REPL", () => {
  it("enters raw REPL with two Ctrl-Cs and a Ctrl-A", async () => {
    const port = new FakePort([`\r\n${BANNER}`]);
    await enterRawRepl(port, FAST);
    expect(port.written).toEqual([new Uint8Array([3]), new Uint8Array([3]), new Uint8Array([1])]);
  });

  it("finds the banner across reads", async () => {
    await enterRawRepl(new FakePort(["\r\nraw REPL; ", "CTRL-B to exit\r\n>"]), FAST);
  });

  it("names the step and keeps what it saw when the banner never comes", async () => {
    const err = await enterRawRepl(new FakePort(["ESP-ROM:esp32s2-rc4-20191025\r\nwaiting for download\r\n"]), FAST).catch((e) => e);
    expect(err).toBeInstanceOf(RawReplError);
    expect(err.step).toBe(ENTER_STEP);
    expect(dec.decode(err.seen)).toContain("waiting for download");
    expect(classifyReply(err.seen)).toBe("esp_rom");
  });

  it("returns stdout from an exec", async () => {
    expect(dec.decode(await execRaw(new FakePort([ok("hello")]), "print('hello')", "step", 200))).toBe("hello");
  });

  it("fails on anything on stderr", async () => {
    const err = await execRaw(new FakePort([ok("", "Traceback: NameError")]), "x", "a test step", 200).catch((e) => e);
    expect(err.step).toBe("a test step");
    expect(err.message).toContain("NameError");
  });

  it("fails when the OK echo never comes", async () => {
    await expect(execRaw(new FakePort(["not the OK we expected"]), "1+1", "step", 200)).rejects.toBeInstanceOf(RawReplError);
  });

  it("keeps bytes that arrive in the same chunk as a marker", async () => {
    expect(dec.decode(await execRaw(new FakePort(["OKhel", "lo\x04\x04>"]), "x", "step", 200))).toBe("hello");
  });

  it("writes a file in base64 chunks that decode back to the data", async () => {
    const data = new Uint8Array(512).map((_, i) => i & 0xff);
    const port = new FakePort([ok(), ok(), ok(), ok()]);
    await writeFileChunked(port, "runtime.py", data, "pushing runtime.py");
    const execs = port.text().join("").split("\x04").slice(0, -1);
    expect(execs[0]).toBe("f=open('runtime.py','wb')");
    const chunks = execs.filter((e) => e.includes("a2b_base64"));
    expect(chunks.length).toBe(2);
    const decoded = chunks.map((c) => atob(c.slice(c.indexOf("b'") + 2, c.lastIndexOf("'")))).join("");
    expect(Uint8Array.from(decoded, (ch) => ch.charCodeAt(0))).toEqual(data);
    expect(execs.at(-1)).toBe("f.close()");
  });

  it("resets with machine.reset() and Ctrl-D, without reading", async () => {
    const port = new FakePort();
    await hardReset(port);
    expect(port.text()).toEqual(["import machine\nmachine.reset()", "\x04"]);
  });

  it("installs every file in order, then resets", async () => {
    const files = ["errors.py", "runtime.py", "main.py"].map((name) => ({ name, data: b(`${name} source`) }));
    const port = new FakePort([BANNER, ...Array(9).fill(ok())]);
    await installRuntime(port, files, { timeouts: FAST });
    expect(port.text().filter((t) => t.startsWith("f=open("))).toEqual(["f=open('errors.py','wb')", "f=open('runtime.py','wb')", "f=open('main.py','wb')"]);
    expect(port.text().slice(-2)).toEqual(["import machine\nmachine.reset()", "\x04"]);
  });

  it("removes stale files before pushing", async () => {
    const port = new FakePort([BANNER, ...Array(4).fill(ok())]);
    await installRuntime(port, [{ name: "errors.mpy", data: b("M") }], { timeouts: FAST, remove: ["errors.py"] });
    const texts = port.text();
    const removal = texts.findIndex((t) => t.includes("os.remove"));
    expect(removal).toBeGreaterThan(-1);
    expect(removal).toBeLessThan(texts.findIndex((t) => t.startsWith("f=open(")));
    expect(texts[removal]).toContain("'errors.py'");
  });

  it("stops at a mid-push failure without resetting", async () => {
    const port = new FakePort([BANNER, ok(), ok(), ok(), "NOT OK"]);
    const files = [{ name: "errors.py", data: b("e") }, { name: "runtime.py", data: b("r") }];
    await expect(installRuntime(port, files, { timeouts: FAST })).rejects.toBeInstanceOf(RawReplError);
    expect(port.text().some((t) => t.includes("machine.reset"))).toBe(false);
  });

  it("turns a stuck write into an attributed error", async () => {
    const port = new FakePort([BANNER], 3);
    const err = await installRuntime(port, [{ name: "runtime.py", data: b("x = 1\n") }], { timeouts: FAST }).catch((e) => e);
    expect(err.message).toContain("pushing runtime.py");
    expect(err.message).toContain("stopped accepting data");
  });

  it("splits long pastes into 256-byte pieces", async () => {
    const port = new FakePort([ok()]);
    await execRaw(port, "a".repeat(600), "big", 500);
    expect(port.written.map((w) => w.length)).toEqual([256, 256, 88, 1]);
  });

  it("reports progress per file", async () => {
    const seen: [number, number, string][] = [];
    await installRuntime(new FakePort([BANNER, ...Array(6).fill(ok())]), [{ name: "a.py", data: b("1") }, { name: "b.py", data: b("2") }], {
      timeouts: FAST,
      onProgress: (i, n, name) => seen.push([i, n, name]),
    });
    expect(seen).toEqual([[1, 2, "a.py"], [2, 2, "b.py"]]);
  });

  it("tells a ThingStudio image from a stock board", async () => {
    expect(await isFrozenImage(new FakePort([BANNER, ok("frozen\r\n")]), FAST)).toBe(true);
    expect(await isFrozenImage(new FakePort([BANNER, ok("stock\r\n")]), FAST)).toBe(false);
  });

  it("removes the saved flow and resets", async () => {
    const port = new FakePort([BANNER, ok("THINGSTUDIO_FLOW_REMOVED\r\n")]);
    await removeFlow(port, FAST);
    expect(port.text().join("")).toContain("/_flow.mpy");
    expect(port.text().slice(-2)).toEqual(["import machine\nmachine.reset()", "\x04"]);
  });

  it.each([
    ["", "silent"],
    ["\r\n  \r\n", "silent"],
    ["\r\nMicroPython v1.24.1 on 2024-11-29; ESP32S2 module with ESP32S2\r\n>>> ", "micropython"],
    ["Traceback (most recent call last):\r\nSyntaxError: invalid syntax\r\n", "micropython"],
    ["\r\nAdafruit CircuitPython 9.1.4 on 2024-09-17; ...\r\n>>> ", "circuitpython"],
    ["ets Jun  8 2016 00:22:57\r\n\r\nrst:0x1 (POWERON_RESET)", "esp_rom"],
    ["Hello from Arduino loop 42\r\n", "other"],
  ])("classifies %j as %s", (seen, expected) => {
    expect(classifyReply(b(seen))).toBe(expected);
  });
});

describe("catching a prompt", () => {
  it("keeps sending Ctrl-C until a prompt answers, and returns the open link", async () => {
    const port = new FakePort(["", "", "\r\n>>> "]);
    const statuses: string[] = [];
    const link = await catchPrompt(async () => port, Date.now() + 2000, (s) => statuses.push(s));
    expect(link).toBe(port);
    expect(port.written.length).toBe(3);
    expect(statuses.length).toBe(1);
  });

  it("reopens the port when it goes away", async () => {
    let opens = 0;
    const gone: ClosableLink = { write: async () => { throw new Error("device lost"); }, read: async () => new Uint8Array(), close: async () => undefined };
    const back = new FakePort(["KeyboardInterrupt\r\n>>> "]);
    const link = await catchPrompt(async () => (opens++ === 0 ? gone : back), Date.now() + 2000, () => undefined);
    expect(link).toBe(back);
    expect(opens).toBe(2);
  });

  it("gives up at the deadline, names the step, and closes the port", async () => {
    const port = new FakePort();
    const err = await catchPrompt(async () => port, Date.now() + 100, () => undefined).catch((e) => e);
    expect(err.step).toBe(CATCH_STEP);
    expect(port.closed).toBe(true);
  });
});

describe("the install plan", () => {
  const sources: RuntimeSources = {
    files: [{ name: "errors.py", source: "E" }, { name: "listener.py", source: "L" }],
    mainFile: "main.py",
    bootScript: "import listener\nlistener.main()\n",
    legacyRootFiles: ["mqtt_as.py"],
  };

  it("swaps in bytecode where it has it, and removes the other format", () => {
    const plan = fullInstall(sources, new Map([["errors.mpy", b("MPY")]]), "abc123");
    expect(plan.files.map((f) => f.name)).toEqual(["errors.mpy", "listener.py", "main.py", RUNTIME_BUILD_FILE]);
    expect(plan.remove).toEqual(["errors.py", "listener.mpy", "mqtt_as.py", "mqtt_as.mpy"]);
    expect(dec.decode(plan.files[3]!.data)).toBe("abc123");
  });

  it("leaves out the build stamp when there is no SHA", () => {
    expect(fullInstall(sources, new Map(), null).files.some((f) => f.name === RUNTIME_BUILD_FILE)).toBe(false);
  });

  it("writes only the boot script on a ThingStudio image", () => {
    const plan = frozenInstall(sources);
    expect(plan.files.map((f) => f.name)).toEqual(["main.py"]);
    expect(plan.remove).toEqual([]);
  });
});

describe("catching a prompt on a port that won't open", () => {
  it("says the port wouldn't open, with the reason, instead of 'no reply'", async () => {
    const err = await catchPrompt(async () => { throw new Error("The port is already open."); }, Date.now() + 400, () => undefined).catch((e) => e);
    expect(err.step).toBe("opening the port");
    expect(err.message).toContain("already open");
  });
});

describe("a board already running the runtime", () => {
  it("is recognised by its frames or LISTENER_ lines, not called other firmware", () => {
    expect(classifyReply(b("F64:AAEC\n"))).toBe("runtime");
    expect(classifyReply(b("LISTENER_READY\r\n"))).toBe("runtime");
  });

  it("is asked to stop with what the caller adds after each Ctrl-C", async () => {
    const port = new FakePort(["", "\r\n>>> "]);
    const extra = b("\nF64:stop\n");
    await catchPrompt(async () => port, Date.now() + 2000, () => undefined, extra);
    expect(port.text()).toEqual(["\x03", "\nF64:stop\n", "\x03", "\nF64:stop\n"]);
  });
});
