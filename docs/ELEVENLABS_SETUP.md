# ElevenLabs Conversational AI — full setup guide

This dialer drives the ElevenLabs voice agent for outbound calls, personalizes
every call from the lead's organization, and lets supervisors watch/▸take over
calls live. This guide gets the agent ("Emily" for Sunrun) running end-to-end.

> The app already ships the Emily script and wiring. ElevenLabs just needs to be
> configured to (1) allow our per-call overrides, (2) let the agent end the call,
> and (3) call our personalization webhook. Everything else below is optional
> polish (tools, transfer/merge, voicemail).

---

## 0. App environment variables

Set these where the app runs (`.env.local` / your host):

| Variable | What it is |
| --- | --- |
| `ELEVENLABS_API_KEY` | ElevenLabs API key (Profile → API Keys) |
| `ELEVENLABS_AGENT_ID` | The agent's ID (Conversational AI → Agents → your agent) |
| `ELEVENLABS_AGENT_PHONE_NUMBER_ID` | The **phone number ID** of your imported Twilio number (NOT the raw number — see §4). Pasting the raw E.164 number also works; the app resolves it. |
| `ELEVENLABS_WEBHOOK_SECRET` | Post-call webhook signing secret (§7) |
| `ELEVENLABS_TRANSFER_NUMBER` | E.164 number the "Transfer" button bridges a live call to (default `+14693018199`) |

Tip: visit `/api/elevenlabs/phone-numbers` in the app to list your imported
numbers and their IDs.

---

## 1. Create the agent

Conversational AI → **Agents** → New agent.

- **System prompt:** with overrides enabled (§2a) you can leave this blank — the
  app sends the current Emily script on every call. If you prefer to paste it,
  get the exact, up-to-date text from **Admin → Organization → AI → "System
  prompt" → Copy** (Sunrun pre-fills it). See §8 — do NOT paste an old copy.
- **First message:** `Hey — is this {{first_name}}?`
- **Language:** English.
- **LLM:** any strong model (GPT-4o / Claude). Temperature ~0.5 for natural-but-on-script.

### Voice (slower, human)
Agent → **Voice**:
- Pick a warm female voice.
- **Speed:** `0.9` (slower/calmer — the app also sends this per call).
- **Stability:** ~`0.45`, **Similarity:** ~`0.8` so the "um/like" disfluencies sound natural.

---

## 2. ⭐ The 3 required toggles

### (a) Enable overrides — so the app can personalize each call
Agent → **Security** (a.k.a. "Overrides" / "Advanced").
Turn **ON** the ability to override:
- ✅ System prompt
- ✅ First message
- ✅ Language
- ✅ TTS / Voice settings

> Without this, our per-call override (Emily script + filled `{{variables}}` +
> 0.9 speed) is ignored and the agent falls back to its dashboard prompt.

### (b) Enable the End Call tool — so Emily can hang up
Agent → **Tools** → **Add tool** → **System tools** → **End call** → Save.
The script already tells Emily to end the call when finished; this tool lets her.

### (c) Point the personalization webhook at the app
Agent → **Security/Advanced** → **"Fetch conversation initiation data from a
webhook"** (a.k.a. *Conversation Initiation Webhook*):
- Enable it.
- **URL:** `https://YOUR_APP_DOMAIN/api/elevenlabs/personalization`
- **Method:** `POST`
- Enable **"Conversation initiation client data" / overrides from webhook**.

On every call this webhook returns the right prompt, first message, language,
voice speed, and the personalization variables for the matched lead's org.

---

## 3. Tools section (recommended)

Agent → **Tools**. Add the system tools you want:

| Tool | Why | Config |
| --- | --- | --- |
| **End call** | Emily hangs up when done (required, §2b) | none |
| **Detect voicemail** | Auto-handle answering machines | On voicemail: leave the brief voicemail line, then end |
| **Transfer to number** | **The "merge"** — bridge a live human rep into the call | Number = your rep line (e.g. `+14693018199`); **Transfer type = Conference/Warm**; condition = "when the customer asks for a human or a supervisor needs to join" |
| **Language detection** *(optional)* | Switch language if the customer prefers another | none |

