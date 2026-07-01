# Automated (unattended) AI calling

Lets the AI agent place calls on a schedule with **no rep or open browser**. A
server cron ticks every minute; for each org whose window is open (in the org's
own timezone) it places AI calls to the least-recently-contacted dialable leads,
honoring a daily cap and per-lead cooldown.

> This places **real calls that cost money** (ElevenLabs + Twilio per call).
> Only the AI agent can run unattended — manual dialing still needs a rep.

## How it works

- **Schedule** lives per-org in `settings.automation` (windows, days, timezone,
  pace, caps). Edit it in **Admin → Automated calling**.
- **`/api/cron/auto-dial`** runs each tick: finds active orgs, pulls up to
  `callsPerRun` eligible leads each, and places AI calls via the same path as a
  rep-launched AI call (persona, caller-ID rotation, local presence, recording,
  live monitor all apply).
- **De-dupe**: a lead is stamped `last_contacted_at` the instant it's dialed and
  won't be re-picked until `cooldownHours` later. Only `new / no_answer /
  callback` leads with a valid phone are eligible (DNC is excluded by status).
- **Daily cap**: an atomic per-org, per-day counter stops at `dailyCap`
  (0 = unlimited) and resets each local morning.

## Turn it on (checklist)

1. **Set `CRON_SECRET`** in the deployment env (any long random string). The
   endpoint refuses to run without it. Vercel Cron sends it automatically once
   the env var exists; external cron must send `Authorization: Bearer <secret>`.
2. **Deploy** — `vercel.json` already registers the every-minute cron
   (`* * * * *` → `/api/cron/auto-dial`). *Every-minute cron needs a Vercel plan
   that allows it (Pro+). On Hobby, point an external scheduler — e.g.
   cron-job.org — at the URL with the Bearer header instead.*
3. **Configure the AI agent** (`ELEVENLABS_*`) and Twilio as usual, and make
   sure the org's **AI agent feature** is enabled.
4. **Admin → Automated calling**: the windows are preset to **8–9am, 11am–3pm,
   5–7pm, America/Chicago, every day, ~3 calls/min, 500/day**. Flip **Enable
   automated calling** on. (It's off by default so no org auto-dials by surprise.)

## Tuning

| Setting | Meaning |
|---|---|
| Timezone | IANA zone the windows/days are evaluated in |
| Call windows | 24-hour, **end exclusive** (8→9 = the 8am hour) |
| Calling days | 0=Sun … 6=Sat |
| Calls per minute | Placed per tick; pace lever |
| Daily cap | Hard stop per org per day (0 = none) |
| Re-dial cooldown | Hours before a lead can be dialed again |

## Guardrails baked in

- **TCPA**: keep windows within 8am–9pm local (the admin note flags this). The
  preset windows already comply.
- **Spam/deliverability**: automated calls rotate the caller-ID pool and honor
  local presence (see `CALLER_ID_DELIVERABILITY.md`), so volume spreads across
  numbers instead of hammering one — keep `dailyCap` and pace sane.
- **No double-dialing**: cooldown + immediate contact stamp.
- **Fail-safe**: no `CRON_SECRET` → refuses; ElevenLabs unconfigured → no-op;
  org AI feature off → skipped; a failed call is logged and the run continues.

## Verify it's working

- Manually trigger:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/auto-dial`
  returns `{ ok, ranAt, results: [{ org, placed }...] }`.
- Watch live calls in the **Live Monitor**; dispositions/transcripts land the
  same as rep-launched AI calls.
