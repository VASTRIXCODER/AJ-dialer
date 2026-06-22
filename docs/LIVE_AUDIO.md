# True passive live-audio listening (Twilio Media Streams)

Lets a supervisor **hear an in-progress AI call live, without interrupting it** —
the AI keeps talking. This is the real-audio counterpart to "Read aloud" (live
transcript) and "Take over / Transfer" (which join and hand the call off).

## How it works

```
ElevenLabs ⇄ Twilio call (the AI ⇄ homeowner)
                    │  Twilio Streams API forks BOTH legs (does not disrupt)
                    ▼
        wss://your-relay/twilio   ← standalone relay (server/media-stream-server.mjs)
                    │  μ-law → PCM, mixes the two legs
                    ▼
        wss://your-relay/listen   → supervisor's browser (Web Audio playback)
```

- The app calls Twilio `calls(sid).streams.create()` to start the fork — the AI
  call is untouched (this is NOT the take-over redirect).
- The relay authenticates Twilio and the browser with the same short-lived HMAC
  token the app signs (`src/lib/media-stream.ts`), bound to a per-call room.
- Everything is **gated**: with no relay configured, the "Listen live" button
  simply doesn't appear and nothing else changes.

## 1. Deploy the relay

The relay holds long-lived WebSockets, so it runs as its **own process** (not in
serverless Next). Any host that allows persistent WS works — Render, Fly.io,
Railway, a small VPS, etc.

```bash
# in the relay's environment
npm i ws
MEDIA_STREAM_SECRET="a-long-random-shared-secret" PORT=8787 \
  node server/media-stream-server.mjs
```

Expose it over TLS as `wss://media.yourdomain.com` (Twilio requires `wss://`).
Health check: `GET /health` → `ok`.

## 2. Point the app at it

Set in the Next app's environment:

| Variable | Example | Notes |
| --- | --- | --- |
| `MEDIA_STREAM_URL` | `wss://media.yourdomain.com` | Must start with `wss://` |
| `MEDIA_STREAM_SECRET` | *(same secret as the relay)* | HMAC for listen tokens |

Twilio REST must also be configured (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_CALLER_ID`) — that's what starts the media fork.

## 3. Use it

Live Monitor → open a live call → **Listen live**. You'll hear the AI and the
homeowner, mixed, with a small jitter buffer. Stop anytime; it also stops when
the call ends. The post-call **recording** remains available afterward.

## Notes & limits

- Audio is 8 kHz telephone quality (μ-law), mixed mono — it's monitoring audio,
  not hi-fi.
- One relay handles many concurrent calls (each is its own room). For heavy load
  run multiple instances behind a sticky load balancer, or shard by room.
- Tokens expire after 1 hour; a fresh one is minted each time you press Listen.
- The relay keeps the buffer bounded (~1s) so you stay close to real time.
