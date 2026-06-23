# Live call-audio listening (Twilio Media Streams)

Lets a supervisor **hear an in-progress call live, without interrupting it** —
works for both **AI (ElevenLabs) calls** and **human rep↔customer calls**. It's
the real-audio counterpart to the live transcript ("Read aloud") and to
"Take over / Transfer" (which join and hand the call off).

## How it works

```
Twilio call  (AI ⇄ homeowner,  or  rep ⇄ homeowner)
      │  Next app calls Twilio REST: calls(sid).streams.create({ track: both_tracks })
      │  → Twilio forks BOTH legs as Media Streams (does NOT disturb the call)
      ▼
wss://your-relay/twilio   ← standalone relay (server/media-stream-server.mjs)
      │  μ-law → PCM16, mixes the two legs, bounded ~1s jitter buffer
      ▼
wss://your-relay/listen   → supervisor's browser (Web Audio playback)
```

- **For human calls**, the rep's browser passes a `MonitorId` when it dials; the
  TwiML voice route binds that to the agent-leg `CallSid` (`attachHumanCallSid`),
  so the listen endpoint knows which leg to fork. `both_tracks` on that leg =
  rep (inbound) + homeowner (outbound).
- **For AI calls**, the listen endpoint resolves the ElevenLabs conversation's
  `CallSid` (store → DB → API) and forks that.
- The relay authenticates Twilio **and** the browser with the same short-lived
  HMAC token the app signs (`src/lib/media-stream.ts`), bound to a per-call room.
- It's **gated**: with no relay configured the "Listen live" button doesn't even
  appear, and the endpoint returns a clear 503. Access requires `monitor.listen`
  (managers/admins/owners), scoped to the supervisor's own org.

## Architecture: two services

| Piece | Runs on | Needs |
| --- | --- | --- |
| **Next app** (starts the fork via Twilio REST, signs tokens, serves the UI) | Vercel | Twilio REST creds + `MEDIA_STREAM_URL` + `MEDIA_STREAM_SECRET` |
| **Relay** (holds the long-lived WebSockets, mixes audio) | Render / Fly / Railway / VPS | `MEDIA_STREAM_SECRET` (+ `PORT`, auto on Render) |

The relay **cannot** live inside serverless Next — it holds persistent
WebSockets. It runs as its own always-on process. `ws` is bundled (it's a
project dependency), so a plain `npm install` on the host is enough.

## 1. Deploy the relay on Render

**Easiest — Blueprint (uses `render.yaml` in this repo):**

1. Render → **New → Blueprint** → pick this repo.
2. When prompted, paste a long random **`MEDIA_STREAM_SECRET`** (e.g.
   `openssl rand -hex 32`). Save it — the Next app needs the *same* value.
3. Deploy. Render builds with `npm install` and starts with `npm run relay`.

**Manual — Web Service:**

- **Build command:** `npm install`
- **Start command:** `npm run relay`  (= `node server/media-stream-server.mjs`)
- **Health check path:** `/health`
- **Env var:** `MEDIA_STREAM_SECRET` = your long random secret
- **Do NOT set `PORT`** — Render injects it and the relay reads `process.env.PORT`.

Render gives the service a URL like `https://aj-dialer-media-relay.onrender.com`.
Your `wss` origin is the **same host with `wss://`** (no port, no path):
`wss://aj-dialer-media-relay.onrender.com`. Verify it's up:
`curl https://aj-dialer-media-relay.onrender.com/health` → `ok`.

> ⚠️ **Don't use Render's Free plan.** Free services sleep after ~15 min idle and
> take ~50s to wake, so Twilio's media WebSocket times out on the first call
> after idle and you hear nothing. Use **Starter** (stays warm), or keep a free
> instance awake with an external cron pinging `/health` every few minutes.

## 2. Point the Next app (Vercel) at it

In Vercel → Project → Settings → **Environment Variables**, add:

| Variable | Value | Notes |
| --- | --- | --- |
| `MEDIA_STREAM_URL` | `wss://aj-dialer-media-relay.onrender.com` | **`wss://`**, no trailing slash, no path |
| `MEDIA_STREAM_SECRET` | *(the exact same secret you set on Render)* | mismatch ⇒ silent 401 on the WS upgrade |

Twilio **REST** must also be configured — it's what starts the fork. These are
the same creds your dialing already uses:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_ID`.

**Redeploy** after changing Vercel env vars (they only take effect on a new build).

## 3. Use it

Live Monitor → a live call appears → **Listen live**. For human calls the card
shows the rep's name and a "Connecting audio…" state until the agent leg's
`CallSid` is bound, then flips to "Listen live". You'll hear both sides, mixed,
with a small jitter buffer. Stop anytime; it also stops when the call ends. The
post-call **recording** remains available afterward.

## Verify the relay contract (no Twilio needed)

```bash
npm run verify:live-audio
```

This boots the real relay and checks the exact production contract end-to-end:
`/health`, token **accept** (signed like the app) and **reject** (forged → 401)
on both `/twilio` and `/listen`, μ-law-in → correctly-**mixed** PCM16-out, and
the `ended` signal when a leg closes. All green ⇒ the relay + token handshake are
correct; any live issue is then env/config (URL, secret match, Twilio REST), not
the relay.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Render deploy crashes: `Cannot find module 'ws'` | Old build before `ws` was a dependency. Redeploy (now in `package.json`); build command must be `npm install`. |
| "Listen live" → *"Live audio isn't configured"* (503) | `MEDIA_STREAM_URL`/`MEDIA_STREAM_SECRET` missing on the **Next app**, or you didn't redeploy after adding them. |
| "Listen live" → *"Twilio REST isn't configured"* (503) | Missing `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_CALLER_ID` on Vercel. |
| Button shows but no audio; first call after idle fails | Render **Free** plan cold start. Use Starter or ping `/health`. |
| No audio, no error | `MEDIA_STREAM_SECRET` differs between Render and Vercel → the WS upgrade is 401'd. Make them identical, redeploy. |
| `MEDIA_STREAM_URL` rejected | Must start with `wss://` (not `https://`/`ws://`), no trailing slash, no path. |
| Human-call card stuck on "Connecting audio…" | The agent-leg `CallSid` never bound. Confirm the TwiML App Voice URL points at `/api/twilio/voice` and the dial passed `MonitorId`. |

## Notes & limits

- Audio is 8 kHz telephone quality (μ-law), mixed mono — monitoring audio, not hi-fi.
- One relay handles many concurrent calls (each is its own room). For heavy load
  run multiple instances behind a sticky load balancer, or shard by room.
- Tokens expire after 1 hour; a fresh one is minted each time you press Listen.
- The relay keeps the buffer bounded (~1s) so you stay close to real time.
- Presence (the live card + transcript) works even without the relay — only the
  live *audio* needs it.
