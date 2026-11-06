// SPDX-License-Identifier: Apache-2.0
// editor/test/remote-page-crypto.test.ts
//
// The remote display's phone page (device-runtime/src/vendor/thingstudio_remote/page/remote.html) is served
// over plain http, where crypto.subtle does not exist, so it ships a hand-written SHA-256 and HMAC-SHA256.
// This test runs exactly that block (the <script id="crypto"> part, no DOM needed) against Node's own
// crypto: RFC 4231's NIST vectors, key/block boundary shapes, the 2000-iteration TSAUTH1 key chain, and the
// session-key derivation the page and ts_remote share. The page's gzip also has to be what the build tool
// currently embeds, so a stale page_data.py fails loudly (bring-up blocker otherwise).

import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = new globalThis.URL(".", import.meta.url).pathname;
const PAGE = join(here, "..", "..", "device-runtime", "src", "vendor", "thingstudio_remote", "page", "remote.html");

function pageCrypto(): {
  utf8: (s: string) => number[];
  sha: (b: number[] | Buffer) => number[];
  hmac: (k: number[] | Buffer, m: number[] | Buffer) => number[];
} {
  const src = readFileSync(PAGE, "utf8");
  const script = /<script id="crypto">([\s\S]*?)<\/script>/.exec(src);
  if (script === null) throw new Error("the crypto block is missing from the page");
  return new Function(`${script[1]}; return {utf8, sha, hmac, hexs, unhex};`)() as {
    utf8: (s: string) => number[];
    sha: (b: number[] | Buffer) => number[];
    hmac: (k: number[] | Buffer, m: number[] | Buffer) => number[];
    hexs: (b: ArrayLike<number>) => string;
    unhex: (s: string) => number[];
  };
}

describe("the remote page's hand-written SHA-256/HMAC (no crypto.subtle over plain http)", () => {
  const mod = pageCrypto() as unknown as {
    utf8: (s: string) => number[];
    sha: (b: ArrayLike<number>) => number[];
    hmac: (k: ArrayLike<number>, m: ArrayLike<number>) => number[];
  };

  const eq = (name: string, got: ArrayLike<number>, want: Buffer) => {
    expect(Buffer.from(got as number[]).toString("hex"), name).toBe(want.toString("hex"));
  };

  it("matches RFC 4231's NIST vectors", () => {
    const tc1 = Buffer.alloc(20, 0x0b);
    eq("tc1", mod.hmac(tc1, Buffer.from("what do ya want for nothing?")), createHmac("sha256", tc1).update("what do ya want for nothing?").digest());
    const tc2k = Buffer.from("Jefe");
    eq("tc2", mod.hmac(tc2k, Buffer.from("what do ya want for nothing?")), createHmac("sha256", tc2k).update("what do ya want for nothing?").digest());
    const tc3 = { k: Buffer.alloc(131, 0xaa), d: Buffer.alloc(50, 0xdd) };
    eq("tc3", mod.hmac(tc3.k, tc3.d), createHmac("sha256", tc3.k).update(tc3.d).digest());
    // tc6/tc7: a key larger than the hash block, pre-hashed
    const tc6k = Buffer.alloc(131, 0xaa);
    eq("tc6", mod.hmac(tc6k, Buffer.from("Test Using Larger Than Block-Size Key - Hash Key First")),
        createHmac("sha256", tc6k).update("Test Using Larger Than Block-Size Key - Hash Key First").digest());
    const tc7k = Buffer.alloc(131, 0xaa);
    const tc7d = "This is RFC 4231 Test Case #7".repeat(4);
    eq("tc7", mod.hmac(tc7k, Buffer.from(tc7d)), createHmac("sha256", tc7k).update(tc7d).digest());
  });

  it("matches across message shapes the login exercises", () => {
    for (const n of [0, 55, 56, 63, 64, 65, 5000]) {
      const msg = Buffer.alloc(n, 0x64);
      eq(`sha ${n} bytes`, mod.sha(Array.from(msg)), createHash("sha256").update(msg).digest());
    }
  });

  it("derives the same session key the board's ts_remote derives", () => {
    // TSAUTH1: key = sha256^N(salt + password); 2000 iterations is board_settings._ITERATIONS
    const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const password = "sample-phone-password";
    let k: number[] = mod.utf8(salt + password);
    for (let i = 0; i < 2000; i++) k = Array.from(mod.sha(k));
    let rk: Buffer = Buffer.from(salt + password);
    for (let i = 0; i < 2000; i++) rk = createHash("sha256").update(rk).digest();
    eq("2000-iteration key chain", k, rk);
    // session_key = HMAC(key, nonce + " remote display input v1"); token = HMAC(session_key, "open session v1")
    const nonce = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const sk = Buffer.from(mod.hmac(rk, Buffer.concat([nonce, Buffer.from(" remote display input v1")])));
    eq("session key", sk, createHmac("sha256", rk).update(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))
        .update(" remote display input v1").digest());
    const token = Buffer.from(mod.hmac(sk, Buffer.from("open session v1")));
    eq("token", token, createHmac("sha256", sk).update("open session v1").digest());
  });

  it("is what the board serves: page_data.py holds this page's current gzip", () => {
    const raw = readFileSync(PAGE);
    const out = execFileSync("python3", [join(here, "..", "..", "tools", "build_remote_page.py"), "--check"]).toString().trim();
    expect(out.startsWith("current:"), out).toBe(true); // "stale" says the tool must be rerun
    expect(out).toContain(String(raw.length));
  });
});
