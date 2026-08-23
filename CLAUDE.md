# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

ATLAS by AIATWORK — an Apple-grade, Twilio-powered AI outbound calling platform for **any** sales
organization. Reps load a book of contacts, qualify them on a call, and book whatever that
business books. Supports power dialing, 3X parallel dialing, and an optional AI calling agent
(ElevenLabs Conversational AI).

The product began life as a solar-resolution dialer, and solar remains one **vertical** among ten
(`src/lib/org/templates.ts`). Solar tenants must keep their exact wording; every other tenant must
never see it. Nothing user-facing may hardcode an industry noun — see "Workspace vocabulary" below.

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

- `npm run dev` · `npm run build` · `npm run lint` · `npm test`
- `npm run verify:ai` — proves the Claude connection, the model, and structured outputs really work.
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

## Workspace vocabulary (never hardcode an industry noun)

`src/lib/org/vocabulary.ts` — PURE, importable from Server and Client Components.

`orgVocabulary(org)` resolves what a workspace calls things, with one precedence everywhere:
the org's own `settings.leadNoun` → the vertical template's noun → a neutral default.

- `leadNoun` / `leadNounPlural` / `LeadNoun` / `LeadNounPlural` — "homeowner", "candidate", "lead"
- `appointmentNoun` — "account review", "showing", "interview"
- `noNeedLabel` — the label for the `bills_fine` disposition ("Bills are fine", "Not looking right now")
- `tagline` — the line under the wordmark

Server Components call `orgVocabulary(viewer.org)`. Client Components call `useVocabulary()`
(`src/components/layout/vocabulary.tsx`) — the app shell provides it. Status maps have
vocabulary-aware resolvers in `src/lib/status.ts`: `resolveOutcomeConfig`, `resolveLeadStatusConfig`,
`resolveOutcomeOptions`.

**Stored keys never move** (`bills_fine`, `solarPayment`, `utilityBill` … are on live rows and in
historical call records) — only the words a human reads. Field LABELS come from the org's resolved
schema (`resolveLeadFields`), not from literals.

## The call archive

`src/lib/db/call-archive.ts` + `/recordings` — every recording and transcript, searchable by name,
number, summary, rep notes, and what was said on the call. `call_records.transcript_text` is the
flattened, indexed copy (`flattenTranscript` in `src/lib/db/records.ts`); the structured turns stay
on `ai_conversations.transcript`. `call_records.notes` holds the rep's notes for THAT call
(`leads.notes` is the lead's current note and is overwritten by each call).

One detail view for both channels: `src/components/calls/call-detail-modal.tsx`.

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

- `AI_MODEL` defaults to `claude-opus-5`; override with the `AI_MODEL` env var. Model IDs take
  **no** date suffix.
- `isAIConfigured()` — `ANTHROPIC_API_KEY` present.
- `runAI(task, fallback)` — runs Claude or falls back to a deterministic simulation, tagged with
  `source: "claude" | "demo"` **and `error`** (why it fell back) so `AiSourceBadge` can say so.
- `generateJSON` / `generateJSONLoose` — structured outputs. `output_config.format` takes exactly
  `{ type, schema }`; adding a `name` 400s and silently degrades every surface to demo output.
- Thinking is ON by default on current models and shares the `max_tokens` budget — `callMessages`
  pads it. Do NOT "optimize" by disabling thinking: measured, it was slower AND truncated output.
  `output_config.effort` is the lever that works.
- Unknown/older models degrade gracefully: a 400 naming `thinking` / `effort` / `format` disables
  that knob for the process instead of failing the surface. `AI_FAST_MODE=true` opts into fast mode.
- AI services (briefing, copilot, summary, report, search, chat) live in `src/lib/ai/services.ts`.
- All AI API routes are under `src/app/api/ai/`.
- **Verify with `npm run verify:ai`** (add `--full` to exercise every surface against the live API);
  `/api/ai/health` reports the model, latency, and a plain-English failure reason.

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
