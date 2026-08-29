# Scheduled jobs — why they don't live in `vercel.json`

**The schedule lives in Supabase (`pg_cron`), not on Vercel.** If you add a cron back to
`vercel.json`, deployments will start failing again. Read this first.

## What happened

This project runs two jobs that must fire **every minute**:

| Endpoint | What it does |
|---|---|
| `/api/cron/auto-dial` | Places unattended AI calls for every org whose automation window is open. |
| `/api/cron/reconcile-ai` | The backstop that guarantees every AI call reaches a terminal state — the thing that stops calls sitting "in progress" for hours. **Also drains the appointment-notification outbox** (see below). |

They were declared in `vercel.json` as `"schedule": "* * * * *"`. **Vercel's Hobby plan only allows
once-per-day crons.** A per-minute expression doesn't degrade or warn — it makes the whole
**deployment fail**:

```
Hobby accounts are limited to daily cron jobs. This cron expression (* * * * *)
would run more than once per day.
```

`vercel.json` was introduced in `ea02108` ("unattended AI calling scheduler"). From that commit
until this one, **every single deployment failed**. Production silently served ~13-day-old code, and
the unattended auto-dialer it was added to enable never ran once. The failure was invisible because
nothing was watching for a *missing* deploy.

So the crons are gone from `vercel.json`, and Postgres schedules them instead.

## How it works now

Supabase `pg_cron` fires each endpoint every minute via `pg_net`, sending the same
`Authorization: Bearer $CRON_SECRET` header Vercel Cron would have sent. Both routes already
supported this — they refuse to run without the secret and accept GET **and** POST precisely so an
external scheduler can drive them.

The secret is held in Supabase Vault, not inlined in the job definition.

## One-time setup (and after any rotation)

`CRON_SECRET` has to exist in **both** Vercel and Supabase. Vercel deliberately will not hand an
encrypted env var back out — `vercel env pull` returns empty values for them — so the value has to
be copied across by hand exactly once. There is no way around this that doesn't involve either
pasting a live credential through a third party or standing up an unauthenticated endpoint that can
write to the secret store. Do it by hand.

1. Vercel dashboard → **aj-dialer** → Settings → Environment Variables → copy the **Production**
   value of `CRON_SECRET`.
2. Supabase → **SQL Editor** → run this, pasting the value in place of `<PASTE>`:

```sql
select public.app_set_cron_secret('<PASTE>', 'https://aiatworkdialer.vercel.app');
```

3. Confirm both jobs start succeeding:

```sql
select j.jobname, r.status, r.start_time
from cron.job_run_details r join cron.job j using (jobid)
order by r.start_time desc limit 6;
```

Until step 2 is done, `app_fire_cron()` raises and every run is recorded as **failed** in
`cron.job_run_details` — deliberately loud, rather than silently firing unauthenticated requests
that would 401 forever.

Inspect the jobs:
```sql
select jobid, jobname, schedule, active from cron.job;
```

Recent runs (this is where you look when calls stop being reconciled):
```sql
select j.jobname, r.status, r.start_time, r.return_message
from cron.job_run_details r
join cron.job j using (jobid)
order by r.start_time desc
limit 20;
```

The HTTP responses themselves (`pg_net` is async — a `succeeded` job only means the request was
*sent*, not that it returned 200):
```sql
select id, status_code, content, created
from net._http_response
order by created desc
limit 20;
```

`status_code = 401` means `CRON_SECRET` in Vault no longer matches Vercel's.
`status_code = 503` means `CRON_SECRET` isn't set in Vercel at all.

### Rotating `CRON_SECRET`

Change it in **both** places or the jobs start 401ing:
```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'cron_secret'),
  '<new value>'
);
```
…and update the `CRON_SECRET` environment variable in the Vercel dashboard.

### Target URL

The jobs call `https://aiatworkdialer.vercel.app`, **not** `www.aiatworkdialer.com`. The `www` host
is proxied through Cloudflare, which sits in front of Vercel and can fail independently (a
Cloudflare origin problem returns 522 while Vercel is serving 200 perfectly well). Machine-to-machine
traffic has no reason to take that hop.

If the Vercel domain ever changes, update it:
```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'cron_base_url'),
  'https://<new-host>'
);
```

## Appointment notifications ride the reconciler's tick

The "email the sales lead when an appointment is set" outbox (`docs/APPOINTMENTS.md`) is drained
from inside `/api/cron/reconcile-ai`, **not** from a job of its own — deliberately.

Everything on this page is the reason why. The schedule is hand-applied SQL that lives in
Supabase and not in this repo, so **a new job is a step someone can forget** — and a forgotten
job here would mean the appointment email silently never sends, which is the exact failure mode
the feature exists to prevent. Riding a tick that already exists means it works the moment the
code deploys, with nothing to remember.

The drain runs *before* the reconciler's telephony guard (so email still flows in a workspace
with no Twilio credentials) and takes a tight 8-second slice of the 60-second budget; the
reconciler gets the remaining 45.

### Optional: give it its own job

If you'd rather the email path didn't share a budget with the reconciler, `/api/cron/notifications`
is a standalone drain with the same auth contract. Schedule it the same way as the others:

```sql
select cron.schedule(
  'notifications',
  '* * * * *',
  $$ select public.app_fire_cron('/api/cron/notifications') $$
);
```

Running **both** is harmless: the drain claims a row by flipping its status before sending, so a
double-fire never sends the same email twice.

## reconcile-data — the Phase-1 data reconciliation job (every 15 minutes)

`/api/cron/reconcile-data` is the slow-lane integrity sweep behind the Phase-1 data contracts
(same auth contract as the others — `Authorization: Bearer $CRON_SECRET`, GET or POST). Each
tick it runs three bounded, individually best-effort repairs:

1. **Attempt-counter drift** — recounts `call_records` for leads touched in the last 48h and
   repairs `leads.attempt_count` / `last_attempt_at` where they disagree. The counter is bumped
   at dial time while records land at disposition time, so crashes and replays can skew it —
   and it drives never-dialed-first queue ordering and max-attempt gates.
2. **Stuck attempts** — `call_attempts` sitting in a non-terminal state for 30+ minutes are
   force-finished through `attempt.reconciled` (the one sanctioned corrector in
   `apply-event.ts`): `completed` when a `call_records` row proves the call happened,
   `no_answer` when there's still no record after 2 hours.
3. **Metric drift** — for each active org, re-runs `app_metrics_summary` for *yesterday*
   (org-local day) and independently head-counts `call_records` for the same window/scope.
   Disagreements are logged to `audit_log` as `metric_drift` with both numbers.

The report JSON returned by each run breaks all three down; telemetry counters
(`reconcile.counter_repairs`, `reconcile.stuck_reconciled`, `reconcile.metric_drift`) land in
`ops_metrics` — zeros included, as proof the job ran.

Schedule it once the endpoint has deployed (the B4 checkpoint — before that it 404s every
15 minutes). This is the commented statement in `supabase/cron.sql`:

```sql
select cron.schedule('reconcile-data', '*/15 * * * *',
  $job$ select public.app_fire_cron('/api/cron/reconcile-data') $job$);
```

## If you upgrade to Vercel Pro

You can move the schedule back into `vercel.json` and drop the Postgres jobs — Pro allows per-minute
crons. Do **both** halves, or they'll double-fire:

```sql
select cron.unschedule('auto-dial');
select cron.unschedule('reconcile-ai');
```
