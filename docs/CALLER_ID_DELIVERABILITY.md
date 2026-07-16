# Caller-ID deliverability runbook (spam-label remediation)

Context: UNRG's 817 number got spam-labeled by carriers, tanking pickup rate.
This is the root cause and the full fix. Split into **code (shipped)** and
**operational (Twilio account work — must be done in the Twilio Console / carrier
portals; cannot be done from the app codebase)**.

## Root cause

Carrier spam labels are set by three analytics engines the major carriers use:

| Carrier | Analytics engine | Remediation portal |
|---|---|---|
| T-Mobile / Metro | Hiya | Free Caller Registry |
| Verizon / US Cellular | TNS | Free Caller Registry |
| AT&T / Cricket | First Orion | Free Caller Registry |

These engines flag a number on **behavioral** signals, not just registration:

1. **High call volume from one number** in a short window ← primary trigger.
2. **Low answer rate + short call durations** (reads as robo/telemarketing).
3. **Many unique destinations, few repeats**, fanned out fast.
4. **No CNAM / no attestation / low trust** number.
5. **"Report spam" taps** from recipients.

UNRG routed **100% of outbound through a single 817 number** → that is the
textbook #1 trigger. STIR/SHAKEN attestation and CNAM help, but once a number is
behaviorally flagged you must **remediate it, rotate across many numbers, and cut
per-number volume** — registration alone won't lift an already-burned number.

> Net: this was a single-number-volume problem first, a registration problem
> second. Both are now addressed — code for the former, the checklist below for
> the latter.

## Code — shipped (live on this branch)

- **Caller-ID rotation pool** (`dialing.callerIds`, `rotateEvery`): the dialer
  cycles every call across all pool numbers. With `rotateEvery = 1` and N
  numbers, each number carries **1/N** of volume.
- **Per-rep rotation stagger**: each rep starts at a different point in the pool
  (hash of their user id), so the whole team doesn't hammer `pool[0]` first.
- **Local presence** (`dialing.localPresence`): dials from a pool number whose
  **area code matches the lead's** when one exists (rotating among same-area-code
  numbers), else falls back to rotation. Wired through manual **and** AI calls.
  **Now defaults ON** for new orgs (Admin → Dialing to change). No-ops safely when
  the pool has no matching area code, so it only ever helps.

**To activate tonight:** Admin → Dialing → paste all owned numbers into the
rotation pool (one per line), keep "Rotate every" at 1, confirm Local presence is
on. The code is ready the moment numbers are in the pool.

> **Env precedence caveat.** If the `TWILIO_CALLER_IDS` environment variable is
> set, it becomes the **platform-locked** pool for every org and the Admin →
> Dialing pool box goes read-only for non-superadmins (`PLATFORM_POOL_LOCKED`,
> `src/lib/dialer/rotation-server.ts`). So decide ONE place to manage numbers: set
> `TWILIO_CALLER_IDS` (env, platform-wide) **or** leave it unset and manage the
> pool per-org in Admin. Adding CA numbers in Admin has no effect while the env
> var is set.

## Current number inventory & config gaps (as of 2026-07)

From the Twilio Console export. **Two problems here explain "calls didn't go
through / went straight to VM" independent of spam labeling — fix these first:**

| Number | Region | Voice webhook | Gap |
|---|---|---|---|
| +1 817 402 2218 | Fort Worth, TX | `demo.twilio.com/welcome/voice` | ⚠️ demo webhook — not wired to the app |
| +1 346 695 0811 | Houston, TX | `demo.twilio.com/welcome/voice` | ⚠️ demo webhook |
| +1 817 214 3184 | Fort Worth, TX | `demo.twilio.com/welcome/voice` | ⚠️ demo webhook |
| +1 346 645 6704 | Houston, TX | `demo.twilio.com/welcome/voice` | ⚠️ demo webhook |
| +1 866 479 8081 | Toll-free | TwiML App: UNRG SOLAR | ⚠️ **toll-free verification REJECTED** — toll-free traffic is heavily filtered until verified; do not use for outbound dialing |
| +1 703 997 2718 | Alexandria, VA | `api.us.elevenlabs.io/twilio/inbound_call` | AI inbound line (ElevenLabs) |

