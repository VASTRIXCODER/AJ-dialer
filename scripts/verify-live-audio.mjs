// ─────────────────────────────────────────────────────────────────────────────
// End-to-end verification for the live-audio relay (server/media-stream-server.mjs).
//
// It boots the REAL relay, then exercises the exact contract the production path
// relies on, WITHOUT needing Twilio or a browser:
//
//   1. /health responds                                  (Render health check)
//   2. token signed like src/lib/media-stream.ts is accepted by the relay
//   3. a bad/forged token is rejected (401) on /twilio AND /listen
//   4. μ-law frames pushed on both tracks (as Twilio Media Streams sends them)
//      arrive on the listener side as correctly-mixed PCM16
//   5. when the Twilio side closes, listeners get an {event:"ended"} signal
//
// This proves the signing↔verification handshake, the μ-law decode, the mixer,
// and the framing all agree. Run:  npm run verify:live-audio
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.join(__dirname, "..", "server", "media-stream-server.mjs");

const SECRET = "verify-secret-" + crypto.randomBytes(8).toString("hex");
const PORT = 8799;
const HOST = `127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (m) => { passed++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m) => { failed++; console.log(`  \x1b[31m✗ ${m}\x1b[0m`); };

// ── Mirror of src/lib/media-stream.ts signing (must stay byte-identical) ──────
function signToken(room, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac("sha256", SECRET).update(`${room}.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

// ── Mirror of the relay's μ-law decoder (to compute the expected mix) ─────────
function muLawToPcm(u) {
  u = ~u & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return u & 0x80 ? 0x84 - t : t - 0x84;
}
const clamp16 = (s) => (s > 32767 ? 32767 : s < -32768 ? -32768 : s);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://${HOST}/health`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body: body.trim() }));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(1000, () => { req.destroy(); resolve(null); });
  });
}

async function waitForRelay(triesLeft = 50) {
  for (let i = 0; i < triesLeft; i++) {
    const h = await getHealth();
    if (h && h.status === 200) return true;
    await sleep(100);
  }
  return false;
}

// Resolves to "open" | "rejected" — does the upgrade succeed or get 401'd?
function probeUpgrade(pathName, room, token) {
  return new Promise((resolve) => {
    const url = `ws://${HOST}${pathName}?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    const done = (r) => { try { ws.close(); } catch { /* noop */ } resolve(r); };
    ws.on("open", () => done("open"));
    ws.on("unexpected-response", () => done("rejected"));
    ws.on("error", () => done("rejected"));
    setTimeout(() => done("timeout"), 2000);
  });
}

async function main() {
  console.log(`\nLive-audio relay verification (port ${PORT})\n`);

  const child = spawn("node", [RELAY], {
    env: { ...process.env, MEDIA_STREAM_SECRET: SECRET, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let relayLog = "";
  child.stdout.on("data", (d) => (relayLog += d));
  child.stderr.on("data", (d) => (relayLog += d));

  const cleanup = () => { try { child.kill("SIGKILL"); } catch { /* noop */ } };

  try {
    // 1 ── relay boots + health ------------------------------------------------
    if (await waitForRelay()) ok("relay boots and /health returns 200 ok");
    else { bad("relay never became healthy — log:\n" + relayLog); return; }

    const room = "lh-verify";
    const goodToken = signToken(room);

    // 2 ── auth: forged/empty tokens are rejected ------------------------------
    const forged = await probeUpgrade("/listen", room, "000.deadbeef");
    if (forged === "rejected") ok("forged token rejected on /listen (401)");
    else bad(`forged token NOT rejected on /listen (got "${forged}")`);

    const forgedTw = await probeUpgrade("/twilio", room, "000.deadbeef");
    if (forgedTw === "rejected") ok("forged token rejected on /twilio (401)");
    else bad(`forged token NOT rejected on /twilio (got "${forgedTw}")`);

    // 3 ── auth: a correctly-signed token is accepted --------------------------
    const accepted = await probeUpgrade("/listen", room, goodToken);
    if (accepted === "open") ok("correctly-signed token accepted on /listen");
    else bad(`valid token NOT accepted on /listen (got "${accepted}")`);

    // 4 ── full media path: μ-law in (both tracks) → mixed PCM16 out -----------
    // Distinct byte per track so we verify a real MIX, not a passthrough.
    const IN_BYTE = 0x00;   // homeowner (inbound)
    const OUT_BYTE = 0xef;  // rep / agent (outbound)
    const expectedSample = clamp16(muLawToPcm(IN_BYTE) + muLawToPcm(OUT_BYTE));
    const FRAME = 160;
    const frame = (byte) => Buffer.alloc(FRAME, byte).toString("base64");

    const mediaResult = await new Promise((resolve) => {
      const lurl = `ws://${HOST}/listen?room=${room}&token=${encodeURIComponent(goodToken)}`;
      const listener = new WebSocket(lurl);
      let sawReady = false;
      let sawEnded = false;
      let firstMixed = null;
      const finish = (r) => { try { listener.close(); } catch { /* noop */ } resolve({ sawReady, sawEnded, firstMixed, ...r }); };

      listener.on("message", (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.event === "ready") {
          sawReady = true;
          // Listener is attached — now act as Twilio and push both tracks.
          const turl = `ws://${HOST}/twilio?room=${room}&token=${encodeURIComponent(goodToken)}`;
          const tw = new WebSocket(turl);
          tw.on("open", async () => {
            for (let i = 0; i < 3; i++) {
              tw.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: frame(IN_BYTE) } }));
              tw.send(JSON.stringify({ event: "media", media: { track: "outbound", payload: frame(OUT_BYTE) } }));
              await sleep(20);
            }
            await sleep(150);
            tw.close(); // should trigger an {event:"ended"} to the listener
          });
          tw.on("error", () => finish({ error: "twilio-side ws error" }));
        } else if (m.event === "media" && m.payload) {
          if (!firstMixed) firstMixed = Buffer.from(m.payload, "base64");
        } else if (m.event === "ended") {
          sawEnded = true;
          finish({});
        }
      });
      listener.on("error", () => finish({ error: "listener ws error" }));
      setTimeout(() => finish({ error: "timeout waiting for media" }), 4000);
    });

    if (mediaResult.sawReady) ok("listener receives {event:'ready'} on connect");
    else bad("listener never received 'ready'");

    if (mediaResult.firstMixed && mediaResult.firstMixed.length === FRAME * 2)
      ok(`mixed PCM16 frame received (${mediaResult.firstMixed.length} bytes = 160 samples × 2)`);
    else bad(`mixed PCM frame wrong/absent (${mediaResult.firstMixed?.length ?? 0} bytes)`);

    if (mediaResult.firstMixed) {
      const got = mediaResult.firstMixed.readInt16LE(0);
      if (got === expectedSample)
        ok(`mix is correct: muLaw(0x00)+muLaw(0xEF) = ${got} (both legs summed)`);
      else bad(`mix wrong: expected ${expectedSample}, got ${got}`);
    }

    if (mediaResult.sawEnded) ok("listener notified {event:'ended'} when the call leg closes");
    else bad("listener never received 'ended' after Twilio side closed");

  } finally {
    cleanup();
  }

  console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
