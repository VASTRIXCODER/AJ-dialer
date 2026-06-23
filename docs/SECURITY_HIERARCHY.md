# Roles, permissions & security model

This dialer is multi-tenant. Access is governed on two planes.

## Platform plane (cross-tenant)

- **Platform Superadmin (hidden).** Tied to your **real Supabase login** — there
  is no separate password or cookie. You're a superadmin if your email is in
  `SUPERADMIN_EMAILS` (the bootstrap that can't be locked out) **or** your account
  is in the service-role-only `platform_admins` table (promote others from the
  Control Center). It is **never shown on your profile**; you appear as a normal
  member of your org and reach the **Control Center** from a discreet entry in the
  sidebar / hub. Superadmins can manage every org and account, suspend/restore,
  delete, flip the global kill switch, and grant platform access to others.

> This replaced the old separate superadmin password + `sa_session` cookie, which
> caused the "suspended user lands in the console" bug (a leftover/forgeable
> cookie) and shipped a hardcoded secret. Superadmin is now your identity.

## Organization plane (per org)

Roles, highest → lowest: **owner > admin > manager > rep**.

| Capability | Rep | Manager | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| Dial, work own leads/appointments/callbacks | ✅ | ✅ | ✅ | ✅ |
| Live Monitor — open it | — | ✅ | ✅ | ✅ |
| Live Monitor — listen to live calls | — | ✅ | ✅ | ✅ |
| Reports & analytics | — | ✅ | ✅ | ✅ |
| See join requests, approve & classify role | — | ✅ | ✅ | ✅ |
| Assign roles (below your own) | — | rep | rep/mgr | rep/mgr/admin |
| Edit org settings / branding / AI | — | — | ✅ | ✅ |
| Manage companies/teams | — | ✅ | ✅ | ✅ |
| Delete org / transfer ownership | — | — | — | ✅ |

Per-member permission **overrides** (grant/revoke a single permission) are set in
**Admin → Members**. Reps are blocked from the Live Monitor at the nav, the page,
**and** the APIs.

## How access is enforced (defense in depth)

1. **Middleware** — unauthenticated users can't reach app routes or `/console`.
2. **Server pages/routes** — every sensitive page and API re-checks the viewer's
   permission (`viewerCan`) or superadmin status server-side.
3. **Postgres RLS** — the real boundary. Each data table (`leads`, `call_records`,
   `appointments`, `callbacks`, `ai_conversations`, `campaigns`) is:
   - readable by the **owner**, by an **active supervisor of the row's org**, or a
     **superadmin**;
   - writable only by the **owner** (or superadmin);
   - **blocked entirely for suspended accounts** (`app_is_active()`).
   `org_id` is stamped on every row by a trigger, so app code can't forget it.
4. **Anti-escalation** — a trigger freezes privileged profile columns
   (`role`, `disabled`, `org_id`, `company_id`) against self-service edits, and
   superadmin lives in a service-role-only table users can't write.
5. **Suspension** — sets `profiles.disabled`, **bans the Supabase session**
   (immediate logout), and is enforced at the layout, the hub, and in RLS.
6. **Audit log** — `audit_log` records suspends, role changes, approvals,
   platform grants, and assignments.

## Live monitoring of human calls

Supervisors (manager+) can **listen live** to an in-progress rep↔customer call.
The rep's call leg is forked with Twilio Media Streams (both tracks = rep +
customer) to the same relay used for AI calls (`server/media-stream-server.mjs`),
then played in the browser. It's gated to `monitor.listen` and scoped to the
supervisor's own org. Requires `MEDIA_STREAM_URL` + `MEDIA_STREAM_SECRET` and
Twilio REST (see `docs/LIVE_AUDIO.md`); without them the transcript/presence still
work, just not live audio.

## Manual setup steps

1. **Run the schema.** Paste `supabase/schema.sql` into the Supabase SQL editor
   and run it (idempotent). It adds the new tables, columns, RLS, triggers, and
   bootstraps your superadmin by email. **Edit the email** in the final
   `platform_admins` bootstrap line if it isn't yours.
2. **Set the env var** in Vercel: `SUPERADMIN_EMAILS=you@example.com`
   (comma-separated for multiple). Remove the old `SUPERADMIN_USER` /
   `SUPERADMIN_PASSWORD` / `SUPERADMIN_SECRET`.
3. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set (account management + RLS helpers).
4. Sign in normally with that email → you'll see a discreet **Control Center**
   entry. Suspended users can no longer reach the console.
