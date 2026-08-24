<div align="center">

# ☀️ AIATWORK · Solar Resolution Dialer

**An Apple-grade, Twilio-powered AI outbound calling platform for solar organizations.**

Find homeowners still paying a utility bill *on top of* their solar payment, qualify them, and book account reviews — with high-volume parallel dialing, live team management, and an optional AI qualification agent.

</div>

---

## ✨ Highlights

- **Browser-based power dialer** — click-to-call, power, auto, and **3X parallel dialing**. No desk phones.
- **3X parallel dialing** — rings up to three homeowners at once; the first to answer connects instantly and the rest are released.
- **Solar resolution workflow** — capture billing, home profile (EV / pool / battery), and lifestyle changes inline while you talk.
- **Live call monitoring** — watch the floor in real time, listen in, and whisper-coach.
- **AI qualification agent** — an always-on agent that dials, qualifies, books appointments, and writes summaries.
- **Real-time analytics** — calls, connect rate, appointments, utility-bill insights, and leaderboards.
- **Gorgeous, accessible UI** — light & dark modes, fluid motion, fully responsive, WCAG-minded.

Built to the **AIATWORK Solar Resolution** spec: dialer, smart lead distribution, call recording, callbacks, appointments, campaigns, reports, leaderboards, rep & manager dashboards, and admin controls.

---

## 🧰 Tech stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 15** (App Router) + **React 19** |
| Language | **TypeScript** (strict) |
| Styling | **Tailwind CSS v4** with a custom solar design-token system |
| Motion | **Framer Motion** |
| Charts | **Recharts** |
| Icons | **Lucide** |
| Telephony | **Twilio Voice JS SDK** (browser) + **Twilio Node SDK** (server) |
| Theming | **next-themes** (light / dark / system) |

---

## 🚀 Getting started

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server
npm run dev

# 3. Open the app
open http://localhost:3000
```

The app runs in **Demo Mode** out of the box — every screen is interactive and the
dialer *simulates* live calls (parallel ringing, connect, talk timer, disposition),
so you can explore the entire product without any Twilio account.

---

## ☎️ Going live with Twilio

Copy the environment template and fill in your credentials:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
| --- | --- |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console → Account |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Console → Account → API keys & tokens |
| `TWILIO_TWIML_APP_SID` | Console → Voice → TwiML → TwiML Apps |
| `TWILIO_CALLER_ID` | A verified Twilio phone number (E.164) |
| `NEXT_PUBLIC_APP_URL` | A public URL Twilio can reach for webhooks (e.g. an ngrok tunnel in dev) |

Point your **TwiML App's Voice Request URL** at `{NEXT_PUBLIC_APP_URL}/api/twilio/voice`.

Once configured, the top bar flips from **Demo Mode** to **Twilio Live**, and the
dialer places real outbound calls through the browser. If credentials are missing
or incomplete, the platform automatically and gracefully falls back to simulation.

### How calling works

| Route | Purpose |
| --- | --- |
| `GET /api/twilio/token` | Mints a short-lived Voice access token for the browser SDK (or reports demo mode). |
| `POST /api/twilio/voice` | TwiML that dials the requested number with your caller ID and optional dual-channel recording. |
| `POST /api/twilio/call` | Initiates outbound legs for parallel dialing (conference-bridge pattern). |
| `POST /api/twilio/status` | Receives call & recording status callbacks. |

> **Note on parallel dialing:** single-line browser calling is fully wired end-to-end
> via the Voice SDK. True 3X bridging (dial N leads → bridge the first answer → cancel
> the rest) is orchestrated server-side via `/api/twilio/call` using a per-agent
> conference; the UI drives the live ring/connect/release visualization in all modes.

---

## 🔎 Reverse search (skip trace)

The dialer's lead card has a **Reverse search** button for managers and above
(`leads.reverseSearch`) that looks a homeowner's phone number up from their name
and address, then offers the results to save onto the lead.

It talks to a skip-trace **API**, not to a consumer people-search website. Sites
like whitepages.com forbid automated access and sit behind bot protection, so a
scraper would pass review and then quietly start returning nothing in
production — indistinguishable, on a dialer, from "this homeowner has no listed
number". Whitepages' own data is sold through Ekata (Mastercard), which is one
of the supported providers below.

| Variable | Value |
| --- | --- |
| `REVERSE_SEARCH_PROVIDER` | `ekata`, `endato`, `batchdata` or `whitepages` |
| `REVERSE_SEARCH_API_KEY` | The vendor's API key (for Endato: the AP **name**) |
| `REVERSE_SEARCH_API_SECRET` | Endato only — the AP **password** |

### The `whitepages` provider (browser + Claude)

`REVERSE_SEARCH_PROVIDER=whitepages` drives a headless Chromium to the
Whitepages results page for the lead, then hands the **rendered page text to
Claude** to pull the numbers out. Claude does the extraction deliberately: CSS
selectors against a site you don't control break silently on every redesign,
whereas "here is a page, find the phone numbers" survives them. There is not one
selector in `src/lib/leads/whitepages.ts`.

**Setup is two variables**, one of which you already have:

```
REVERSE_SEARCH_PROVIDER=whitepages
ANTHROPIC_API_KEY=...            # Claude does the extraction
```

No worker, no browser to install, no secret. The lookup is a plain HTTPS
request from the Next app, and Claude reads the numbers out of the returned
page.

<details>
<summary><b>Optional:</b> the scrape worker, for when direct lookups get blocked</summary>

The direct request executes no JavaScript and comes from Vercel's datacenter
IP, so it gets refused sooner than a real browser would. If that starts
happening, deploy `server/scrape-server.mjs` — a second Render service, already
defined in `render.yaml` — which drives a real headless Chromium and gets
through more often. Then set **both**:

| Variable | Value |
| --- | --- |
| `SCRAPE_WORKER_URL` | `https://aj-dialer-scrape-worker.onrender.com` |
| `SCRAPE_SECRET` | Any long random string — identical on both services |

