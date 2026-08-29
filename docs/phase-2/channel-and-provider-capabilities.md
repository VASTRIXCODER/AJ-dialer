# Phase 2 — Channel & provider capabilities (honest inventory)

What each provider integration ACTUALLY does today, verified against the code —
not the provider's brochure. Required by docs/phase_two.md §2; §9 (inbound
reception), §19 (communication integrity) and §22 (navigation) depend on it.
Companion to docs/phase-2/opportunity-domain-and-state-machines.md (the design
authority). Ratings: **Supported** · **Caveats** · **NOT supported** — anything
NOT supported must be capability-gated in Phase 2 UI, never simulated
(§2 "Unsupported provider capabilities are capability-gated and explained
honestly").

## 1. Twilio voice — outbound: Supported

- Browser (Voice SDK) legs via TwiML App + minted tokens (`src/lib/twilio.ts`
  `createVoiceToken`, identity continuity HMAC; `src/app/api/twilio/token`).
- REST outbound legs for single/parallel dialing (`/api/twilio/call`),
  conference bridging rep ⇄ homeowner (`/api/twilio/voice` Conference branch),
  hold/release/answered/legs-recovery routes under `src/app/api/twilio/*`.
- Caller-ID rotation per org pool (`src/lib/dialer/rotation.ts`).
- **AMD**: async, opt-in per org (`settings.dialing.amd`), verdict callback at
  `/api/twilio/amd` — machine hangup or TTS voicemail drop; `answered_by`
  parked onto the call record. Needs a live-phone test (known open item).
- **Recording**: conference recording (`record-from-start`) and dual-channel on
  manual `<Dial>`; recording status rides `/api/twilio/status`; playback is an
  authed, org-scoped proxy (`/api/twilio/recording/[sid]`).
- Webhook signatures verified with multi-origin URL reconstruction; unsigned
  acceptance fails closed unless explicitly acked (`verifyTwilioSignature`).

**Caveat — NO transcription/STT anywhere.** No Twilio `<Transcription>`, no
media streams, no STT vendor. Manual/parallel human calls produce a recording
and rep notes only. Transcripts exist ONLY for ElevenLabs AI calls (§3).
Grep evidence: zero `transcri` matches under `src/app/api/twilio/`. Any Phase 2
feature that reads "what was said" on a human call (post-call extraction §8 of
phase_two, summary factuality) has no input for manual calls until STT is added.

## 2. Twilio voice — inbound: NOT supported (gate P2.4)

Numbers provisioned by the superadmin point their Voice webhook at
`/api/twilio/voice` (`src/app/api/superadmin/provision-numbers/route.ts`), but
that route only understands three shapes: the AI-bridge hold leg, monitor
joins, and browser-originated outbound dials. A real PSTN caller dialing an org
number falls into the outbound `<Dial>` branch with `To` = our own number —
undefined behavior, no IVR, no greeting, no routing, no inbound session record,
no timeline attachment. There is **no inbound call model at all**. P2.4 must
build inbound routing from zero; nothing existing can be extended into it.

## 3. ElevenLabs AI agent — outbound calls: Supported (with caveats)

`src/lib/elevenlabs.ts` + `src/app/api/elevenlabs/*`:

- `placeOutboundCall` via the agent's imported Twilio number; two agents
  (primary/secondary) resolvable per call.
- **Override policy fail-closed**: the agent's Security allow-list is fetched
  and cached per agent; disallowed override fields are DROPPED, never sent
  (sending one kills the call on connect — the documented zero-connect outage).
  `ELEVENLABS_USE_DASHBOARD_PROMPT` is now only an explicit "never override"
  switch.
- **Quota preflight** (`fetchQuota`, 60s cache, low-water warning) + **circuit
  breaker** (`src/lib/ai-call-breaker.ts`): quota exhaustion or repeated
  agent-terminated-on-connect trips it and AI dialing refuses to start.
- **Post-call transcript webhook** `/api/elevenlabs/webhook`: HMAC-verified
  (fails closed when the secret is unset), transcript-event-only finalization,
  reconcile cron as backstop. Transcript turns → `ai_conversations`, flattened
  into `call_records.transcript_text`.
- **Bridge mode** (`TWILIO_AI_BRIDGE_NUMBER`): agent dials a Twilio conference
  so supervisors can live-listen via muted `<Conference>` join
  (`/api/twilio/listen` HMAC token + `/api/twilio/voice` monitor branch).
  Without a bridge number: direct dial, NO live listen, intervene still works
  on the single leg.
- **Transfer / takeover / end** (`/api/elevenlabs/intervene`): acts on the
  underlying Twilio CallSid — takeover moves the homeowner into a conference
  the supervisor's browser joins; transfer reroutes to a configured number
  (`settings.ai.transferNumber`; unset ⇒ action unavailable). Org-scoped,
  permission-gated (`monitor.intervene`).
- Audio playback via authed proxy (`/api/elevenlabs/audio/[id]`).

## 4. ElevenLabs inbound agents: NOT supported (gate P2.4)

The provider offers inbound agent answering on imported numbers. **Nothing is
wired**: zero inbound code paths in `src/lib/elevenlabs.ts` or its routes, no
inbound number configuration, no caller matching, no inbound session entity.
P2.4 = Twilio inbound routing (§2 above) + ElevenLabs inbound agent config +
the inbound-session model, all new.

## 5. Live transcript relay: Supported with a hard latency floor

ElevenLabs has **no push transcript API** — the live pane polls
`GET /api/monitor/transcript/[id]` every 3s (`POLL_MS = 3_000`,
`src/components/monitor/live-transcript-pane.tsx`); one provider poll is shared
across supervisors and rebroadcast (diff/dedupe contract in
`src/lib/monitor/transcript-relay.ts`, keyed by provider turn index). Practical
turn-to-screen latency ≈ 3–6s. Phase 2 must not promise "real-time" inbound
transcripts beyond this; §26 latency baselines should record it as a floor.

## 6. SMS/MMS: NOT supported for outbound (gate P2.3/P2.5/P2.9)

- **Inbound compliance only — Supported**: `/api/twilio/sms` (signature-
  verified) handles STOP-family → org DNC insert, START → DNC removal, with a
  compliant TwiML reply. Provisioning points each number's Messaging webhook
  here (the ElevenLabs-404 misconfig is documented in the route).
- **Everything else — NOT built**: no outbound send path (zero
  `messages.create` calls outside the AI client), no templates, no delivery
  receipts, no inbound reply threading, no MMS, no per-lead conversation
  storage, no quiet-hour/frequency-cap enforcement for messaging. Every
  phase_two.md feature that says "SMS" — appointment confirmations/reminders
  (§10), no-show recovery messages (§11), reactivation messages (§16) — is
  blocked on building the §19 communication layer first. Until then those
  playbook steps must be call- or work-item-only, and the orchestration
  definition validator must reject SMS actions (it does: channel actions are
  outside the v0 allow-list — see the design authority §5).

## 7. Email: internal notifications only (Caveats)

- Resend REST over fetch (`src/lib/email/resend.ts`), no SDK. Outbox drain
  (`src/lib/notifications/outbox.ts`): trigger-enqueued (atomic with booking,
  schema PART 13), idempotency-keyed sends, backoff, terminal-failure surfacing,
  cron-drained (`/api/cron/notifications`).
- Scope is **staff-facing** (appointment alerts to org emails). It is NOT a
  customer channel: no inbound email, no Resend delivery/open/bounce webhook
  consumption, no customer unsubscribe management, no templates-with-approval.
  A Resend 200 means *accepted*, not delivered — we store the accept id only.
- Usable by the P2.1 engine's `escalate` action (internal notify). Customer
  email journeys (P2.8) would need the full §19 layer.

## 8. Calendar / CRM / fulfillment integrations: NONE

- Appointments are internal rows only — no Google/Outlook/ICS sync, no
  external booking source (`grep` for calendar providers: nothing).
- No CRM adapter, no contracting/installation system integration. P2.7's
  fulfillment mirror has **no trusted source wired**; its only day-1 adapter is
  authorized manual status update (allowed by phase_two.md §14 "authorized
  manual update") until a real source is identified with the tenant.

## 9. Capability matrix

| Capability | Status | Evidence |
|---|---|---|
| Outbound calls (manual/parallel/AI) | Supported | `src/lib/use-dialer.ts`, `/api/twilio/call`, `/api/elevenlabs/call` |
| Conference, hold, monitor-listen | Supported | `/api/twilio/voice`, `/api/twilio/listen`, `/api/twilio/hold` |
| AMD / voicemail drop | Caveats (needs live test) | `/api/twilio/amd` |
| Call recording + authed playback | Supported | `/api/twilio/recording/[sid]` |
| STT on human calls | NOT supported | no code path |
| AI-call transcripts (post-call) | Supported | `/api/elevenlabs/webhook` |
| Live transcript | Caveats (~3s poll, no push) | `src/lib/monitor/transcript-relay.ts` |
| AI transfer/takeover/end | Supported | `/api/elevenlabs/intervene` |
| Inbound voice (human or AI) | NOT supported | §2, §4 above |
| Outbound SMS/MMS | NOT supported | no send path |
| Inbound SMS STOP/START → DNC | Supported | `/api/twilio/sms` |
| Customer email | NOT supported | §7 above |
| Staff email notifications | Supported | `src/lib/notifications/outbox.ts` |
| Calendar / CRM / fulfillment source | NOT supported | §8 above |

## 10. The §19 rule and what it gates

**Never claim delivery, read, confirmation, or an answer without the
corresponding provider/customer event.** The only truthful events we have
today: Twilio call status/AMD/recording callbacks, ElevenLabs post-call
transcript webhook, Resend *accept* (which is not delivery). Consequences:

- **P2.4** ships behind a capability gate until §2 + §4 are built; the Inbound
  Reception nav item must state why it is unavailable, not fake sessions.
- **P2.5** appointment "Confirmed" may only come from a parsed customer reply
  or human action — and with no SMS channel, the reply paths available today
  are a call outcome or a manual mark. Reminder "sent" ≠ "delivered" ≠
  "confirmed"; three separate states from day one.
- **P2.7** milestone displays must carry source + freshness; with no wired
  source, every mirror row is "manual, as-of <time>" — never presented as live.
- Nothing in Phase 2 may simulate live audio, transfer success, delivery, or
  AI outcomes when the underlying capability above reads NOT supported.
