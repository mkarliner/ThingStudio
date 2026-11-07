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
    // the salt is hex on the wire and BYTES in the key derivation (board_settings.derive_key), so the page
    // has to unhex it first -- hashing the hex text derives a different key and every login answers 401
    const saltBytes = (mod as unknown as { unhex: (s: string) => number[] }).unhex(salt);
    let k: number[] = saltBytes.concat(mod.utf8(password));
    for (let i = 0; i < 2000; i++) k = Array.from(mod.sha(k));
    let rk: Buffer = Buffer.concat([Buffer.from(salt, "hex"), Buffer.from(password)]);
    for (let i = 0; i < 2000; i++) rk = createHash("sha256").update(rk).digest();
    eq("salt is hashed as bytes, not as its hex text", k, rk);
    eq("2000-iteration key chain", k, rk);
    // session_key = HMAC(key, nonce + " remote display input v1"); token = HMAC(session_key, "open session v1")
    const nonce = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const sk = Buffer.from(mod.hmac(rk, Buffer.concat([nonce, Buffer.from(" remote display input v1")])));
    eq("session key", sk, createHmac("sha256", rk).update(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))
        .update(" remote display input v1").digest());
    const token = Buffer.from(mod.hmac(sk, Buffer.from("open session v1")));
    eq("token", token, createHmac("sha256", sk).update("open session v1").digest());
  });

  it("encodes the input envelope the board decodes: {\"c\":n,\"m\":{...}}", () => {
    // ts_remote._check() takes the counter from "c" and hands data["m"] to _dispatch. The page used to send the
    // fields flat ({"c":n,"type":"tap"}), which decoded as None -- every tap/nav/ctl answered "message is not an
    // object" and was dropped, on a board that otherwise looked healthy (phone against the S3, 2026-11-07).
    const src = readFileSync(PAGE, "utf8");
    const app = /<script id="app">([\s\S]*?)<\/script>/.exec(src)?.[1];
    if (app === undefined) throw new Error("the app block is missing from the page");
    const sendSrc = /function send\(obj\)[\s\S]*?\n\}/.exec(app)?.[0];
    if (sendSrc === undefined) throw new Error("send() is missing from the page");

    const crypto = pageCrypto();
    const sessionKey = createHmac("sha256", "k").update("m").digest();
    const sent: string[] = [];
    const socket = { readyState: 1, send: (line: string) => sent.push(line) };
    const make = new Function("socket", "sessionKey", "hexs", "hmac", "utf8", "counter", `${sendSrc}; return send;`);
    const send = make(socket, sessionKey, (crypto as never as { hexs: (b: number[]) => string }).hexs,
                      crypto.hmac, crypto.utf8, 0) as (o: unknown) => void;

    send({ type: "tap", wid: "boop", phase: "down" });
    expect(sent).toHaveLength(1);
    const line = sent[0] ?? "";
    const cut = line.indexOf("\n");
    expect(cut).toBeGreaterThan(0);
    const body = line.slice(0, cut);
    const sig = line.slice(cut + 1);
    const parsed = JSON.parse(body);
    expect(parsed.c).toBe(1);
    expect(parsed.m).toEqual({ type: "tap", wid: "boop", phase: "down" });
    expect(sig).toBe(createHmac("sha256", sessionKey).update(body).digest("hex"));
  });

  it("is what the board serves: page_data.py holds this page's current gzip", () => {
    const raw = readFileSync(PAGE);
    const out = execFileSync("python3", [join(here, "..", "..", "tools", "build_remote_page.py"), "--check"]).toString().trim();
    expect(out.startsWith("current:"), out).toBe(true); // "stale" says the tool must be rerun
    expect(out).toContain(String(raw.length));
  });
});