The secret is not ceremony: the worker is a public URL that will fetch any page
you hand it, so without one, anyone who finds it can scrape through your Render
box, on your IP, at your expense. Setting `SCRAPE_WORKER_URL` without
`SCRAPE_SECRET` is refused with a message saying so, rather than 401-ing every
lookup silently.

Two more worker settings matter at volume: `SCRAPE_PROXY_URL` (point at a
rotating residential proxy — a datacenter IP gets refused long before a
residential one) and `SCRAPE_CHROMIUM_PATH` (only if your image ships its own
Chromium).

</details>

**Know what you're signing up for.** Whitepages forbids automated access in its
terms and actively blocks it, so expect bot challenges — more of them as volume
from one IP goes up. The design's one non-negotiable is that **being blocked is
reported as being blocked**: a challenge page renders as a red "Blocked, not
empty" notice, never as "no numbers found". Those two are indistinguishable to a
rep, and the second quietly reads as "this person has no listing" — which is how
a scraper rots in production without anyone noticing. Claude judges the page
state as well (`blocked` / `paywalled` / `no_results` / `results`), since it
recognises a challenge screen far more reliably than a keyword list.

**When a lookup can't be read automatically** — blocked, paywalled, or nothing
listed — the card offers the exact Whitepages URL to open in your own browser,
with a box to type the number straight onto the lead. Your browser has a real
IP and a real session and isn't being challenged, so this path keeps working
when automation doesn't.

The API providers above stay available and are what to switch to if the scraped
path stops being worth it — it is one env var.

Leave them unset and the button still works in demo mode, returning a reserved
`555-01xx` number (the NANP block set aside for fiction) clearly labelled as
such, so the flow is explorable without a vendor account and a demo result can
never route to a real person.

Results are **proposed, never auto-applied** — a skip-trace hit is a broker's
probabilistic match, so saving one is an explicit click that shows the number it
would replace. Anything on the org's Do-Not-Call list is dropped from the
results before they reach the screen, and the count of what was dropped is shown
rather than silently shrinking the list.

---

## 🗂️ Project structure

```
src/
├── app/
│   ├── (app)/                 # Authenticated app shell (sidebar + topbar)
│   │   ├── dashboard/         # Manager command center
│   │   ├── dialer/            # ⭐ The power dialer
│   │   ├── leads/             # Searchable, filterable lead table
│   │   ├── appointments/      # Scheduled account reviews
│   │   ├── callbacks/         # Due / overdue / upcoming callbacks
│   │   ├── monitor/           # Live call monitoring (real-time)
│   │   ├── leaderboard/       # Daily / weekly / monthly rankings
│   │   ├── campaigns/         # Campaign performance
│   │   ├── reports/           # Analytics + call records
│   │   ├── ai-agent/          # AI qualification agent
│   │   ├── admin/             # Users, CSV import, integrations, billing
│   │   └── settings/          # Profile, appearance, preferences
│   ├── api/twilio/            # Token, voice (TwiML), call, status routes
│   ├── page.tsx               # Marketing landing page
│   └── globals.css            # Solar design system (tokens, utilities, motion)
├── components/
│   ├── ui/                    # Primitives (button, card, badge, input, …)
│   ├── dialer/                # Dial pad, parallel lines, call stage, panels
│   ├── dashboard/             # Metric cards & charts
│   ├── layout/                # Sidebar, topbar, app shell
│   ├── marketing/             # Landing nav + animated dialing preview
│   └── …
└── lib/
    ├── twilio.ts              # Server config + token/REST helpers
    ├── use-dialer.ts          # Dialer state machine (live + simulation)
    ├── data.ts                # Rich seed data
    ├── types.ts               # Domain model
    └── utils.ts               # Formatters & helpers
```

---

## 🎨 Design system

A warm **solar** identity (gold → ember) paired with a deep-space dark mode, built on
semantic CSS variables in `globals.css`. Everything is token-driven (`--primary`,
`--surface`, `--success`, …) so light/dark and re-theming are trivial. Glassmorphism,
soft shadows, spring motion, and tabular numerics give it the Apple-grade feel.

---

## 💸 Pricing model (as built into the product)

- **Dialer Platform** — $15 / active rep / month
- **Solar Resolution AI Agent** — $175 / month + usage

---

## 📜 Scripts

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Run the production build
npm run lint     # Lint
```
