// ─────────────────────────────────────────────────────────────────────────────
// Live call-audio relay (standalone — run this as its own process; it cannot
// live inside serverless Next because it holds long-lived WebSockets).
//
//   Twilio  ──(Media Streams, both tracks, μ-law 8k)──►  /twilio
//                                                          │  decode + mix
//   Browser ◄──────(PCM16 8k frames, JSON)───────────────  /listen
//
// Both sides authenticate with the same HMAC token the Next app signs
// (src/lib/media-stream.ts), bound to a per-call "room".
//
// Run:  MEDIA_STREAM_SECRET=... PORT=8787 node server/media-stream-server.mjs
// Deploy anywhere that allows persistent WS (Render/Fly/Railway/VPS) and expose
// it over wss://… then set MEDIA_STREAM_URL=wss://your-host in the Next app.
// Requires the `ws` package:  npm i ws
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.MEDIA_STREAM_SECRET || "";
if (!SECRET) {
  console.error("[media] MEDIA_STREAM_SECRET is required");
  process.exit(1);
}

function verifyToken(room, token) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${room}.${exp}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// room → { listeners:Set<ws>, buf:{inbound:number[], outbound:number[]} }
const rooms = new Map();
function room(name) {
  let r = rooms.get(name);
  if (!r) {
    r = { listeners: new Set(), buf: { inbound: [], outbound: [] } };
    rooms.set(name, r);
  }
  return r;
}
function cleanup(name) {
  const r = rooms.get(name);
  if (r && r.listeners.size === 0 && !r.twilioOpen) rooms.delete(name);
}

// G.711 μ-law byte → Int16 PCM sample.
function muLawToPcm(u) {
  u = ~u & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

const FRAME = 160; // 20ms @ 8kHz
const MAX_BUFFER = 8000; // 1s — drop oldest beyond this to avoid latency creep

// Mix paired 160-sample frames from both legs and push to listeners.
function drain(r) {
  const { inbound, outbound } = r.buf;
  // Keep buffers bounded so we never drift far behind the live call.
  if (inbound.length > MAX_BUFFER) inbound.splice(0, inbound.length - MAX_BUFFER);
  if (outbound.length > MAX_BUFFER) outbound.splice(0, outbound.length - MAX_BUFFER);

  while (inbound.length >= FRAME && outbound.length >= FRAME) {
    const a = inbound.splice(0, FRAME);
    const b = outbound.splice(0, FRAME);
    const out = Buffer.alloc(FRAME * 2);
    for (let i = 0; i < FRAME; i++) {
      let s = a[i] + b[i];
      if (s > 32767) s = 32767;
      else if (s < -32768) s = -32768;
      out.writeInt16LE(s, i * 2);
    }
    const msg = JSON.stringify({ event: "media", payload: out.toString("base64") });
    for (const ws of r.listeners) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }
}

function pushTrack(r, track, b64) {
  const bytes = Buffer.from(b64, "base64");
  const dst = track === "inbound" ? r.buf.inbound : r.buf.outbound;
  for (let i = 0; i < bytes.length; i++) dst.push(muLawToPcm(bytes[i]));
  drain(r);
}

const server = http.createServer((req, res) => {
  // Simple health check.
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wssTwilio = new WebSocketServer({ noServer: true });
const wssListen = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    socket.destroy();
    return;
  }
  const roomName = url.searchParams.get("room") || "";
  const token = url.searchParams.get("token") || "";
  if (!roomName || !verifyToken(roomName, token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (url.pathname === "/twilio") {
    wssTwilio.handleUpgrade(req, socket, head, (ws) =>
      wssTwilio.emit("connection", ws, roomName),
    );
  } else if (url.pathname === "/listen") {
    wssListen.handleUpgrade(req, socket, head, (ws) =>
      wssListen.emit("connection", ws, roomName),
    );
  } else {
    socket.destroy();
  }
});

// ── Twilio side: receive media, decode + mix ─────────────────────────────────
wssTwilio.on("connection", (ws, roomName) => {
  const r = room(roomName);
  r.twilioOpen = true;
  ws.on("message", (raw) => {
    let evt;
    try {
      evt = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (evt.event === "media" && evt.media?.payload) {
      // track is "inbound" (homeowner) or "outbound" (the AI agent)
      pushTrack(r, evt.media.track === "outbound" ? "outbound" : "inbound", evt.media.payload);
    }
  });
  ws.on("close", () => {
    r.twilioOpen = false;
    r.buf.inbound.length = 0;
    r.buf.outbound.length = 0;
    for (const l of r.listeners) {
      if (l.readyState === l.OPEN) l.send(JSON.stringify({ event: "ended" }));
    }
    cleanup(roomName);
  });
  ws.on("error", () => {});
});

// ── Browser side: receive mixed PCM frames ───────────────────────────────────
wssListen.on("connection", (ws, roomName) => {
  const r = room(roomName);
  r.listeners.add(ws);
  ws.send(JSON.stringify({ event: "ready" }));
  ws.on("close", () => {
    r.listeners.delete(ws);
    cleanup(roomName);
  });
  ws.on("error", () => {});
});

server.listen(PORT, () => {
  console.log(`[media] live-audio relay listening on :${PORT}`);
});
