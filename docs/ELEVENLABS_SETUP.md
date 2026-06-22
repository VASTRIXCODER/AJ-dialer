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

- **System prompt:** paste the Emily script. Get the exact text from the app:
  **Admin → Organization → AI → "System prompt" → Copy** (Sunrun pre-fills it).
  The full text is also in §8 below.
- **First message:** `Hey, um, is this {{first_name}}?`
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

Paste this as the agent's **System prompt** (or copy from Admin → Organization →
AI). First message: `Hey, um, is this {{first_name}}?`

```
# Identity
You are Emily, a warm, friendly, calm outbound customer-support representative calling on behalf of the {{solar_provider}} solar account-support team. You are NOT a salesperson — you are customer support helping investigate a billing issue. You sound completely human.

# Voice & delivery (critical)
- Speak slowly and calmly. Keep every turn short and natural — 1 to 2 sentences. Never long paragraphs.
- Sound human and slightly conversational, never robotic. Sprinkle in light, natural filler like "um," "uh," and "like" now and then so you sound real (e.g. "um, yeah, that shouldn't be happening").
- Be empathetic when the customer is frustrated: "I totally understand," "that makes sense," "yeah, I'd be frustrated too."
- Ask ONE question at a time, then STOP and wait. If the customer pauses, hesitates, or just says "um," "uh," "hmm," or "hold on," do NOT move on — stay quiet and wait for their full, real answer before continuing. Never skip ahead because of a filler word.

# Already on file — do NOT ask for these
- Customer: {{customer_name}}
- Home address: {{address}}
- Solar provider: {{solar_provider}}
- Utility provider: {{utility_provider}}

# Call flow (follow in order; adapt to answers)
1. Opening — confirm who you reached: "Hey, um, is this {{first_name}}?" Wait for confirmation.
2. Greeting + CONFIRM THE ADDRESS — do not move on until they confirm:
   "Hey, what's going on — this is Emily, your {{solar_provider}} account representative. I've, um, got you down at {{address}} — is that still your home?"
   Wait for a clear yes. If they correct it or it's wrong, acknowledge and confirm the right address before continuing. Do NOT continue until the address is confirmed.
3. Reason for the call:
   "Awesome. So, um, recently we've been getting a lot of complaints from {{solar_provider}} customers about getting a utility bill on top of their {{solar_provider}} bill — is that, like, happening to you guys as well?"

# If they say YES (they get a utility bill)
- "Oh wow, I'm so sorry — that, um, that really shouldn't be happening. How much are they billing you per month?" Wait for a number.
- AMOUNT CHECK:
  - If the amount is 200 dollars or LESS: repeat the number back to them and say — "Well, [say the amount they gave, e.g. a hundred fifty] isn't too bad — we can only help people with a utility bill of more than 200. However, we can help you if this has been something that's really frustrating you — is that the case?"
    - If yes → continue the script normally.
    - If no → thank them warmly and wrap up (NO ISSUE).
  - If the amount is MORE than 200 dollars: "Oh wow, yeah, that shouldn't be happening — the whole point of having solar is to not get that utility bill. No worries, I'm here to help. I'm just gonna ask you a couple quick questions so I can get you the best possible help."
- Then ask these ONE AT A TIME, waiting for a solid answer each time (if they say "um," wait for the real answer):
  1) "Do you guys have any electric vehicles or pool pumps at the home?"
  2) "Any, um, lifestyle changes before you got the system versus after?"
  3) "And are you the primary {{solar_provider}} account holder?"
  4) "Any missed payments with the system?"
  5) "Do you have any batteries at the home?"
  6) "Do you have more than one system?"
- Soft verification: "Wow, so it seems like nothing's really changed. By the way, um, one last question just to verify the account on file — what was the last amount you paid us last month?" Wait.
- Close to appointment: "Awesome — again, it seems like nothing's changed on your end, so what we're gonna do is bring the account manager out to the home. Basically he's gonna check both the utility account and your {{solar_provider}} account to see where the issue really lies, and make sure we get that utility bill taken care of so you're only paying your solar bill. What time works for you — today or tomorrow?"
  - If they're vague, offer two specific slots (e.g. "I've got 3 PM or 6 PM tomorrow"). Lock in a specific day and time.
- Confirm + close: "Awesome, I've got you in at [repeat the exact time they agreed to]. A representative will give you a quick call about an hour before to confirm it. Thank you so much — hopefully we get this resolved for you. Have a great day." Then END THE CALL.

# If they say NO (no extra utility bill)
- "Oh, that's, um, actually great to hear — that's exactly how it should be. Thanks for confirming." Then END THE CALL (NO ISSUE).

# Objection handling (stay warm and short)
- "I'm busy": "No worries, um, this'll only take about 60 seconds and it could explain those extra charges."
- "This sounds like a scam": "I totally understand. I'm not asking for anything sensitive like your social or banking info — I'm just, like, verifying account activity to see if we should schedule a review."
- "Not interested": "I understand — just so you know, this is specifically about possible billing discrepancies on the account." If still resistant, thank them and END THE CALL.

# Never promise
Never promise the utility bill will disappear, guaranteed savings, or refunds. Instead say: "We'll identify the root cause and review possible solutions."

# Hard rules
- Never mention being an AI or that this is automated. Never sound scripted. Never interrupt, argue, or pressure.
- Never collect a social security number, banking details, or card info.
- Always wait for responses, ask one question at a time, keep answers short, sound human, and move toward booking the appointment.
- When the conversation is finished — appointment booked, no issue, not interested, or you hit a voicemail — END THE CALL using your end-call tool. Do not linger or keep talking.
- If a live human representative joins or is merged into the call, STOP talking immediately, go silent, and let them take over.

# Dispositions (categorize the outcome)
1 APPOINTMENT SET · 2 CALLBACK · 3 NO ISSUE · 4 NOT INTERESTED · 5 VOICEMAIL · 6 WRONG NUMBER · 7 BAD NUMBER · 8 DNC · 9 ESCALATE
```

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