**Config fixes (Twilio Console, not code):**
1. **Point every dialing number's Voice webhook at the app**, not the demo URL:
   set each local number's **Voice → A Call Comes In** to your TwiML App (or
   `{NEXT_PUBLIC_APP_URL}/api/twilio/voice`, POST). A number left on the demo
   webhook can't place app calls correctly — a prime "it didn't go through" cause.
2. **Stop using the 866 toll-free for outbound** until its verification clears
   (it was rejected). Re-submit toll-free verification, or drop it from the pool.
3. Only after 1–2 are correct, add the numbers to the rotation pool.

## California numbers (the team's request)

Reps asked for CA numbers because CA leads were "going straight to VM" — a mix of
non-local caller ID + spam labeling. To fix:
1. Pull the **top CA area codes** from the lead list (e.g. the "CALI UNRG" list:
   likely 209/279/408/510/559/619/626/650/661/707/714/747/760/805/818/831/858/909/916/925/949…).
2. Buy a few Twilio numbers in those area codes (§5 below), warm them (§6), set
   their Voice webhook to the app (config fix #1 above).
3. Add them to the pool. With **local presence on** (now the default), CA leads
   automatically dial from a CA number — no per-region config needed; the flat
   pool + area-code match handles it.

## Operational — Twilio account work (cannot be done from code)

Do these in the Twilio Console / carrier portals. Roughly in priority order.

### 1. Remediate the flagged 817 number (highest priority, free)
- Register at **Free Caller Registry** → https://www.freecallerregistry.com/
  — one form covers Hiya, TNS, and First Orion. Submit the 817 number + business
  details + call reason. Remediation typically clears in a few business days.
- Spot-check the current label with the **Hiya** or **Truecaller** app, or a TNS
  lookup, before/after.

### 2. Register CNAM (caller name) on every number
- Twilio Console → Phone Numbers → each number → set the **Caller Name (CNAM)**.
  Without CNAM the call shows a bare number, which depresses answer rate.

### 3. Verify STIR/SHAKEN attestation (Trust Hub)
- Twilio Console → **Trust Hub** → confirm a verified **Business Profile**.
- Numbers you own through Twilio under a verified business get **A-level
  attestation** automatically. Unverified/ported numbers fall to B/C, which makes
  labeling worse. Complete business verification so all pool numbers sign A.

### 4. Consider Branded Calling / Voice Integrity (paid, high ROI)
- **Twilio Voice Integrity**: registers your numbers with the analytics engines +
  monitors reputation continuously.
- **Branded Calls**: shows business name + logo + call reason on supported
  handsets — the single biggest answer-rate lift available.

### 5. Provision the rotation pool (this is what makes the code work)
- Buy enough numbers that **per-number daily volume stays modest** (aim for a few
  hundred dials/day/number max, and watch answer rate). If the floor dials, say,
  2,000/day, that's ~8–10 numbers minimum.
- For **local presence**, buy numbers in the **area codes you call most** (pull
  the top destination area codes from your lead list). Each area code you cover
  makes those leads see a local number.

### 6. Warm fresh / replacement numbers — don't blast day one
- Register each new number (Free Caller Registry + CNAM) **before** heavy use.
- Ramp gradually: light volume the first few days, increase as it builds trust.
- Retire the 817 from heavy use until its remediation clears; let rotation carry
  load across the warmed pool meanwhile.

## Ongoing hygiene (keeps labels off)
- Keep `rotateEvery = 1` so volume spreads evenly.
- Watch **answer rate** and **average call duration** per number; a number whose
  answer rate craters is getting flagged — pull it and remediate.
- Respect calling hours + DNC (already enforced in settings) — complaints feed
  the spam engines directly.
- Re-check reputation weekly via Free Caller Registry / Voice Integrity.

## Compliance note on local presence
Local presence here dials **from a real number the org owns** in the lead's area
code — not spoofing. That's the compliant pattern. (Displaying a number you don't
own / can't be called back = "neighbor spoofing", which is what TRACED-Act/STIR-
SHAKEN penalize. This implementation never does that.)
