# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AIATWORK Solar Resolution Dialer — an Apple-grade, Twilio-powered AI outbound calling platform
for solar organizations. Reps find homeowners paying both a solar loan and a utility bill, qualify
them, and book account reviews. Supports power dialing, 3X parallel dialing, and an optional AI
calling agent (ElevenLabs Conversational AI).

## Stack

- Next.js 15 (App Router, RSC), React 19, TypeScript (strict)
- Tailwind CSS v4 (CSS-first, tokens in `src/app/globals.css`)
- Framer Motion (motion), Recharts (charts), Lucide (icons)
- Twilio Voice JS SDK (browser) + Twilio Node SDK (server)
- Supabase (auth + Postgres via RLS; `supabase/schema.sql` must be run once)
- ElevenLabs Conversational AI (optional — AI agent places and conducts calls)
- Claude / Anthropic API (optional — AI surfaces: briefings, copilot, summaries, reports)
- `@/*` → `src/*`

## Commands

- `npm run dev` · `npm run build` · `npm run lint`
- Always run `npm run build` before committing UI changes — it type-checks every route.
- Copy `.env.example` → `.env.local` and fill in credentials (never commit `.env.local`).
- After setting up Supabase credentials, run `supabase/schema.sql` in the SQL editor once.

## Route groups (app shell)

| Group | Path | Purpose |
|---|---|---|
| `(app)` | `/dashboard`, `/dialer`, `/leads`, … | Authenticated app shell (sidebar + topbar) |
| `(auth)` | `/login`, `/signup` | Unauthenticated onboarding |
| `(hub)` | `/hub` | Workspace selector — pick / create / join an org |
| `(superadmin)` | `/console` | Hidden platform oversight (god-mode) |

The `(app)` layout (`src/app/(app)/layout.tsx`) enforces auth, org membership, maintenance/paywall
gates before rendering. Superadmins bypass the kill switch and can never lock themselves out.

## Multi-org / multi-tenant system

`src/lib/org/membership.ts` is the org engine. Key functions:

- `getViewer()` — the canonical "who is this request?" call. Returns `Viewer` (user, org, role,
  effective permissions). Always call this in Server Components / API routes instead of reading
  auth or profile rows directly.
- `viewerCan(permission)` / `viewerCanAny(permissions[])` — lightweight server-side guards.
- `getScope()` (`src/lib/db/scope.ts`) — for pipeline / data API routes: returns `{ userId, orgId,
  supervisor }`. Use `canActOn(scope, rowOwnerId, rowOrgId)` to gate row-level reads/writes.

Users belong to one org at a time (`profiles.org_id`). The Hub lets them switch between orgs they
belong to. Orgs are created via the Hub or the Superadmin console.

## Role hierarchy & permissions

`src/lib/permissions.ts` — pure, importable from both server and client.

Hierarchy (high → low): `owner > admin > manager > rep`. The global `superadmin` sits above all.

- `ROLE_PERMISSIONS` — default permission set per role.
- `can(role, permission, overrides?)` — effective check (per-member overrides win).
- `effectivePermissions(role, overrides?)` — full set for the client.
- Key permissions: `admin.access`, `reports.view`, `leads.import`, `dialer.ai`, `monitor.view/listen/intervene`.

## Demo mode

When Supabase is unconfigured (`NEXT_PUBLIC_SUPABASE_URL` absent), `getViewer()` returns a demo
"Owner" of a demo Sunrun org with full permissions. `NEXT_PUBLIC_DEMO_DATA=true` populates screens
with sample data. The dialer, AI surfaces, and Twilio all have their own independent demo fallbacks —
nothing crashes when any credential is missing.

## AI layer (Claude)

`src/lib/ai/claude.ts` — the single entry point for all AI calls.

- `isAIConfigured()` — `ANTHROPIC_API_KEY` present.
- `runAI(task, fallback)` — runs Claude or falls back to a deterministic simulation, tagged with
  `source: "claude" | "demo"` so the UI shows a badge.
- `generateJSON` / `generateJSONLoose` — structured outputs via the Anthropic SDK.
- AI services (briefing, copilot, summary, report, search, chat) live in `src/lib/ai/services.ts`.
- All AI API routes are under `src/app/api/ai/`.

## Twilio

- Server config + helpers: `src/lib/twilio.ts`. API routes: `src/app/api/twilio/*`.
- The dialer state machine is `src/lib/use-dialer.ts`: real Voice SDK when configured, full
  **simulation** otherwise.
- Caller-ID rotation: `src/lib/dialer/rotation.ts`. Configurable per-org via Admin or env vars
  (`TWILIO_CALLER_IDS`, `DIAL_ROTATE_EVERY`).
- Everything must degrade gracefully to demo mode when env vars are absent — never crash without Twilio.

## ElevenLabs (AI agent calls)

`src/lib/elevenlabs.ts` — all ElevenLabs HTTP shapes. API routes under `src/app/api/elevenlabs/`.

- The agent dials homeowners, records, and posts transcripts back via `POST /api/elevenlabs/webhook`
  (signed with `ELEVENLABS_WEBHOOK_SECRET`).
- Bridge mode (`TWILIO_AI_BRIDGE_NUMBER`): AI calls go through a Twilio conference so anyone can
  listen live. Without it, the agent dials homeowners directly.
- `ELEVENLABS_USE_DASHBOARD_PROMPT`: must match the agent's "overrides" toggle in the ElevenLabs
  dashboard — mismatch causes the call to terminate the instant it connects.

## Data & domain

- Types: `src/lib/types.ts`. Seed data: `src/lib/data.ts` (swap for a DB later — keep the shapes).
- DB layer: `src/lib/db/` — one file per entity (`leads.ts`, `records.ts`, `metrics.ts`, …).
  All writes use the service-role client after application-code auth checks; reads use RLS.
- Formatters (currency, phone, duration, relative time, initials) live in `src/lib/utils.ts` — reuse them.

## Design system (use the tokens — never hardcode hex)

Semantic CSS variables drive light/dark. Use the Tailwind color utilities they map to:

- Surfaces: `bg-background`, `bg-surface`, `bg-surface-muted`, `bg-card`, `bg-muted`
- Text: `text-foreground`, `text-muted-foreground`
- Brand: `bg-primary` / `text-primary` / `bg-primary-soft`; gradient via `.bg-solar` & `.text-gradient-solar`
- Accent (sky): `accent` / `accent-soft`
- Semantic: `success`, `warning`, `danger`
- Radius: cards `rounded-2xl`, inputs/buttons `rounded-xl`
- Shadows: `shadow-soft` (rest), `shadow-lift` (hover), `shadow-glow` (brand)
- Numbers: add `.tabular` for steady metrics
- Effects: `.glass`, `.bg-grid`, `.bg-dots`, `animate-fade-up`, `animate-pulse-ring`

## Component conventions

- Reuse primitives in `src/components/ui` (`Button`, `Card`, `Badge`, `Avatar`, `Input`, `Progress`/`Ring`).
- Style links-as-buttons with `buttonVariants({ … })` — `Button` has **no** `asChild`.
- Page scaffolding: `PageContainer` + `PageHeader`; grouped content: `SectionCard`; KPIs: `MetricCard`.
- Status → tone/label mapping lives in `src/lib/status.ts`. Charts live in `src/components/dashboard/charts.tsx` (client).
- Keep Server Components the default; mark `"use client"` only when needed (state, motion, Twilio).

## Quality bar

- Light **and** dark must both look intentional. Responsive from mobile up. Respect `prefers-reduced-motion`.
- Prefer composition and tokens over one-off styles. Match the surrounding code's idiom.
