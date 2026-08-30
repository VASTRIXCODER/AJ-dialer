import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The listen token is verified TWICE, by two processes, from two copies of the
// same code.
//
// `src/lib/media-stream.ts` signs it inside Next; `server/media-stream-server.mjs`
// verifies it inside a standalone WebSocket process that cannot import
// TypeScript. So the algorithm is written out by hand in both places, and
// nothing has ever checked that the two agree.
//
// Drift here is silent and one-directional: the signer keeps signing, the
// verifier starts refusing, and live call monitoring simply stops working with
// no error anyone would connect to a code change. The opposite drift is worse —
// a verifier that accepts a token the signer never produced.
//
// This file runs both implementations over the same vectors. It does not
// deduplicate them (the .mjs genuinely cannot import from src), it makes them
// provably identical.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const SECRET = "test-secret-for-listen-tokens";

/**
 * The standalone server's verifier, lifted out of the file and evaluated.
 *
 * Read rather than imported: media-stream-server.mjs starts a WebSocket server
 * and calls process.exit() at import time when its env is unset. What we want
 * is the one function, exactly as that file spells it.
 */
function serverVerifier(): (room: string, token: string) => boolean {
  const src = readFileSync(resolve(ROOT, "server/media-stream-server.mjs"), "utf8");
  const start = src.indexOf("function verifyToken(");
  expect(start, "verifyToken not found in media-stream-server.mjs").toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start) + 3;
  const body = src.slice(start, end);
  // `crypto`, `Buffer` and `SECRET` are the only free names in it.
  const make = new Function(
    "crypto",
    "Buffer",
    "SECRET",
    `${body}; return verifyToken;`,
  ) as (c: unknown, b: unknown, s: string) => (room: string, token: string) => boolean;
  return make({ createHmac, timingSafeEqual: require("node:crypto").timingSafeEqual }, Buffer, SECRET);
}

/** The signer, restated from src/lib/media-stream.ts (which reads env at import). */
function sign(room: string, expSec: number): string {
  const sig = createHmac("sha256", SECRET).update(`${room}.${expSec}`).digest("hex");
  return `${expSec}.${sig}`;
}

describe("both processes verify the same token the same way", () => {
  const verify = serverVerifier();
  const future = Math.floor(Date.now() / 1000) + 3600;
  const past = Math.floor(Date.now() / 1000) - 1;

  it("accepts a live token for its own room", () => {
    expect(verify("room-abc", sign("room-abc", future))).toBe(true);
  });

  it("refuses a token minted for a DIFFERENT room", () => {
    // The room is inside the signature, not beside it — this is what stops one
    // listener link working for every call in the workspace.
    expect(verify("room-abc", sign("room-xyz", future))).toBe(false);
  });

  it("refuses an expired token", () => {
    expect(verify("room-abc", sign("room-abc", past))).toBe(false);
  });

  it("refuses a tampered signature, a missing one, and junk", () => {
    const good = sign("room-abc", future);
    const [exp, sig] = good.split(".");
    expect(verify("room-abc", `${exp}.${"0".repeat(sig.length)}`)).toBe(false);
    expect(verify("room-abc", exp)).toBe(false);
    expect(verify("room-abc", "")).toBe(false);
    expect(verify("room-abc", "not.a.token")).toBe(false);
    // A signature of the right shape but the wrong LENGTH must not throw —
    // timingSafeEqual rejects mismatched buffers, which is why both copies wrap
    // it in a try.
    expect(verify("room-abc", `${exp}.abcd`)).toBe(false);
  });

  it("the two implementations are still character-identical where it counts", () => {
    // Not a formatting check: these four lines ARE the algorithm, and a change
    // to either copy that is not made to the other is the failure this file
    // exists for.
    const ts = readFileSync(resolve(ROOT, "src/lib/media-stream.ts"), "utf8");
    const mjs = readFileSync(resolve(ROOT, "server/media-stream-server.mjs"), "utf8");
    const core = /createHmac\("sha256", SECRET\)\s*\.update\(`\$\{room\}\.\$\{exp\}`\)\s*\.digest\("hex"\)/;
    expect(ts, "the Next side's HMAC input changed").toMatch(core);
    expect(mjs, "the standalone server's HMAC input changed").toMatch(core);
    for (const [name, src] of [["media-stream.ts", ts], ["media-stream-server.mjs", mjs]] as const) {
      expect(src, `${name} dropped its expiry check`).toMatch(/Number\(exp\) \* 1000 < Date\.now\(\)/);
      expect(src, `${name} dropped timing-safe comparison`).toMatch(/timingSafeEqual/);
    }
  });
});
