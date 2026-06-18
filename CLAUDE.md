# CLAUDE.md — AIATWORK Solar Resolution Dialer

Guidance for working in this repo. Keep the bar high: this product is meant to feel
**Apple-grade** — restrained, fluid, and beautifully consistent.

## Stack
- Next.js 15 (App Router, RSC), React 19, TypeScript (strict)
- Tailwind CSS v4 (CSS-first, tokens in `src/app/globals.css`)
- Framer Motion (motion), Recharts (charts), Lucide (icons)
- Twilio Voice JS SDK (browser) + Twilio Node SDK (server)
- `@/*` → `src/*`

## Commands
- `npm run dev` · `npm run build` · `npm run lint`
- Always run `npm run build` before committing UI changes — it type-checks every route.

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

## Data & domain
- Types: `src/lib/types.ts`. Seed data: `src/lib/data.ts` (swap for a DB later — keep the shapes).
- Formatters (currency, phone, duration, relative time, initials) live in `src/lib/utils.ts` — reuse them.

## Twilio
- Server config + helpers: `src/lib/twilio.ts`. API routes: `src/app/api/twilio/*`.
- The dialer state machine is `src/lib/use-dialer.ts`: real Voice SDK when configured, full **simulation** otherwise.
- Everything must degrade gracefully to demo mode when env vars are absent — never crash without Twilio.

## Quality bar
- Light **and** dark must both look intentional. Responsive from mobile up. Respect `prefers-reduced-motion`.
- Prefer composition and tokens over one-off styles. Match the surrounding code's idiom.
