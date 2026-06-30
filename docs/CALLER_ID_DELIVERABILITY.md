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
  Toggle in **Admin → Dialing**.

**To activate tonight:** Admin → Dialing → paste all owned numbers into the
rotation pool (one per line), keep "Rotate every" at 1, flip on Local presence.
The code is ready the moment numbers are in the pool.

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