**About "merge / live listen":** with **Transfer to number → Conference**, the
agent bridges the rep's phone into the live call and (per the script) goes
silent — that is your "join the call, AI stops" behavior, with real two-way
audio. The app's **Take over** button does the same thing into your *browser*
(no phone needed). See §6.

---

## 4. Phone number

Conversational AI → **Phone Numbers** → import your Twilio number (needs Twilio
SID + Auth token) → assign it to this agent.
Copy its **phone_number_id** into `ELEVENLABS_AGENT_PHONE_NUMBER_ID`.

---

## 5. Dynamic variables the app sends

These fill the `{{...}}` in the prompt/first message (per call, from the lead):

`customer_name`, `first_name`, `last_name`, `address`, `home_address`, `city`,
`state`, `solar_provider`, `utility_provider`, `utility_bill`, `solar_payment`,
`has_ev`, `has_pool`, `has_battery`.

You don't have to declare these in the dashboard — they arrive via the
personalization webhook. (If you reference a variable that isn't sent, give it a
default in the dashboard's Dynamic Variables panel.)

---

## 6. Live monitoring / listening (how it works in the app)

Open **Live Monitor → a live call** for the per-call dashboard:

1. **Live transcript** — streams every ~2s with a **LIVE** badge.
2. **Listen in** — reads each new turn aloud in your browser as it streams
   (zero setup; good for passive monitoring).
3. **Take over (merge)** — joins you into the call via a Twilio conference; the
   AI hands off and goes silent. This is the browser version of the merge.
4. **Transfer** — bridges the call to `ELEVENLABS_TRANSFER_NUMBER` (a phone).
5. **End** — hangs up and categorizes the call.

> **Passive live audio is now available** via a standalone Twilio Media Streams
> relay — hear the AI call live without interrupting it. Deploy it and set
> `MEDIA_STREAM_URL` + `MEDIA_STREAM_SECRET`; then the **Listen live** button
> appears on live calls. See **`docs/LIVE_AUDIO.md`**. Without it, use **Read
> aloud** (live transcript), **Take over / Transfer** to join with audio, and the
> **recording** after the call.

---

## 7. Post-call webhook (transcripts, summaries, recording)

Settings → **Webhooks** → add a **Post-call** webhook:
- **URL:** `https://YOUR_APP_DOMAIN/api/elevenlabs/webhook`
- Copy the **signing secret** into `ELEVENLABS_WEBHOOK_SECRET`.

This writes the final transcript, AI summary, outcome, and recording flag back to
the dialer and auto-dispositions the call.

---

## 8. The Emily system prompt (reference)

**The canonical Emily prompt lives in code** — `EMILY_SYSTEM_PROMPT` in
`src/lib/ai/agent-prompt.ts` — and is sent automatically on every call as a
per-call override **when overrides are enabled (§2a)**. With overrides on you do
NOT need to paste anything into the dashboard; the app is the single source of
truth and the prompt updates whenever the app is deployed.

> ⚠️ **Do not run from a prompt pasted into the dashboard long ago.** If
> overrides are OFF, the agent ignores the app entirely and runs whatever text is
> sitting in its System prompt field. A stale copy there is the #1 cause of the
> agent going off-script, skipping the qualifying questions, or rushing straight
> to booking — because older drafts told it to "move toward booking the
> appointment" without the current step-by-step discipline.

To run from the dashboard anyway (not recommended), copy the **current** text
from **Admin → Organization → AI → "System prompt" → Copy** and paste it as the
agent's System prompt. Re-copy it after every app update so it never drifts.

First message (also overridden per call): `Hey — is this {{first_name}}?`

---

## 9. Quick test checklist

- [ ] `/api/elevenlabs/phone-numbers` lists your number → ID set in env.
- [ ] Overrides enabled (§2a) and personalization webhook URL set (§2c).
- [ ] End Call tool added (§2b).
- [ ] Place a test call from the **Power Dialer**; Emily opens with the name,
      confirms the address, speaks slowly with natural "um/like".
- [ ] Open it in **Live Monitor** → transcript streams, **Listen in** works,
      **Take over** bridges you in and Emily goes silent.
- [ ] After the call, transcript/summary/recording appear (post-call webhook).
