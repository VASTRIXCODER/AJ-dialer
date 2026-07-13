# Live listen-in — investigation (ticket 3.3)

**Status:** investigated, no rebuild needed. This is a **configuration** gap, not an architectural one.
**Date:** 2026-07-13

---

## The short version

The ticket assumed live listen-in was built on ElevenLabs' real-time monitoring channel, and that
this was the root cause — because that channel streams **transcript and metadata, not raw audio**,
and is enterprise-gated on ElevenLabs' side.

**That is not what this codebase does.** Listen-in here is built entirely on the **Twilio leg** —
which is precisely the alternative the ticket proposed as the fix ("tapping audio at the
telephony/SIP leg instead"). The recommended architecture is already shipped and fully wired.

So: there is no ElevenLabs plan tier to buy, and nothing to re-architect. Live listen-in doesn't
work because **the Twilio bridge is not configured in production**, and because the UI never said so.

---

## What actually exists

Three mechanisms, all Twilio:

| Path | How a supervisor hears it |
|---|---|
| **Human rep call** | Every human call already runs in a Twilio conference (`hc-<id>`). The supervisor's browser joins that same conference **muted** via the Voice SDK. |
| **AI call, bridge mode** | With `TWILIO_AI_BRIDGE_NUMBER` set, the AI call also runs in a conference (`ai-<conversationId>`). Same muted join. |
| **AI call, relay fallback** | Without a bridge, Twilio's Streams API can fork μ-law audio to a standalone WebSocket relay (`MEDIA_STREAM_*`). See `docs/LIVE_AUDIO.md`. |

The load-bearing files:

- `src/app/api/twilio/listen/route.ts` — authorizes the supervisor and dispatches to one of the three paths.
- `src/app/api/twilio/voice/route.ts:72-80` — the TwiML that emits the muted conference join.
- `src/lib/twilio.ts:135-146` — `signMonitorToken` / `verifyMonitorToken`, an HMAC over the room name.
- `src/app/api/twilio/token/route.ts` — mints the Voice access token the browser connects with.
- `src/lib/permissions.ts` — `monitor.listen` (owner/admin/manager/rep), `monitor.intervene` (manager+).

**ElevenLabs is not in this path at all.** The single place the code touches ElevenLabs audio is
`getConversationAudio()` (`src/lib/elevenlabs.ts:685`), which fetches
`/v1/convai/conversations/{id}/audio` — the **post-call recording**, used only on completed calls.
There is no ElevenLabs websocket, no `convai` audio stream, and no enterprise-gated dependency
anywhere in the repo. The team already understood this; `src/lib/ai-dialer.ts:62-68` spells out that
in bridge mode ElevenLabs is talking to *our* conference and cannot see the homeowner's phone.

---

## Why it appears broken

### 1. The bridge isn't configured, so the real button never renders

`liveAudioAvailable` is computed in `src/app/api/elevenlabs/conversation/[id]/route.ts:238` as
"bridge mode is on **or** the media-stream relay is on". With neither configured it is `false`, and
the **"Listen live"** button is not rendered at all. If you somehow reached the endpoint anyway,
`/api/twilio/listen` returns `503 "Live audio isn't configured"`.

Evidence production runs **direct mode** (no bridge): the ElevenLabs call log shows the agent dialing
the homeowner's number (`+1 703 439 8382`) directly. In bridge mode the receiver would instead be the
Twilio bridge number.

### 2. What *did* render was a text-to-speech button

The only listen-shaped control on the screen was **"Read aloud"** — `window.speechSynthesis` reciting
the *transcript* in a synthetic voice. Not call audio. It sat exactly where "Listen live" would be.
Press it, hear a robot read text, conclude listen-in is broken. That is almost certainly the origin
of this ticket.

It is now labelled **"Read transcript aloud"**, and when live audio is unavailable the UI says so
explicitly ("Live audio not configured") instead of silently hiding the button.

### 3. Two buttons that did literally nothing

`src/components/monitor/monitor-grid.tsx` had **"Listen"** and **"Whisper"** buttons with no
`onClick` handler at all — pure decoration. Both are removed. **Whisper/coach/barge-in does not exist
anywhere in this codebase**; if it is wanted, it is a new build, not a fix.

---

## To switch live listen-in on

Everything below is environment configuration in Vercel. No code changes.

**For human rep calls** (the cheaper win — they're already conferenced):
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=      # Voice TwiML App, its Voice URL → {APP_URL}/api/twilio/voice
```

**For AI calls, add bridge mode:**
```
TWILIO_AI_BRIDGE_NUMBER=+1XXXXXXXXXX   # a Twilio number you own
```
Point that number's "A call comes in" webhook at `{NEXT_PUBLIC_APP_URL}/api/twilio/voice`.

### Caveat worth testing before trusting it

Bridge mode changes **how every AI call is placed**: ElevenLabs dials *our* conference rather than
the homeowner, and our conference answers instantly — so the agent may begin its opening line before
the homeowner is actually bridged in. `.env.example` already flags this. **Verify the agent's opening
line on a live test call immediately after enabling bridge mode**, and be ready to roll the env var
back; it is the live calling path, not just the monitoring path.

The upside beyond listen-in: bridge mode is also what lets Twilio push `ringing` / `no-answer` to
`/api/twilio/status` within ~1s. In direct mode there's no status callback, so the live monitor
learns a call rang out by polling Twilio instead (see `reconcileViaTwilio` in
`src/lib/ai-call-reconcile.ts`).

### If bridge mode proves unworkable

Stand up the media-stream relay per `docs/LIVE_AUDIO.md` (`render.yaml` deploys it;
`npm run verify:live-audio` asserts the contract). This is strictly more infrastructure — only reach
for it if the bridge can't be made to work.

---

## Recommendation

Enable **bridge mode** in Vercel and test one AI call end-to-end. It fixes live listen-in *and*
upgrades no-answer detection from a poll to a push, which is the same thing ticket 3.1 is about.
Nothing else here needs building.
