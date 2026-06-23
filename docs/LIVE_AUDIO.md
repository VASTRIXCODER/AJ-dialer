# Live call-audio listening

Lets a supervisor **hear an in-progress call live, without interrupting it**.
There are two independent paths, by call type:

| Call type | Mechanism | Extra infrastructure |
| --- | --- | --- |
| **Human rep ↔ customer** | Supervisor's browser joins the call's **Twilio conference, muted** (hears both sides, is never heard) | **None** — just Twilio |
| **AI (ElevenLabs) ↔ customer** | Twilio **Media Streams** fork the audio to a standalone relay | A relay host (Render/Fly/…) + `MEDIA_STREAM_*` |

> The human-call path needs **no relay and no extra env vars** — it rides on the
> same Twilio conference the call already uses. The relay below is **only** for
> listening to AI calls.

---

## Human rep ↔ customer calls (conference monitoring — no relay)

### How it works

Every human call runs inside a Twilio conference (`hc-<id>`): the homeowner is
dialed in via Twilio REST and the rep's browser joins the same room. To listen, a
supervisor's browser joins that **same conference, muted**:

```
Rep browser ─┐
             ├─ Twilio Conference  hc-<id>   (recorded)
Homeowner  ──┘        ▲
                      │  muted participant (hears all, heard by none)
            Supervisor browser  (Twilio Voice SDK)
```

1. Live Monitor shows the rep's live call (presence from `/api/calls/active`).
2. **Listen live** → `POST /api/twilio/listen { humanId }`. The route checks
   `monitor.listen` + that the call is in the supervisor's org, then returns the
   conference room and a short-lived **HMAC token** (signed with your Twilio auth
   token — no new secret).
3. The browser joins via the Voice SDK with `Monitor=true` + that token. The
   voice webhook verifies the token and emits a `<Conference muted="true">` join.
   The token is what stops anyone else from silently joining a call.

### Requirements

- **Twilio REST** must be configured (it dials the homeowner into the
  conference): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_ID`.
- **TwiML App → Voice Request URL** must point at `…/api/twilio/voice` (POST) —
  the same webhook that powers dialing and take-over.
- The supervisor's browser will ask for **microphone permission** (the Voice SDK
  requires it to open an audio session, even though the supervisor joins muted).

That's it. No Render, no `MEDIA_STREAM_URL`/`MEDIA_STREAM_SECRET`.

### Use it

Live Monitor → a live rep call appears → it shows "Connecting audio…" until the
conference exists, then **Listen live**. You hear both sides in real time. Stop
anytime; it also stops when the call ends. The call is recorded for later too.

---

## AI (ElevenLabs) calls (Media Streams relay — optional)

An AI call is a single carrier leg, not a conference you can join, so live-audio
for AI calls forks the audio to a small always-on relay. This is **optional** —
if it isn't configured, AI live-audio simply isn't offered (everything else,
including human-call listening, the live transcript, and take-over, still works).

```
Twilio AI call  ─ calls(sid).streams.create({ track: both_tracks }) ─▶
wss://your-relay/twilio   ← relay (server/media-stream-server.mjs): μ-law→PCM16, mixes legs
wss://your-relay/listen   ─▶ supervisor browser (Web Audio)
```

### Architecture: two services

| Piece | Runs on | Needs |
| --- | --- | --- |
| **Next app** (starts the fork, signs tokens, serves UI) | Vercel | Twilio REST creds + `MEDIA_STREAM_URL` + `MEDIA_STREAM_SECRET` |
| **Relay** (holds the long-lived WebSockets, mixes audio) | Render / Fly / Railway / VPS | `MEDIA_STREAM_SECRET` (+ `PORT`, auto on Render) |

The relay **cannot** live inside serverless Next — it holds persistent
WebSockets. `ws` is a project dependency, so a plain `npm install` is enough.

### 1. Deploy the relay on Render

**Blueprint (uses `render.yaml`):** Render → **New → Blueprint** → pick this
repo → paste a long random **`MEDIA_STREAM_SECRET`** (`openssl rand -hex 32`;
save it — the Next app needs the *same* value) → deploy.

**Manual Web Service:** Build `npm install` · Start `npm run relay` · Health
`/health` · Env `MEDIA_STREAM_SECRET` · **don't** set `PORT` (Render injects it).

Render gives a URL like `https://aj-dialer-media-relay.onrender.com`; your `wss`
origin is the **same host with `wss://`** (no port, no path). Verify:
`curl https://…onrender.com/health` → `ok`.

> ⚠️ **Don't use Render's Free plan.** Free services sleep after ~15 min idle, so
> Twilio's media WebSocket times out on the first call after idle. Use **Starter**
> (stays warm), or ping `/health` every few minutes.

### 2. Point the Next app (Vercel) at it

| Variable | Value | Notes |
| --- | --- | --- |
| `MEDIA_STREAM_URL` | `wss://aj-dialer-media-relay.onrender.com` | **`wss://`**, no trailing slash, no path |
| `MEDIA_STREAM_SECRET` | *(the exact same secret you set on Render)* | mismatch ⇒ silent 401 on the WS upgrade |

**Redeploy** after changing Vercel env vars. Verify the relay contract without
Twilio: `npm run verify:live-audio` (boots the real relay and checks `/health`,
token accept/reject on `/twilio` + `/listen`, μ-law→mixed-PCM16, and `ended`).

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| **Rep call** "Listen live" does nothing / mic error | The Voice SDK needs microphone permission — allow it in the browser. The supervisor still joins muted. |
| **Rep call** "Could not start live audio" (403) | You lack `monitor.listen`, or the call isn't in your org. |
| **Rep call** card stuck on "Connecting audio…" | The conference isn't up yet (agent-leg `CallSid` not bound). Confirm the TwiML App Voice URL points at `/api/twilio/voice`. |
| Can't place rep calls at all | Human calls dial the homeowner via Twilio REST — set `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_CALLER_ID`. |
| **AI call** "Live audio isn't configured" (503) | `MEDIA_STREAM_URL`/`MEDIA_STREAM_SECRET` missing on the Next app, or no redeploy after adding them. (AI-only — rep calls don't need these.) |
| **AI call** no audio, no error | `MEDIA_STREAM_SECRET` differs between Render and Vercel → WS upgrade 401'd. Make them identical, redeploy. |
| Render deploy crashes: `Cannot find module 'ws'` | Build command must be `npm install` (`ws` is in `package.json`). |

## Notes & limits

- Human-call monitoring is native Twilio conference audio (real-time, full
  quality). Stopping/leaving never affects the live call.
- AI-call relay audio is 8 kHz telephone quality (μ-law), mixed mono.
- Monitor tokens (both kinds) expire after 1 hour; a fresh one is minted each
  time you press Listen.
- Presence (the live card + transcript) works regardless of either audio path.
