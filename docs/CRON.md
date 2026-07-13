# Scheduled jobs — why they don't live in `vercel.json`

**The schedule lives in Supabase (`pg_cron`), not on Vercel.** If you add a cron back to
`vercel.json`, deployments will start failing again. Read this first.

## What happened

This project runs two jobs that must fire **every minute**:

| Endpoint | What it does |
|---|---|
| `/api/cron/auto-dial` | Places unattended AI calls for every org whose automation window is open. |
| `/api/cron/reconcile-ai` | The backstop that guarantees every AI call reaches a terminal state — the thing that stops calls sitting "in progress" for hours. |

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

## If you upgrade to Vercel Pro

You can move the schedule back into `vercel.json` and drop the Postgres jobs — Pro allows per-minute
crons. Do **both** halves, or they'll double-fire:

```sql
select cron.unschedule('auto-dial');
select cron.unschedule('reconcile-ai');
```
