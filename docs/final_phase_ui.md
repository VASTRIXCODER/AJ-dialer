# AIATWORK Dialer · UI/UX Teardown and Rebuild Specification

**Version** 2.0 · **Compiled** 29 August 2026 · **Target** `aiatworkdialer.vercel.app`
**Decisions locked with the product owner:** cinematic direction, build-ready depth, full shell rebuild.

---

## How to read this document

This is written to be executed from, not admired. Three conventions:

| Marker | Meaning |
|---|---|
| **[M]** | Measured directly in the running application. Computed styles, DOM geometry, or a screenshot with the value visible on screen. |
| **[D]** | Derived from two or more measured values, with the arithmetic shown. |
| **[U]** | Unverified. Stated as a gap, never as a fact. |

Every token value in Part II is a real value, contrast-checked against every surface it can sit on. Every acceptance criterion in Part IV is written so it can be answered yes or no by looking at a build. Nothing in the defect register is inferred from a screenshot alone.

---

## Table of contents

**Part I · Diagnosis**
1. [Executive summary](#1-executive-summary)
2. [Coverage map](#2-coverage-map)
3. [Seven root causes](#3-seven-root-causes)
4. [Defect register](#4-defect-register)

**Part II · The system**
5. [Stage and Instrument](#5-stage-and-instrument)
6. [Colour](#6-colour)
7. [Typography](#7-typography)
8. [Space, radius, elevation](#8-space-radius-elevation)
9. [Motion and the cinematic layer](#9-motion-and-the-cinematic-layer)

**Part III · Architecture**
10. [The shell](#10-the-shell)
11. [Navigation and information architecture](#11-navigation-and-information-architecture)
12. [The overlay system](#12-the-overlay-system)
13. [Loading, empty and error states](#13-loading-empty-and-error-states)
14. [The metric definition layer](#14-the-metric-definition-layer)

**Part IV · Screens**
15. [Power Dialer](#15-power-dialer)
16. [Dashboard](#16-dashboard)
17. [Leads](#17-leads)
18. [Callbacks](#18-callbacks)
19. [Appointments](#19-appointments)
20. [Live Floor](#20-live-floor)
21. [Reports and Leaderboard](#21-reports-and-leaderboard)
22. [Recordings](#22-recordings)
23. [Assignments, No need right now, Campaigns](#23-assignments-no-need-right-now-campaigns)
24. [Admin](#24-admin)
25. [Superadmin Console](#25-superadmin-console)
26. [Hub and Settings](#26-hub-and-settings)

**Part V · Components**
27. [Component inventory](#27-component-inventory)

**Part VI · The edge**
28. [Compliance surface](#28-compliance-surface)
29. [Keyboard model](#29-keyboard-model)

**Part VII · Quality**
30. [Accessibility gates](#30-accessibility-gates)
31. [Performance budgets](#31-performance-budgets)
32. [Test strategy](#32-test-strategy)

**Part VIII · Execution**
33. [Rebuild sequence](#33-rebuild-sequence)
34. [Definition of done](#34-definition-of-done)
35. [Appendix: measurement log](#35-appendix-measurement-log)
36. [Appendix: sources](#36-appendix-sources)

---
---

# PART I · DIAGNOSIS

## 1. Executive summary

The product is not ugly. It is **undecided**. Every screen answered its own design questions locally and nothing answered them globally, and the residue of that is what reads as "vibecoded."

There is real substance underneath. The AI briefing on the Power Dialer, carrying priority score, appointment probability, opportunity value, contact and qualification probability, likely objections, a suggested opening line and a close, is better than what most funded dialers ship. The integration surface is complete: Supabase, Claude, ElevenLabs, Twilio Voice, Twilio REST and Resend all report connected. The compliance primitives exist: a DNC list that scrubs on every dial and on import, caller ID rotation across eleven numbers, an org-policy recording flag. Somebody built a serious product here.

Then it renders like this.

### The three findings that outrank everything else

**1. Every overlay in the product is transparent.** [M] Opened three independent overlays. All three render with no opaque surface and no scrim, so the page underneath shows straight through and both layers become unreadable.

| Overlay | What happened |
|---|---|
| New appointment modal | Form labels WHEN, DURATION, ASSIGNED TO, LOCATION, NOTES render interleaved with the KPI tiles and the calendar toolbar behind them. |
| Command palette | The nine navigation entries render on top of the KPI tiles; the "Workspace" and "Team" group labels collide with "Agent 2", "Rep" and "All reps". |
| Notifications panel | "You're all caught up." renders directly on top of "1 of 3687" and "0 dials". |

This was invisible in a first pass because you have to open an overlay to see it. It is the single most damaging defect in the application and it is almost certainly one shared component.

**2. Loading states render as zeros, not as skeletons.** [M] During any route or view transition, KPI values paint `0` before the real value arrives.

- Appointments mid-transition: `UPCOMING 0 / Scheduled ahead`, then `57` two seconds later.
- Superadmin Console: `ORGANIZATIONS 0` and `ACCOUNTS 1` rendered directly above a list of eleven organisations with 8, 15 and 2 members.

This is the mechanism behind a large share of the "the numbers disagree" complaints. A zero that means "not loaded yet" is indistinguishable from a zero that means "none," and on a metrics screen that is the difference between calm and panic.

**3. The sidebar unmounts during navigation.** [M] On every route change the navigation list collapses to one or two dimmed items and then repopulates. Confirmed on Live Floor tab switching and on the Appointments view switch. The one element in the product whose entire job is to be persistent is not.

### What the rest of the audit found

| Class | Count | Worst example |
|---|---|---|
| Overlay and shell | 9 | Every overlay transparent |
| Data integrity and trust | 21 | "All caught up" above 31 overdue appointments |
| Design system | 18 | `--primary` and `--danger` are the same hue in dark mode |
| Navigation and IA | 14 | 39% of primary nav hidden behind a scroll |
| Accessibility | 12 | 10px labels at 60% alpha on an already-muted token |
| Security and destructive actions | 6 | Nine org join codes in plaintext on one screen |
| **Total** | **80** | |

### The direction, and the one constraint on it

Cinematic is the right instinct for a product sold to sales floors. It needs one constraint or it will make the tool worse for the person using it eight hours a day, and that constraint comes from the two most rigorous spatial design systems in the industry rather than from taste.

> Apple, Human Interface Guidelines, Spatial layout: *"In general, avoid adding depth to text. Text that appears to hover above its background is difficult to read, which slows people down and can sometimes cause vision discomfort."* And: depth *"may not work as well on small objects."*
>
> Material 3, Elevation: *"When it comes to applying shadows, less is more. The fewer levels in your UI, the more power they have to direct attention and action."*

So: **cinema belongs to the Stage, silence belongs to the Instrument.** Depth, glass, volumetric light and orchestrated motion go on the shell, the sign-in, the org picker, the idle and empty states, and the moment a call connects. The queue table, the disposition grid, the lead record and every number a rep reads stay flat, dense, high contrast and completely still. Full model in [section 5](#5-stage-and-instrument).

---

## 2. Coverage map

### Audited

| Surface | Route | Depth reached |
|---|---|---|
| Dashboard | `/dashboard` | Full page, both themes, desktop and 430px |
| Power Dialer | `/dialer` | Dial queue tab, Booked tab, idle state, full scroll, Load leads attempt |
| Leads | `/leads` | Full page, column analysis across 50 rows, filter bar, both themes |
| Assignments | `/assignments` | Full table |
| Appointments | `/appointments` | List, Month, Day views, New appointment modal |
| Callbacks | `/callbacks` | All three kanban columns, card anatomy, mobile |
| No need right now | `/bills-fine` | Full page |
| Live Floor | `/monitor` | Floor, Calls, History tabs |
| Team Status | `/monitor/team` | Full page (empty state) |
| Reports | `/reports` | KPI row, conversion funnel, cost and usage header |
| Leaderboard | `/leaderboard` | KPI row, podium, ranking header |
| Recordings | `/recordings` | List, filter row |
| Campaigns | `/campaigns` | Empty state |
| AI Agent | `/ai-agent` | Paywall state |
| Admin | `/admin` | All six tabs: Members, Organization, Notifications, Companies, Activity log, Data and integrations |
| Console | `/console` | All four tabs: Overview, Organizations, Accounts, App Control |
| Settings | `/settings` | Full page |
| Hub | `/hub` | Full page |
| Command palette | global | Opened via Ctrl K |
| Notifications | global | Opened from header |

**Instrumentation used:** computed style extraction, DOM geometry measurement, per-column emptiness analysis across rendered rows, WCAG 2.x relative-luminance contrast computation on every leaf text node in both themes, nav scroll-height measurement, viewport tests at 1512×950, 1440×900 and 430×900.

### Not audited, and why

| Surface | Reason |
|---|---|
| Live call, dialing, wrap and disposition states | Reaching them requires starting a real dialing session, which places actual calls to real people in the production queue. Not done without explicit instruction. Specs for these states in [section 15](#15-power-dialer) are marked **[U]** and derived from the idle UI. |
| Import Studio | Behind "Open the Import Studio"; entering an import flow against a live 12k-lead account risks mutating production data. |
| Sign-up and sign-in | Would require creating an account or signing out of the live session. |
| Destructive confirmations | Suspend, Delete, Shut down app, Make platform. Not clicked. The absence of a visible confirmation step is noted as a design observation, not as a verified behaviour. **[U]** |
| Reports lower sections | Cost and usage, disposition breakdown, team performance. Header seen, body not scrolled. |

**Recommendation:** run the live-call sweep against a staging org with test numbers before Phase 3 begins. The four call states are where the product's value concentrates and they are the one part of it this audit could not see.

---

## 3. Seven root causes

Eighty symptoms come from seven decisions. Fix the generators and most of the register closes without being worked individually.

### Cause 1 · The token file exists and nothing obeys it

A complete semantic scale is defined for both themes. Components then bypass it with literal values.

```
/* defined in the stylesheet, dark theme */
--primary   hsl(0 86% 62%)      /* red */
--danger    hsl(352 84% 62%)    /* red, 8 degrees away */
--ring      hsl(0 86% 62%)      /* red */
--accent    hsl(350 85% 64%)    /* red */

/* what the primary button actually paints */
background-image: linear-gradient(135deg, #3D50F5, #298DFF 52%, #24D6F9);
class:            "... focus-visible:ring-ring ..."

/* result: a blue button with a red focus ring */
```
**[M]** Two consequences, both live today:

1. Keyboard focus on the primary CTA draws a red ring on a blue button.
2. At token level, "confirm" and "destroy" are the same colour. Any component that correctly reads `--primary` for a confirm action and `--danger` for a destructive one produces two identical buttons.

The `/console` route is the only place `--primary` renders as designed, which is why the Console looks like a different product. It is not a different product. It is the only part of the app using its own tokens.

### Cause 2 · Overlays have no surface

**[M]** Three of three overlays tested render transparent. There is no opaque background on the panel and no scrim behind it. Content beneath shows through at full strength.

The likely mechanism, from the DOM: the app renders overlays into a fixed container and relies on an enter animation for opacity, but the resting state has `background-color` unset or fully transparent, and no separate overlay element paints a scrim. The single fix is one `<Overlay>` primitive with a mandatory opaque surface token and a mandatory scrim. See [section 12](#12-the-overlay-system).

### Cause 3 · Loading renders as data

**[M]** Transitions paint `0` into value slots rather than a skeleton. Observed on Appointments (`UPCOMING 0` then `57`) and on Console Overview (`ORGANIZATIONS 0` above eleven listed organisations).

Two costs. The obvious one is that users see wrong numbers. The subtler one is that it makes real zeros meaningless: once a rep learns that a zero might just be a loading artefact, "NEEDS REVIEW 0" stops carrying information even when it is true.

### Cause 4 · Every screen invents its own controls

**[M]** Four navigation paradigms are live at once: a sidebar, page-level tabs on Admin and Console, segmented controls on Dialer, Appointments and Live Floor, and pill filter rows nearly everywhere. Within a single screen it gets worse.

The Leads control bar, left to right:

1. An unlabelled circular magnifier button
2. A "Filters" button whose accessible name is the tooltip text `Build a typed filter (any field, any operator)`, not its visible label. That is a WCAG 2.5.3 Label in Name mismatch.
3. A "My leads" toggle
4. Four native `<select>` elements
5. Two rows of pill toggles

Five filtering idioms, one bar. Native selects appear again inside every Callbacks card, inside every Admin member row, and twice in every one of the fifty Console account rows. **[D]** That last one is roughly 100 native selects on a single page.

### Cause 5 · The data model renders directly to screen

**[M]** The Leads table exposes thirteen columns. Measured across all fifty rendered rows:

| Column | Empty | Note |
|---|---|---|
| Lead | 0% | |
| Location | 0% | |
| Campaign | 0% | Every row reads "California". Zero variance. |
| Status | 0% | |
| Monthly bill ($/mo) | **100%** | |
| `contact_id` | **100%** | Raw schema name |
| `middle_initial` | **100%** | Raw schema name |
| `generational_suffix` | **100%** | Raw schema name |
| `primary_mailing_city` | **100%** | Raw schema name |
| Profile | **100%** | |
| AI | **100%** | |

Table width 1809px inside an 1173px container. **[D]** 636px sits behind a horizontal scrollbar, and every column hidden there is empty.

The same pattern recurs: Callbacks cards render `Other numbers: +16018190415, +15107827982, +14085579571; Other emails: uppalrajan@yahoo.com` as a raw semicolon-delimited dump. Booked appointments render `10916 Briaroaks Dr, Fort Worth, Tx 76140, 10916 BRIAROAKS DR, 5716 REMING...` with the same address twice in two casings.

### Cause 6 · No metric definition layer

**[M]** The same quantity reports different values on different screens, with no visible scoping to explain why.

| Quantity | Values observed |
|---|---|
| Connect rate | 0.0% (Dashboard) · 6.0% (Reports) · 2% (Leaderboard) |
| Total leads | 12,419 → 12,248 (Leads, two loads) · 12,530 → 12,358 (dialer pool) · 12,358 (Admin) |
| Queue depth | 12,234 → 12,069 (chip) · 3,842 → 3,687 (dial queue) · 384 (my leads) |
| Appointments | 57 (Dashboard, "90d") · 57 (Reports, "all time") · 18 (Admin) · 20 → 0 (dialer Booked tab) |
| DNC suppressed | 111 → 110 (Leads KPI) · **157** (Admin, Companies tab) |
| Never dialed | 10,013 → 9,989 (Leads) · 9,989 (Admin) |
| Active reps | 12 cards (Live Floor) · 9 "active reps" (Leaderboard) · 15 "on the floor" (Leaderboard, same screen) |
| Campaigns | Every lead tagged "California" · Campaigns page: "No campaigns yet" |

Some drift across a 40-minute audit window is real activity. **DNC 110 versus 157 is not**, and neither is the appointments spread, and neither is a campaign that exists on every lead row and on no campaigns page.

### Cause 7 · Decoration outranks state

**[M]** The loudest pixels on any screen are ambient. Radial background glows sit behind cards. A blue-to-cyan gradient sits under every primary button label. The Leaderboard renders a 3D podium with a crown. Meanwhile:

```
Section labels "WORKSPACE" / "TEAM" / "SYSTEM"
  font-size:  10px
  color:      var(--muted-foreground) at 60% alpha
  measured:   fails 4.5:1

Header, class "glass"
  background:       rgba(13, 19, 31, 0.55)
  backdrop-filter:  none      ← nothing is actually blurred
```

The header is why the search field visibly collides with "UNIVERSITY PARK" and with the caller-ID chips the moment the dialer scrolls. A translucent bar with no blur is just a window.

---

## 4. Defect register

80 items. Severity is impact on the person using the product, not effort to fix.

- **P0** blocks or misleads. Ship-stopping.
- **P1** materially degrades the work. Fix inside the rebuild.
- **P2** polish. Fix when the surface is touched anyway.

### P0 · Blocking (23)

| # | Area | Defect | Evidence |
|---|---|---|---|
| 1 | Overlays | New appointment modal renders with no opaque surface and no scrim. Form labels interleave with page content behind. | [M] |
| 2 | Overlays | Command palette renders transparent. Nav entries collide with KPI tiles and toolbar controls. | [M] |
| 3 | Overlays | Notifications panel renders transparent. "You're all caught up." paints on top of "1 of 3687". | [M] |
| 4 | Shell | Sidebar nav unmounts on every route change, collapsing to one or two dimmed items before repopulating. | [M] |
| 5 | Shell | Loading states paint `0` into value slots instead of skeletons. | [M] |
| 6 | Shell | Console Overview shows `ORGANIZATIONS 0` and `ACCOUNTS 1` above a list of 11 organisations. | [M] |
| 7 | Tokens | Dark `--primary` hsl(0 86% 62%) and `--danger` hsl(352 84% 62%) are the same hue. Confirm and destroy are visually identical. | [M] |
| 8 | Tokens | Primary CTA paints a literal gradient while carrying `focus-visible:ring-ring`, producing a red focus ring on a blue button. | [M] |
| 9 | Header | `.glass` sets `rgba(13,19,31,.55)` with `backdrop-filter: none`. Page content reads through the header and collides with it on scroll. | [M] |
| 10 | Appointments | "NEEDS REVIEW 0 / All caught up" renders as the largest element on the page, above 31 overdue appointments dating to 2 July. | [M] |
| 11 | Trust | Connect rate reports 0.0%, 6.0% and 2% on three screens with no visible scoping. | [M] |
| 12 | Trust | DNC suppressed reads 110 on Leads and 157 on Admin, same session. | [M] |
| 13 | Trust | Campaigns page reads "No campaigns yet" while every Leads row carries campaign "California". | [M] |
| 14 | Trust | Booked tab count moved 20 → 0 within one session with no dialing activity. | [M] |
| 15 | Trust | Reports funnel labels appointments "4.6% of connects" but draws the bar against dials (57 / 20,622 = 0.28%). | [M] |
| 16 | Power Dialer | Screen is 2.3 viewport heights. Start session, opening line, disposition and notes are never co-visible. | [M] |
| 17 | Power Dialer | Lead identity truncates in the left column: "UNIVE…", "(925) 68…", "America/Los_A". The phone number is clipped, in a dialer. | [M] |
| 18 | Nav | 741px of nav content in a 451px scroll area. 290px (39%) hidden, including six destinations and an entire SYSTEM group. | [M] |
| 19 | Mobile | At 430px the floating header overlays the Leads filter row and Callback card content. WCAG 2.4.11 risk. | [M] |
| 20 | Console | "Shut down app" appears on two tabs, neither with a visible confirmation gate. | [M] |
| 21 | Console | Nine organisation join codes render in plaintext on the Organizations tab (ED7B9AB, F911E01, QAROSTER, LL2Y4QM, AHRCLL9 and others). | [M] |
| 22 | Admin | Join code F911E01 renders in plaintext on the default tab with no mask or reveal. | [M] |
| 23 | Console | "Make platform" grants platform-level privilege at the same visual weight as "Suspend", with no confirmation. | [M] |

### P1 · Major (34)

| # | Area | Defect | Evidence |
|---|---|---|---|
| 24 | Tokens | Console is a second visual system: no sidebar, red accent, black ground, different header. | [M] |
| 25 | Type | Bimodal scale. 467 elements at 16px, 185 at 14px, 100 at 11px, 82 at 12px, 7 at 36px, 4 at 10px. H1 is 28px, H3 is 16px, no H2 exists in the document. | [M] |
| 26 | Type | Heading hierarchy skips H2 entirely. Screen-reader outline is broken on every page. | [M] |
| 27 | Radius | Computed radii are 12.2, 15.2, 19.2 and 25.2px plus a 33,554,432px pill. Derived from calc, not from a chosen scale. | [M] |
| 28 | Elevation | Eight distinct box-shadow values in use for what should be three or four planes. | [M] |
| 29 | Contrast | Dark theme: WORKSPACE / TEAM / SYSTEM at 10px with 60% alpha over an already-muted token fail 4.5:1. | [M] |
| 30 | Contrast | Light theme: six measured failures including avatar initials at 2.13:1 and primary blue at 3.78:1. | [M] |
| 31 | Light theme | Sidebar stays dark navy while content flips to a washed light-blue gradient. Two halves from different products. | [M] |
| 32 | Nav | Nav label "Live Monitor" versus page title "Live Floor". | [M] |
| 33 | Nav | Active state matches by prefix. On `/monitor/team` both Live Monitor and Team Status render active. | [M] |
| 34 | Nav | Four navigation paradigms live simultaneously. | [M] |
| 35 | Mobile | Search and command palette are dropped entirely below the desktop breakpoint. No bottom bar. | [M] |
| 36 | Palette | The header hint chip reads ⌘K but only Ctrl K opens the palette. Wrong modifier for the platform. | [M] |
| 37 | Leads | 8 of 13 columns are 100% empty across all 50 rendered rows. | [M] |
| 38 | Leads | Header casing mixes Title Case with raw `contact_id`, `middle_initial`, `generational_suffix`, `primary_mailing_city`. | [M] |
| 39 | Leads | Table 1809px inside 1173px container. 636px behind horizontal scroll, all of it empty columns. | [M] |
| 40 | Leads | No sticky header. Column headers scroll away, then sit behind the floating search bar. | [M] |
| 41 | Leads | Five filtering idioms in one bar. | [M] |
| 42 | Leads | "Filters" button's accessible name is its tooltip text, not its visible label. WCAG 2.5.3. | [M] |
| 43 | Leads | Eight stat tiles in a clipped strip with truncated labels ("PREVIOUSLY ATT…", "ARCHIVED / INVA…"). | [M] |
| 44 | Leads | Two promotional banners consume ~180px above the data on every visit. | [M] |
| 45 | Global | Native `<select>` used throughout: Leads filters, every Callbacks card, every Admin member row, twice per Console account row. | [M] |
| 46 | Power Dialer | Eleven caller-ID numbers rendered as raw chips consuming the top of the session panel. | [M] |
| 47 | Power Dialer | Status strip mixes mode toggles, session counters and system state in one undifferentiated row of ten chips. | [M] |
| 48 | Power Dialer | Two competing primary CTAs, both blue gradient: "Start Dialing" in the header and "Start session" in the centre. | [M] |
| 49 | Power Dialer | Manual dial button is green, colliding with `--success` semantics. | [M] |
| 50 | Power Dialer | AI briefing, the strongest asset in the product, is confined to a narrow right rail below the fold. | [M] |
| 51 | Callbacks | 77 items due now with no queue mode. Each requires individual clicks through a kanban card. | [M] |
| 52 | Live Floor | Twelve identical "Offline / Not on a call / 0:00" cards render while the header reads 0 live, 0 connected, 0 online. | [M] |
| 53 | Live Floor | Idle timers (1:09, 4:24) render beside "Not on a call" in the same format as call durations, unlabelled. | [M] |
| 54 | Live Floor | History table's DETAILS column is clipped at the right edge; "View →" is cut off. | [M] |
| 55 | Assignments | Rows at 32/32 worked still carry status "Active". Rows with 0 leads also carry "Active". | [M] |
| 56 | Recordings | 20,622 calls with no default filter. Actual conversations buried under five-second no-answers. | [M] |
| 57 | Admin | Environment variable names `APPOINTMENT_NOTIFY_EMAILS` and `RESEND_FROM` exposed in end-user admin copy. | [M] |

### P1 continued and P2 · Polish (23)

| # | Area | Defect | Evidence |
|---|---|---|---|
| 58 | Admin | Do Not Call list, a compliance-critical surface, is buried as the second card under the "Companies" tab. | [M] |
| 59 | Admin | DNC list renders all 157 numbers unpaginated and unvirtualised, with no search and no date column. | [M] |
| 60 | Admin | DNC entries carry no request date, though the obligation runs 5 years from the request. | [M] |
| 61 | Admin | Integrations panel layout collapses; descriptions render one word per line ("Auth + per- account data persistence"). | [M] |
| 62 | Admin | Six-tab row wraps to a second line, orphaning "Data & integrations". | [M] |
| 63 | Admin | Brand colour and accent colour are both `#2563eb`, and neither matches any app token. | [M] |
| 64 | Admin | Editing the tagline replaces the product name in the sidebar; "Donny's Dialer" became "Manual outbound calling". | [M] |
| 65 | Admin | Recipients placeholder is `brock@example.com`, a real-looking personal name. | [M] |
| 66 | Admin | Icon-only destructive controls (shield, crown, trash) in member rows with no accessible names. | [M] |
| 67 | Console | 50 account rows render at once with no pagination, search or filter. | [M] |
| 68 | Console | Suspend, Make platform and Delete sit adjacent at equal weight in every row. | [M] |
| 69 | Console | "Build with AI" is the brightest control on the Organizations tab and it is red, which means destructive everywhere else. | [M] |
| 70 | Console | App Control page is ~80% empty space around one card. | [M] |
| 71 | Appointments | Toolbar changes shape between List, Month, Week and Day views. Muscle memory breaks per view. | [M] |
| 72 | Appointments | Day view calendar clips its first hour row ("6 AM" cut at the scroll boundary). | [M] |
| 73 | Appointments | Rescheduling is drag-only, with no stated keyboard alternative. | [M] |
| 74 | Appointments | SHOW RATE renders 0% with no valid denominator, presented as a headline KPI. | [M] |
| 75 | Callbacks | Raw dump in cards: "Other numbers: …; Other emails: …" semicolon-delimited. | [M] |
| 76 | Callbacks | Cards where the phone number is both title and subtitle because the contact has no name. | [M] |
| 77 | Callbacks | Items in the "Due now" column carry "No time set". | [M] |
| 78 | Leaderboard | Podium with crown and gradient bar is stylistically unrelated to every other screen. | [M] |
| 79 | Hub | Two organisations both named "Sunrun", separable only by subtitle. Nine cards, no search, no sort, no last-used. | [M] |
| 80 | AI Agent | Paywall directs the signed-in owner to email `anasupalle17@gmail.com`, a misspelling of their own account, exposing a personal address as the support channel. | [M] |

---
---

# PART II · THE SYSTEM

## 5. Stage and Instrument

One rule governs the rebuild. Every pixel belongs to exactly one layer, and the two layers have opposite rules.

### Layer A · The Stage

Where the rep is arriving, waiting, choosing or celebrating. Nothing here is read for eight hours.

**Surfaces:** sign-in, org picker, session setup, empty and idle states, "ready to dial", "queue cleared", the connect moment, the wrap-up moment, shell chrome (sidebar ground, command palette scrim, modal backdrop), Leaderboard, end-of-day summary.

**Permitted:** parallax, backdrop blur, glass, bloom, film grain, 3D transforms, orchestrated sequences up to 900ms, WebGL or canvas ambient fields.

### Layer B · The Instrument

Where the work happens. Read hundreds of times per shift, under time pressure, often while talking.

**Surfaces:** the lead queue table and every data grid, the live call bar, disposition controls, notes, the lead record, call history, the AI briefing, all forms, all filters, admin, settings, every number, every counter, every timer.

**Forbidden:** gradients on functional surfaces, glow, blur behind text, shadows above level 2, any motion that translates or scales, decorative colour.

### Why the split is not a compromise

| Source | What it says | Consequence here |
|---|---|---|
| Apple HIG, Spatial layout | "In general, avoid adding depth to text. Text that appears to hover above its background is difficult to read." | No glass, blur or elevation behind any table cell, label or number. |
| Apple HIG, Spatial layout | Depth "is great for visually separating large, important elements… but it may not work as well on small objects." | Depth applies to the shell and the call bar. Never to chips, buttons or icons. |
| Apple HIG, Materials | "Don't use Liquid Glass in the content layer… can result in unnecessary complexity and a confusing visual hierarchy." | Glass reserved for the floating functional layer only. |
| Apple HIG, Spatial layout | "People need to refocus their eyes to perceive each difference in depth, and doing so too often or quickly can be tiring." | Maximum four elevation planes, ever. |
| Apple HIG, Materials | "Thicker materials, which are more opaque, can provide better contrast for text… Thinner materials… help people retain their context." | The call bar carries text, so it takes the thick variant. |
| Material 3, Elevation | "When it comes to applying shadows, less is more." | Same conclusion, reached independently. |
| Material 3, Elevation tokens | "Surface tint color is deprecated. Use elevation level tokens (0 to 5) instead." Elevation "has no shadow or value of its own by default." | Separation comes from tonal step first, shadow second, never both on the same element. |
| WCAG 2.2, SC 2.3.3 | Motion animation is "the addition of steps between conditions to create the illusion of movement." Explicitly excluded: "changes in color, blurring, or opacity that don't alter perceived size, shape, or position." | Opacity and colour transitions are the safe way to animate the Instrument. |

### The one place they cross

**The connect moment.** When a human picks up, the Stage collapses into the Instrument in a single 240ms transition: ambient fades to zero, the call bar rises into place, the briefing expands to full working width. That is the cinematic beat worth spending. Everything after it stays silent until the call ends.

---

## 6. Colour

Structure borrows the discipline of Radix's twelve-step scales (every step has exactly one job) and Geist's role-named steps. Values are set for this product: a dark-first console read at arm's length for long shifts.

Every value below was contrast-checked against every surface it can legally sit on. Ratios are WCAG 2.x relative luminance, computed, not estimated.

### 6.1 Surface

Four planes, no more. Plane depth is carried by tone. Shadow is added only when an element floats above the document flow, and never in addition to a tonal step on the same element.

| Token | Dark | Light | The one job it has |
|---|---|---|---|
| `--surface-void` | `#0A0B0D` | `#F6F7F9` | App ground. Behind everything. Never holds content directly. |
| `--surface-1` | `#101215` | `#FFFFFF` | Cards, panels, table body. The default content plane. |
| `--surface-2` | `#171A1E` | `#F0F2F5` | Table header, toolbar, inset wells, row hover. |
| `--surface-3` | `#1E2227` | `#E7EAEE` | Row selected, control resting state, popover ground. |
| `--surface-4` | `#262B31` | `#DDE1E6` | Control hover, keycap, active toggle. Never carries text at rest. |

### 6.2 Line

| Token | Dark | Light | Job | Min ratio on surface-1/2 |
|---|---|---|---|---|
| `--line` | `#24292F` | `#DFE3E8` | Hairline separators inside a plane. Decorative, exempt from 1.4.11. | n/a |
| `--line-strong` | `#63676E` | `#878A90` | Control borders, input outlines, chip borders. | **3.07 / 3.09** ✓ |
| `--line-active` | `#767A81` | `#74777D` | Hovered control border, focus ring track. | **4.05 / 4.00** ✓ |

> The current build's control borders measure 1.39:1 against their surfaces. SC 1.4.11 requires 3:1 for anything conveying a component boundary or state. The values above are the minimum that clears it.

### 6.3 Ink

| Token | Dark | Light | Use | Worst ratio |
|---|---|---|---|---|
| `--ink` | `#E9ECEF` | `#14171B` | Primary text, all numbers, all names. | 14.9 / 16.1 |
| `--ink-2` | `#A2A9B2` | `#4F565E` | Secondary text and metadata. | **6.74 / 6.16** ✓ |
| `--ink-3` | `#848B94` | `#626971` | Labels, axis ticks, placeholders. | **4.65 / 4.61** ✓ |

> **Hard rule.** No opacity modifier is ever applied to an ink token. `text-muted-foreground/60` is banned and every existing instance is removed. If text needs to be quieter it takes the next token down, which has a measured ratio. Stacking alpha on a muted token is exactly how the current build produced 10px labels below threshold.

### 6.4 Accent and signal

One accent, used only for the primary action and the current selection. Signal colours are functional and never decorative: they carry call and record state and nothing else on the screen may use them.

| Token | Dark | Light | Meaning | Where it may appear | Worst ratio |
|---|---|---|---|---|---|
| `--accent` | `#4C8DFF` | `#1B60DC` | Primary action, selection | One primary button per view. Active nav item. Focus ring. Nothing else. | 5.00 / 4.64 ✓ |
| `--signal-live` | `#34C77B` | `#12734A` | Connected, on a call | Live call state, connected line, rep on a call. | 7.31 / 4.86 ✓ |
| `--signal-ring` | `#E8A33D` | `#8A5A0B` | Ringing, pending, due | Dialing, callback due, awaiting disposition. | 7.41 / 4.90 ✓ |
| `--signal-stop` | `#F0555C` | `#BE2830` | Recording, DNC, destructive | Recording indicator, do not call, delete, overdue. | 4.69 / 4.92 ✓ |

Each signal ships a `-bg` and `-line` companion so chips never rely on colour alone:

| Token | Dark bg | Dark line | Light bg | Light line |
|---|---|---|---|---|
| `--accent-*` | `#152540` | `#2B4A80` | `#E5EDFD` | `#B4CDF8` |
| `--signal-live-*` | `#0E2A1D` | `#1B5B3C` | `#E1F5EB` | `#A8DCC3` |
| `--signal-ring-*` | `#2C2010` | `#5E4519` | `#FBF0DC` | `#E7CD97` |
| `--signal-stop-*` | `#2E1215` | `#6B2429` | `#FCE9EA` | `#F2BFC2` |

**Shape carries state alongside colour**, so the system survives monochrome and satisfies SC 1.4.1:

| State | Colour | Shape |
|---|---|---|
| Live / connected | `--signal-live` | Filled dot ● |
| Ringing / pending | `--signal-ring` | Hollow ring ○ |
| Stopped / blocked / DNC | `--signal-stop` | Filled square ■ |
| Recording | `--signal-stop` | Filled dot with a 2px ring, animated by opacity only |

### 6.5 Chart palette

Categorical series, in assignment order. Anchored so no two adjacent hues are confusable under the common forms of colour vision deficiency, and each holds 3:1 against `--surface-1` for SC 1.4.11 graphical objects.

| Slot | Dark | Light | Typical series |
|---|---|---|---|
| 1 | `#4C8DFF` | `#1B60DC` | Dials |
| 2 | `#34C77B` | `#12734A` | Connects |
| 3 | `#E8A33D` | `#8A5A0B` | Appointments |
| 4 | `#B98BF5` | `#6B3FBF` | Callbacks |
| 5 | `#48C8D8` | `#0E6C79` | Voicemail |
| 6 | `#8A9099` | `#5A6169` | Other / no answer |

Note that "no answer" is 89% of dispositions **[M]** and belongs in neutral grey, not a saturated hue. A donut where the dominant slice is the loudest colour teaches the reader nothing.

### 6.6 Migration map

| Current | Replace with |
|---|---|
| `--primary` (red, dark) | `--accent` |
| `--accent` (pink, dark) | delete; nothing needs a second accent |
| `--danger` | `--signal-stop` |
| `--success` | `--signal-live` |
| `--warning` | `--signal-ring` |
| `--glow` | delete |
| `linear-gradient(135deg,#3D50F5,#298DFF 52%,#24D6F9)` | `--accent` flat |
| `bg-aurora` | delete from Instrument surfaces; keep only behind `--surface-void` on Stage routes |
| `--chart-1` … `--chart-5` | `--chart-1` … `--chart-6` above |

---

## 7. Typography

The current build runs 10, 11, 12, 14, 16, 28 and 36px with nothing between 16 and 28 **[M]**. This replaces it with the Geist principle that **size and line height are separate decisions**: Label for single lines beside icons, Copy for anything that wraps. Same pixel size, different leading, chosen by role.

### 7.1 Scale

| Token | Size | Line | Tracking | Weight | Use |
|---|---|---|---|---|---|
| `display-32` | 32px | 36px | -0.028em | 700 | Page title. One per screen. |
| `display-24` | 24px | 30px | -0.022em | 700 | Section heading, modal title. |
| `heading-18` | 18px | 24px | -0.014em | 600 | Panel and card title. |
| `heading-15` | 15px | 20px | -0.008em | 600 | Sub-panel, table group header. |
| `label-14` | 14px | 18px | 0 | 500 | Table cells, buttons, single-line UI. The workhorse. |
| `copy-14` | 14px | 22px | 0 | 400 | Notes, briefings, anything that wraps. |
| `label-13` | 13px | 17px | 0 | 500 | Dense table mode, secondary metadata. |
| `label-12` | 12px | 16px | 0.01em | 500 | Chips, badges, timestamps. Floor for value text. |
| `caps-11` | 11px | 14px | 0.12em | 500 | Column headers, section labels. Uppercase. **Absolute floor for all text.** |
| `mono-13` | 13px | 18px | 0 | 500 | Phone numbers, durations, counters, IDs. Tabular figures. |
| `metric-40` | 40px | 40px | -0.03em | 700 | KPI value. Tabular figures. Max one row of five. |

### 7.2 Rules

- **10px disappears entirely.** Section508.gov is direct: for the web, "use a typical font size of 11 or 12pt, or 15 to 16px," and the 3/16-inch minimum applies only to displays users cannot zoom. Carbon (`body-compact-01` at 14/18, `label-01` at 12/16), Material (14px key base) and Geist (`text-label-14` as "most common text style of all") all converge on 14px dense base with 12px labels. This scale sits there.
- **Every column of digits takes `font-variant-numeric: tabular-nums`.** Durations, counters, phone numbers, currency, percentages. Proportional figures make counters jitter as they tick, which the current build does everywhere there is a timer.
- **Heading levels are semantic and sequential.** The current document has H1 then H3 with no H2 **[M]**, which breaks the screen-reader outline on every page. `display-32` maps to H1, `display-24` to H2, `heading-18` to H3.
- **Line length caps at 66 characters** for `copy-14`. The AI briefing and the notes field are the two places this matters; both currently run edge to edge in a narrow rail, which is the worst of both.

### 7.3 Families

| Role | Family | Why |
|---|---|---|
| UI | Inter (retained) | Already in place, and correct for dense UI. Enable `cv05`, `ss01` and `tnum` where digits align. |
| Numeric / mono | JetBrains Mono or IBM Plex Mono | Phone numbers, durations, IDs, join codes. Needs a slashed or dotted zero, which the current monospace fallback does not guarantee. |

No display face. A dialer does not need one, and adding one is how the Leaderboard ended up looking like a different product.

---

## 8. Space, radius, elevation

### 8.1 Space

A 4px base, Carbon's scale. Only these values exist.

| Token | px | Typical use |
|---|---|---|
| `space-1` | 2 | Icon-to-label nudge |
| `space-2` | 4 | Chip internal |
| `space-3` | 8 | Control internal, tight stack |
| `space-4` | 12 | Field internal |
| `space-5` | 16 | **Cell padding, card padding, default gap** |
| `space-6` | 24 | Section gap inside a panel |
| `space-7` | 32 | Panel gap |
| `space-8` | 40 | Page section gap |
| `space-9` | 48 | Major section gap |
| `space-10` | 64 | Page top padding |

Cell horizontal padding is 16px at every density, exactly as Carbon specifies. **Density changes row height and vertical padding, never font size, never horizontal padding.**

### 8.2 Radius

Four values plus a pill. No calc, no derived fractions, no 33-million-pixel radii.

| Token | px | Applies to |
|---|---|---|
| `radius-sm` | 4 | Chips, badges, inputs, checkboxes |
| `radius-md` | 6 | Buttons, selects, small controls |
| `radius-lg` | 10 | Cards, panels, table container |
| `radius-xl` | 14 | Modals, drawers, the call bar |
| `radius-full` | 999 | Avatars, status dots |

### 8.3 Elevation

Four planes. Tonal step first; shadow only when the element genuinely floats.

| Level | Shadow (dark) | Shadow (light) | Used by |
|---|---|---|---|
| 0 | none, tonal step only | none, tonal step only | Table rows, inline panels, toolbar |
| 1 | `0 1px 2px rgba(0,0,0,.5)` | `0 1px 2px rgba(16,24,40,.06)` | Cards |
| 2 | `0 4px 12px -2px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.4)` | `0 4px 12px -2px rgba(16,24,40,.10), 0 1px 3px rgba(16,24,40,.06)` | Popovers, dropdowns, tooltips |
| 3 | `0 18px 48px -12px rgba(0,0,0,.7), 0 2px 8px rgba(0,0,0,.5)` | `0 18px 48px -12px rgba(16,24,40,.16), 0 2px 8px rgba(16,24,40,.08)` | Modals, drawers, call bar |

The current build ships eight distinct shadow values **[M]**. Cutting to four is what makes the remaining ones mean something.

### 8.4 Density

Three modes, stored per user, applied globally. Carbon's model: density changes row height and padding, never font size.

| Mode | Row height | Type token | Rows per 900px viewport | For |
|---|---|---|---|---|
| Compact | 32px | `label-13` | ~24 | Managers scanning hundreds of rows |
| Default | 40px | `label-14` | ~19 | Everyone else. Matches Carbon medium, near AG Grid's 42px. |
| Comfortable | 48px | `label-14` | ~16 | Touch, and anyone who wants room |

Row height is set with `min-height`, never `height`. Fixed row heights are the classic SC 1.4.12 Text Spacing failure: a user who raises line height to 1.5 loses content inside the row. The current build's rows already vary 40 to 90px because addresses wrap **[M]**, so this also fixes the vertical rhythm.

---

## 9. Motion and the cinematic layer

Four techniques for the Stage. Each has a defined budget, a defined surface, and a reduced-motion path.

### 9.1 The curve set

```
enter    180ms  cubic-bezier(.16, 1, .3, 1)     entry, expansion, reveal
exit     120ms  cubic-bezier(.4, 0, 1, 1)       dismissal, collapse
state     90ms  linear                          colour and opacity only
connect  240ms  cubic-bezier(.16, 1, .3, 1)     the one cinematic beat
```

Instrument surfaces use only the 90ms state curve, and only on colour and opacity, which WCAG 2.3.3 explicitly excludes from its definition of motion animation.

### 9.2 Ambient field

A slow canvas or WebGL field behind the shell ground: three or four soft luminous planes at different Z depths, drifting at roughly 0.02px per frame, with 3 to 4 percent film grain over the top.

- Renders **only** behind `--surface-void`. Never behind a card, never behind text.
- Caps at 30fps. Pauses on `document.hidden` and whenever a call is live.
- Under `prefers-reduced-motion: reduce`, renders one static frame and stops.
- Budget 10ms per frame, per RAIL: the animation budget is 10ms because browsers need about 6ms of the 16ms frame to render.
- Present on: sign-in, `/hub`, dialer idle state, empty states. Absent everywhere else.

### 9.3 Glass, on exactly three surfaces

Real `backdrop-filter: blur(24px) saturate(140%)` over an opaque tonal base. Not the current `rgba(13,19,31,.55)` with no filter at all.

1. The command palette scrim
2. The modal backdrop, at 32% opacity, matching Material's scrim spec
3. The live call bar, and only while a call is active

Nowhere else. Apple's thickness guidance decides the variant: the call bar carries text, so it takes the thick, more opaque treatment.

### 9.4 Orchestrated entry

One sequence per route change, 320ms total, staggered 30ms per element in reading order. Not fourteen independent hover animations.

### 9.5 The connect beat

The single most important 240ms in the product. On bridge completion with a human on the line:

1. Ambient field fades to zero opacity
2. Call bar rises 12px into place, live signal ring lights
3. Briefing panel expands to full working width
4. One 40ms audio tick, defaulting on, muteable

**Target: 100ms from bridge event to first painted frame**, per the RAIL response budget. That is the perceived connect moment and it is the number to instrument. Note the FCC's 2-second connect deadline is 20 times the RAIL "instantaneous" budget, so the regulatory limit is no guide to what feels right.

### 9.6 What goes

| Currently | Why it goes |
|---|---|
| Radial `bg-aurora` glows behind cards and tables | Depth behind content-layer text. Apple's explicit "avoid." |
| Blue-cyan gradient under button labels | Depth behind text on a small object. Both prohibitions at once. |
| Leaderboard 3D podium with crown | Depth under a name, and a second visual system. |
| Eight shadow values | Reduced to four. |

---
---

# PART III · ARCHITECTURE

## 10. The shell

Full rebuild, which is the right call: the navigation, header and layout primitives are where the incoherence is generated and every screen inherits it.

### 10.1 Regions

```
┌──────────────────────────────────────────────────────────────┐
│  TopBar            52px, opaque, sticky, z-40                │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  Sidebar   │  Route outlet                                   │
│  268px     │  min-width 0, own scroll container              │
│  or 56px   │                                                 │
│  collapsed │                                                 │
│  z-30      │                                                 │
│            │                                                 │
├────────────┴─────────────────────────────────────────────────┤
│  CallBar           64px, elevation 3, z-50, conditional      │
└──────────────────────────────────────────────────────────────┘
   Overlays: z-100 scrim, z-110 panel
   Toasts:   z-140
```

### 10.2 The persistence contract

This is the fix for defect 4, and it is a contract rather than a bug fix because the current failure mode will come back otherwise.

- **The Sidebar, TopBar and CallBar mount once, at the application root, and never unmount on navigation.** They sit outside the route outlet in the component tree. Route transitions replace only the outlet's contents.
- No suspense boundary may wrap the shell. Boundaries go inside the outlet.
- Navigation state (active item, collapsed, expanded groups) lives above the router, not in a route-level component.
- **Acceptance:** record a 60fps screen capture of ten consecutive route changes. No frame may show fewer nav items than the previous frame.

### 10.3 TopBar

52px, **opaque** `--surface-1`, 1px `--line` bottom border, sticky.

| Zone | Holds | Rules |
|---|---|---|
| Left | Breadcrumb or page title, org switcher | The page title lives here, not in a separate 120px block below. That block is what pushes real content off the first screen on every route today. |
| Centre | Command input | Present at every breakpoint. On mobile it collapses to an icon opening the same palette, rather than disappearing. |
| Right | Line status, notifications, avatar | Line status is a system indicator, not a button. **The header carries no primary action**; the page owns its own. |

Glass is not appropriate here. It sits above dense text and Apple's own rule is that thicker materials give better contrast for fine features. If a translucent header is wanted later it needs a real `backdrop-filter` and a solid tonal base, not 0.55 alpha over nothing.

### 10.4 CallBar

The highest-leverage addition in the plan. Docked at the bottom, 64px, present on **every route** whenever a call is live or awaiting disposition.

| Region | Contents |
|---|---|
| Identity | Lead name, number in `mono-13`, called-party local time, elapsed timer in tabular figures |
| Controls | Mute, hold, record state, transfer, hang up. Every icon labelled. None below 24×24 CSS px. Hang up is separated from every other control by at least `space-6`. |
| Outcome | Disposition entry point, opening straight into the wrap flow |
| Status | Recording indicator meeting 3:1 non-text contrast, since SC 1.4.11 treats state as required visual information |

**Accessibility constraint designed against from day one.** A sticky header plus a docked bottom bar is exactly the pattern SC 2.4.11 Focus Not Obscured exists to catch. Requirements:

- `scroll-padding-block: 52px 64px` on the scroll container, so anchoring never lands a focused element under either bar.
- The CallBar sits after the outlet in DOM order, so tab order reaches it last rather than trapping focus mid-page.
- On viewports under 640px the CallBar collapses to 44px with identity plus hang up plus an expand affordance.

### 10.5 Layout primitives

| Primitive | Contract |
|---|---|
| `AppShell` | Owns the four regions and the z-index scale. Nothing else may set a z-index above 20. |
| `Page` | Title, description, actions, content. One primary action, optional. |
| `Panel` | Titled region, elevation 1, `radius-lg`. Collapses to a single line when empty. |
| `Toolbar` | The only place filter and view controls may live. One per page. |
| `SplitView` | Fixed / fluid / fixed three-column with `min-width: 0` on every track. |

`min-width: 0` on grid and flex tracks is not optional. It is why the dialer's left column truncates "UNIVERSITY PARK" to "UNIVE…" and the phone number to "(925) 68…" **[M]**: the track cannot shrink its content, so the content clips instead of the layout adapting.

---

## 11. Navigation and information architecture

### 11.1 The problem, measured

**[M]** Nav content is 741px tall inside a 451px scroll area at a 900px viewport. 290px, 39% of the primary navigation, is hidden with no scroll affordance. Below the cut: Leaderboard, Campaigns, Recordings, Reports, AI Agent, Admin, and an entire SYSTEM group. Because Control Center and the user card are pinned below the scroll area, the list reads as though it ends at Team Status.

### 11.2 Three tiers, grouped by activity

| Tier | Contains | Treatment |
|---|---|---|
| **Work** | Dial · Queue · Callbacks · Appointments | Always visible, never collapses, always in the same place. Each carries a live count badge when it has work waiting. |
| **Know** | Leads · Recordings · Reports · Leaderboard | Collapsible. State remembered per user. |
| **Run** | Live Floor · Assignments · Campaigns · Admin · Settings | Collapsible. **Hidden entirely for the Rep role**, which removes five items for the people who use the product most. |
| **Console** | Superadmin | Leaves the sidebar completely. A different application, entered and exited deliberately. |

### 11.3 Role matrix

| Destination | Rep | Manager | Admin | Owner |
|---|---|---|---|---|
| Dial | ✓ | ✓ | ✓ | ✓ |
| Queue | ✓ | ✓ | ✓ | ✓ |
| Callbacks | own | team | team | team |
| Appointments | own | team | team | team |
| Leads | own | team | team | team |
| Recordings | own | team | team | team |
| Reports | own | ✓ | ✓ | ✓ |
| Leaderboard | ✓ | ✓ | ✓ | ✓ |
| Live Floor | – | ✓ | ✓ | ✓ |
| Assignments | – | ✓ | ✓ | ✓ |
| Campaigns | – | ✓ | ✓ | ✓ |
| Admin | – | – | ✓ | ✓ |
| Settings | ✓ | ✓ | ✓ | ✓ |
| Console | – | – | – | platform only |

A Rep sees eight items. That fits without a scroll at any supported viewport.

### 11.4 Rules

- **Active state matches exactly, not by prefix.** The current bug where `/monitor` and `/monitor/team` both light up is a one-line fix and it is the kind of thing that makes a product feel unfinished.
- **Nav label equals page title, always.** "Live Monitor" and "Live Floor" pick one name. Recommended: **Live Floor** everywhere, since it is the better name.
- **Collapsed rail at 56px** with icon plus tooltip, remembered per user, and automatic on the dialer route.
- **Mobile gets a bottom tab bar** carrying the four Work items, not a hamburger. A rep on the floor should not open a drawer to reach the dialer.

### 11.5 Naming corrections

| Current | Problem | Use |
|---|---|---|
| Power Dialer | Fine | **Dial** |
| Leads | Overloaded with the queue concept | **Leads** (the database) and **Queue** (today's working set) as distinct destinations |
| No need right now (`/bills-fine`) | Label, route and purpose all differ | **Nurture**, route `/nurture` |
| Live Monitor / Live Floor | Two names for one thing | **Live Floor** |
| Control Center | Ambiguous versus Superadmin Console | **Platform Console** |
| Assignments | Fine | Assignments |

---

## 12. The overlay system

**This section exists because of defects 1, 2 and 3.** Three of three overlays tested render with no surface and no scrim. One primitive fixes all of them and prevents the class from recurring.

### 12.1 The primitive

Every overlay in the product renders through one `<Overlay>` component. There is no second path.

```
<Overlay
  variant="modal" | "palette" | "drawer" | "popover" | "sheet"
  size="sm" | "md" | "lg" | "full"
  labelledBy={id}          // required
  onDismiss={fn}           // required
/>
```

### 12.2 Non-negotiable contract

| Requirement | Value | Why |
|---|---|---|
| Panel background | **Opaque** `--surface-1` (popover: `--surface-3`) | The defect. A panel must never be transparent. |
| Scrim | Separate element, `--surface-void` at 32% + `backdrop-filter: blur(24px)` | Material's scrim spec. Also gives the Stage its one legitimate glass moment. |
| Elevation | Level 3 for modal / drawer / palette, level 2 for popover | |
| Z-index | Scrim 100, panel 110. Nothing else in the app may exceed 20. | |
| Portal | Rendered to `document.body`, outside every stacking context | Prevents a parent `transform` or `filter` from trapping it. |
| Focus trap | Focus moves to the panel on open, cycles inside, returns to the trigger on close | WCAG 2.4.3 |
| Dismiss | `Esc`, scrim click, and an explicit close control. All three, always. | |
| Scroll lock | Body scroll locked while open, with scrollbar-width compensation so the page does not shift | Prevents a CLS spike on every open |
| Reduced motion | Enter and exit become opacity-only | SC 2.3.3 |
| `aria-labelledby` | Required prop, not optional | An unlabelled dialog is unusable with a screen reader |

### 12.3 Variant specs

| Variant | Width | Position | Used by |
|---|---|---|---|
| `modal` | 480 / 640 / 880px | Centred, max-height 85vh, internal scroll | New appointment, Load leads, confirmations |
| `palette` | 640px | Top-anchored 15vh | Command palette |
| `drawer` | 480px | Right edge, full height | Lead record, call detail, filter builder |
| `popover` | Content-sized, max 360px | Anchored to trigger, flips on collision | Menus, date pickers, quick actions |
| `sheet` | Full width | Bottom, under 640px viewport | Every variant above, on mobile |

### 12.4 Non-modal exception

NN/g lists overuse of modals as a top-ten application design mistake, specifically because modals "obscure surrounding context, preventing users from referencing existing data while performing edits."

**Disposition is never a modal.** It is inline in the wrap state, with the lead record still visible. Same for note-taking, callback scheduling and appointment booking from a live call. A rep must be able to read the lead while typing about them.

### 12.5 Acceptance

- [ ] Open every overlay in the product and screenshot it. No page content is visible through any panel.
- [ ] Automated: for each overlay, assert computed `background-color` alpha is 1 and a scrim element exists in the DOM.
- [ ] Keyboard: `Tab` from the trigger enters the panel; `Shift+Tab` at the first element wraps to the last; `Esc` closes and returns focus to the trigger.
- [ ] Opening an overlay produces a CLS delta of 0.

---

## 13. Loading, empty and error states

**This section exists because of defects 5 and 6.** Loading currently renders as data, which is the mechanism behind a large share of the trust problems.

### 13.1 The four states, and their rules

| State | Renders | Never renders |
|---|---|---|
| **Loading** | A skeleton matching the final layout's exact dimensions | A zero. A dash. An empty string. Any value a user could mistake for data. |
| **Empty** | A short statement of what would be here, plus the action that creates it | A full-viewport void around one centred sentence |
| **Error** | What failed, in the user's words, plus a retry | A stack trace, an env var name, or "Something went wrong" |
| **Populated** | The data | |

### 13.2 The zero rule

> **A numeric slot may only render `0` when the value is known to be zero.**

Implementation: value components take a discriminated union, not a nullable number.

```
type Metric =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'unavailable'; why: string }   // no valid denominator
  | { status: 'ok'; value: number }
```

`unavailable` is what SHOW RATE needs. **[M]** It currently renders `0%` with zero completed appointments, which is not a show rate of zero, it is a show rate that cannot be computed. It must read "not enough data" with the reason available on hover.

### 13.3 Skeleton rules

- Skeletons match the final element's box exactly, so resolution produces zero layout shift.
- Skeleton shimmer is opacity-only, so it needs no reduced-motion variant.
- A panel whose data resolves empty **collapses to a single line**. It does not reserve its populated height. The current "Live now" card reserves 340px to say "No live calls right now." **[M]**

### 13.4 Empty state catalogue

| Surface | Current | Replace with |
|---|---|---|
| Live now | 340px box, one centred sentence | One line: "No live calls. 3,687 leads ready." plus Start session |
| Team Status | Full viewport void | Merge into Live Floor; the state disappears |
| Live Floor, nobody online | 12 identical offline cards **[M]** | One line: "9 reps offline" with an expand affordance |
| Campaigns | Centred icon and sentence | Same, but reconciled with the Leads campaign field first |
| Booked tab, 0 | Blank | "No appointments booked this session." |
| Notifications | "You're all caught up." on a transparent panel | Same copy, on an opaque panel |

### 13.5 Error copy

Errors say what happened and what to do. They never expose deployment internals.

| Current **[M]** | Replace with |
|---|---|
| "Nobody is being notified. Add an address, or set `APPOINTMENT_NOTIFY_EMAILS` as a deployment-wide default." | "No one is being notified yet. Add an email address below." |
| "The address itself comes from `RESEND_FROM` and must be on a verified domain." | "Emails send from your verified domain. Contact support to change it." |

---

## 14. The metric definition layer

**This section exists because of cause 6.** The three-way connect rate disagreement does not get fixed by patching three screens. It gets fixed by writing the definitions down once and making every screen read them.

### 14.1 The registry

Every metric in the product is declared once:

```
{
  id:          'connect_rate',
  label:       'Connect rate',
  definition:  'Live conversations divided by dials placed.',
  numerator:   'calls where outcome ∈ {connected}',
  denominator: 'calls where direction = outbound',
  window:      Window,            // required, never implicit
  scope:       'org' | 'team' | 'self',
  format:      'percent',
  precision:   1,
  minDenominator: 20              // below this → status 'unavailable'
}
```

### 14.2 Rules

1. **No metric renders without a visible window.** "Connect rate 6.0%" is not a fact. "Connect rate 6.0% · last 30 days · org" is.
2. **No metric renders without a visible scope.** Team-wide and self are different numbers and the current build shows both without saying which.
3. **`minDenominator` gates every ratio.** Below it the metric returns `unavailable`, not a misleading percentage. This is what kills "SHOW RATE 0%".
4. **Every KPI tile links to its definition.** A hover or click reveals the numerator, denominator, window and source table.
5. **Chart encodings must match label arithmetic.** The Reports funnel currently labels appointments "4.6% of connects" while drawing the bar against dials **[M]**. Either both stage-to-stage or both against top-of-funnel, and the chart says which.

### 14.3 Reconciliation backlog

Each of these is a data question, not a UI question, and each must be answered before Phase 5 ships.

| Question | Observed |
|---|---|
| What is the canonical lead count? | 12,419 / 12,248 / 12,530 / 12,358 |
| Why does DNC read 110 on Leads and 157 on Admin? | Different filters, or two lists |
| What window does the Dashboard's "57 appointments" use? | Labelled 90d there, "all time" on Reports |
| Why did Booked move 20 → 0 with no dialing? | Session-scoped versus org-scoped, probably |
| Does "campaign" mean campaign, or is it a source tag? | Every lead says "California"; Campaigns page says none exist |
| Are "active reps", "on the floor" and the Live Floor card count the same population? | 9 / 15 / 12 |
| Is "calls today" org-wide or per-rep? | 1 on Dashboard, 15 on Live Floor, same session |

---
---

# PART IV · SCREENS

Each screen: what was measured, what replaces it, and criteria that can be answered yes or no against a build.

## 15. Power Dialer

`/dialer` · **P0** · The screen a rep lives in. Build it first after the shell.

### 15.1 Measured

**Layout**
- Document height 1742px against a 757px viewport. **2.3 screens.** Nothing that matters is co-visible.
- Three independent scroll regions, so the scrollbar means something different depending on cursor position.
- Notes sit at the bottom of the right rail. Taking a note during a call means scrolling away from the call.
- Number pad expanded by default, occupying the centre column, in a workflow defined by not dialing by hand.
- Left column too narrow for its content: "UNIVERSITY PARK" → "UNIVE…", "(925) 683-5692" → "(925) 68…", "America/Los_Angeles" → "America/Los_A", "Full record" wraps to two lines. **The phone number is clipped in a dialer.**

**Signal buried under chrome**
- Eleven caller-ID numbers as raw chips, taking the top third of the session panel to communicate "rotation is on".
- Ten-chip status strip mixing mode toggles (Manual / Parallel / AI), session counters (1 of 3687, 0 dials, 0 connects, 4 today) and system state (Line ready, 11/11 caller IDs, Audio, Recording on, LIVE) with no hierarchy.
- Two blue-gradient primary buttons: "Start Dialing" in the header, "Start session" in the centre.
- Manual dial button is green, which the token system reserves for success.
- AI briefing (Priority 53, Appt prob 37%, Opportunity $1,900, Contact probability 66%, Qualification probability 59%, opening line, strategy, likely objections, best callback window, suggested close) is confined to a narrow right rail below the fold.

**Queue arithmetic**
Five numbers on one screen: `12069 in queue`, `1 of 3687`, `3687 org leads ready to dial`, `Loaded 3687 of 12358 leads, 8671 skipped`, `My leads only 384`.

### 15.2 Target layout

Fills the viewport exactly. `height: 100dvh`, no page scroll. Panels scroll internally only where content genuinely exceeds the panel.

Column widths at 1440px:

| Column | Width | Owns | Behaviour |
|---|---|---|---|
| Left | **320px fixed** | Queue and context | Up-next list, virtualised. Current lead pinned at top. Call history collapsed to a summary line that expands. `min-width: 0` on the track. |
| Centre | **fluid, min 520px** | The call | Lead identity, briefing or live transcript, disposition. The only column that changes between states. |
| Right | **400px fixed** | Qualify and capture | Script, objections, then the qualification form and notes. **Notes always visible without scrolling.** |

Below 1280px the right column becomes a slide-over. Below 900px the layout becomes single-column with the CallBar carrying controls.

### 15.3 The four states

The current screen has one state trying to serve four. Splitting them is what removes the scroll.

| State | Centre column | The one thing it must get right |
|---|---|---|
| **Idle** | Session setup: line count, pacing, caller-ID strategy in one line, one Start button | This is Stage. Ambient runs here, and only here on this screen. |
| **Dialing** **[U]** | Per-line status rows: number, ring elapsed, result as it lands | Ringing versus abandoned must be distinguishable at a glance without reading text. |
| **Connected** **[U]** | Lead identity large, opening line at reading size, live timer, objections one keystroke away | Ambient to zero. Everything flat. Pure Instrument. |
| **Wrap** **[U]** | Disposition grid, notes with focus already in the field, next-lead preview | Under three seconds with the keyboard alone. This is the whole game for dials per hour. |

States marked **[U]** were not observed; reaching them requires placing real calls. Validate against staging before building.

### 15.4 Specific replacements

**Caller ID: eleven chips become one line**

```
Local presence · 11 numbers · rotating every call        [Details]
```

The pool belongs in Admin. Then add what no competitor surfaces: per-number **reputation**, **attestation level** and **calls placed today**. See [section 28](#28-compliance-surface).

**Status strip: ten chips become three groups**

| Group | Contents | Placement |
|---|---|---|
| Mode | Manual / Parallel / AI, line count | Session controls, left of Start |
| Counters | dials, connects, today | Compact right-aligned readout, `mono-13`, tabular |
| System | line ready, audio, recording, live | One health indicator, expands on click, **coloured only when something is wrong** |

**One primary action, ever.** The header carries none. The dialer's primary is contextual: `Start session` when idle, `Hang up` when connected (in `--signal-stop`, not accent), `Save and next` when wrapping. Manual dial becomes secondary and stops being green.

**Briefing gets the room it deserves.** Priority, appointment probability and opportunity value move to the top of the centre column at `metric-40`. The opening line renders at `copy-14` at a 66-character measure, because a rep reads it aloud. Objections become keyboard-reachable cards.

**Number pad collapses by default.** It expands on `#` or from an overflow menu.

### 15.5 Acceptance

- [ ] At 1280×720 the Connected state fits with zero page scroll: lead identity, opening line, timer, disposition and notes all visible simultaneously.
- [ ] No lead name, phone number or timezone truncates at any supported viewport.
- [ ] Wrap completes with the keyboard alone in under three seconds, hang up to next dial.
- [ ] Every queue number derives from one source and is labelled with its scope. No two numbers on screen can disagree.
- [ ] Caller ID occupies one line at rest.
- [ ] Exactly one element uses `--accent` as a filled background at any moment.
- [ ] Ambient renders in Idle only and stops on connect.
- [ ] Perceived connect, bridge event to painted state change, is under 100ms at p75.

---

## 16. Dashboard

`/dashboard` · **P1**

### 16.1 Measured
- Four KPI tiles, then six panels of unequal height. "Live now" is a 340px box holding one sentence.
- Donut legend carries nine categories at 11px in two columns; six read 0 to 3%. "No answer 89%" is the only meaningful slice and it is not called out.
- Hourly productivity chart renders axes with no data.
- Lead insights shows EV 0%, Pool 0%, Other 0%.
- Two "Start dialing" buttons, differently capitalised, 100px apart.
- "Calls today 1" against Live Floor's "15 calls today" in the same session.

### 16.2 Replace with
A shift-oriented answer to one question: **what should I do in the next hour.**

- Top strip becomes three actionable counts, each a link into a working queue: callbacks due, appointments needing confirmation, leads left in today's assignment.
- KPI tiles drop to three, each with a sparkline and an explicit comparison window. A KPI without a comparison is decoration.
- Outcome mix collapses to the top four dispositions plus "other", remainder on demand. Nine categories at 11px is a legend nobody reads. "No answer" renders in neutral grey, not a saturated hue.
- Empty panels do not render. A panel with no data collapses to one line.
- One primary action on the page.

### 16.3 Acceptance
- [ ] No panel renders taller than its content.
- [ ] Every number carries a visible scope and window label.
- [ ] Exactly one primary action.
- [ ] "Calls today" matches Live Floor's count for the same scope, or is visibly scoped differently.

---

## 17. Leads

`/leads` · **P0**

### 17.1 Measured
See [cause 5](#cause-5--the-data-model-renders-directly-to-screen) for the column analysis. Additionally:
- Eight stat tiles in a clipped horizontal strip with truncated labels.
- Two promotional banners consuming ~180px above the data on every visit.
- Five filtering idioms in one bar; the Filters button's accessible name is its tooltip.
- No sticky header; row heights vary 40 to 90px.
- KPI values drifted between two loads in the same session: ALL ACTIVE 12,419 → 12,248, ASSIGNED 562 → 395, PREVIOUSLY ATTEMPTED 2,499 → 2,351.

### 17.2 Replace with

**Column sets, not a schema dump.** Three presets plus a user-managed custom set:

| Preset | Columns |
|---|---|
| Dialing | Lead · Phone · Local time · Status · Last touch · Owner |
| Qualification | Lead · Monthly bill · Home profile · Priority · Appt probability · Owner |
| Data quality | Lead · Phone valid · Address complete · Duplicate of · Source · Imported |

- **Never render a column that is empty for every row in the current result set.**
- Column manager operable without drag and drop. NN/g is explicit that hiding and reordering must be accessible to people who do not use drag interactions.
- Sticky header and a pinned first column. NN/g: "Freeze header rows and header columns if the table is larger than the screen."
- Virtualise above ~80 rows. **[D]** Lighthouse warns at roughly 800 body nodes and errors at ~1,400; at 8 to 12 nodes per row that budget is spent between 70 and 100 rows. This arithmetic is derived from two published numbers, not a published threshold. Measure before committing.
- One filter bar: search field, one Filters control opening a panel, saved views. The four native selects become filter chips inside that panel.
- Stat tiles become one summary line with the counts that actually differ.
- Banners move behind an empty state and an Import action. They are onboarding, not furniture.
- **Add local time per row.** It gates the calling window and no competitor shows it. See [section 28](#28-compliance-surface).

### 17.3 Acceptance
- [ ] No column renders if empty for every row in the current result set.
- [ ] Zero raw schema names visible anywhere in the UI.
- [ ] Header stays visible while the body scrolls and is never overlapped by the app header.
- [ ] Row height fixed by density mode, set with `min-height`.
- [ ] Every control's accessible name contains its visible label (SC 2.5.3).
- [ ] 12,000 rows scroll at 60fps.

---

## 18. Callbacks

`/callbacks` · **P0**

### 18.1 Measured
- Overdue 8, Due now **77**, Upcoming 2, Completed 4. Column headers repeat the same counts directly below the KPI tiles.
- Every card contains a native `<select>` for assignment, four actions, and sometimes a semicolon-delimited dump of alternate numbers and emails.
- Cards where the phone number is both title and subtitle.
- Items in "Due now" carrying "No time set".

### 18.2 Replace with

**A queue, not a board.** 77 due now is a work session, not a browsing task.

- Primary action becomes **Work callbacks**, entering the dialer with this queue loaded in time order.
- The board stays as a secondary view for managers reassigning in bulk.
- Card reduces to: name or number, time due, owner, one primary action, one overflow menu. Alternate contacts move behind the lead record.
- Assignment select becomes a token-styled combobox with typeahead, opened from the overflow menu rather than sitting inline in every card.
- **"No time set" gets its own bucket.** An item with no time is not due now, it is unscheduled, and it needs a different action.
- Counts appear once per screen.

**Borrow from Nooks**, the only competitor with documented callback handling worth copying: an incoming callback shows a banner with ringing audio when the rep is idle, and the same banner **without audio** when they are already on a call, to preserve focus. Accepting "gracefully concludes your current call."

### 18.3 Acceptance
- [ ] 77 due callbacks can be worked without leaving the dialer.
- [ ] No native select renders anywhere.
- [ ] Counts appear once per screen.
- [ ] Items with no scheduled time are not counted as due.

---

## 19. Appointments

`/appointments` · **P0**

### 19.1 Measured
- "NEEDS REVIEW 0 / All caught up" as the largest element, above 31 overdue appointments dating to 2 July.
- "SHOW RATE 0%" as a headline KPI with no valid denominator.
- Eleven controls across two rows in List view; the toolbar **changes shape** in Month, Week and Day views.
- Day view clips its first hour row.
- "drag to reschedule, drag the bottom edge to change the length" with no stated keyboard alternative.
- New appointment modal renders transparent (defect 1).
- Mid-transition, UPCOMING renders 0 before resolving to 57.

### 19.2 Replace with
- **Overdue is the hero.** When 31 appointments are unresolved, that number is the page. "All caught up" renders only when everything actually is.
- Every KPI needs a defined denominator and a stated window. Show rate with zero completed appointments displays "not enough data", never 0%.
- **One toolbar shape across all four views.** Search, saved view, view switch, New. View-specific controls (prev / next / Today) occupy a fixed slot that is present but disabled in List.
- Bulk triage on the overdue set: select many, mark held or no-show, one pass.
- Drag-to-reschedule keeps a keyboard path: focus an appointment, `Enter` to edit, arrow keys to move in 15-minute steps, `Shift` + arrows to resize.
- Calendar scroll starts at the first hour with an appointment, or 8am, whichever is earlier, with no clipped row.

### 19.3 Acceptance
- [ ] No positive status string renders while contradicting evidence is on the same page.
- [ ] Every KPI shows its window and denominator, or reads "not enough data".
- [ ] 31 overdue appointments can be cleared in under five minutes.
- [ ] The toolbar occupies the same geometry in all four views.
- [ ] Every drag interaction has a documented keyboard equivalent.

---

## 20. Live Floor

`/monitor`, `/monitor/team` · **P1**

### 20.1 Measured
- Nav says "Live Monitor", page says "Live Floor".
- On `/monitor/team` both nav items render active (prefix match).
- Twelve identical "Offline / Not on a call / 0:00 / 0 calls today" cards while the header reads 0 live, 0 connected, 0 online.
- Idle timers (1:09, 4:24) render beside "Not on a call" in the same format as call durations, unlabelled.
- Team Status is a full viewport of empty space around one centred message.
- History table's DETAILS column clipped at the right edge.
- Six filter chips plus search plus Grid/List plus Cozy/Compact: four more control idioms.
- Switching tabs unmounts the sidebar.

### 20.2 Replace with
- **Merge the two routes.** They answer the same question and one of them is empty.
- Sort by state, not alphabetically: on a call first, then idle, then offline collapsed to "9 offline" with an expand affordance.
- Label the idle timer, or remove it. A timer next to "Not on a call" in call-duration format is actively misleading.
- History table gets the shared DataTable: sticky header, no clipped columns, date grouping.
- **Adopt the Genesys supervision model**, the best-documented one available:

| Mode | Behaviour | Permission |
|---|---|---|
| Monitor | Listen silently. "Genesys Cloud does not notify the agent or customer that you are monitoring them." | `conversation:call:monitor` |
| Coach | Rep hears you, customer does not. | `conversation:call:coach` |
| Barge | Join the conversation. Only one supervisor at a time. | `conversation:call:barge` |

Whether the rep is told they are being monitored is a product and legal decision, not a default. Make it an org setting.

### 20.3 Acceptance
- [ ] Exactly one nav item is active for any route.
- [ ] Zero offline cards render when nobody is on a call.
- [ ] Nav label and page title are the same string.
- [ ] No table column is clipped at any supported viewport.

---

## 21. Reports and Leaderboard

`/reports`, `/leaderboard` · **P1**

### 21.1 Measured
- KPI tiles are unequal heights because one caption wraps to two lines; the misalignment is visible in the row.
- Funnel drawn as three left-aligned bars. Appointments labelled "4.6% of connects" but the bar scaled against dials, so 57 of 20,622 renders as 0.28% of the track.
- "Compare / needs a date range" uses inline error text as placeholder copy.
- Leaderboard renders a podium with a crown and a gradient bar, stylistically unrelated to everything else.
- "15 on the floor" and "9 Active reps" on the same screen.

### 21.2 Replace with
- Fix the funnel so bar length and label denominator agree, and state on the chart which basis is used.
- Fixed-height KPI tiles with captions on a reserved line, so the row never ragged-aligns.
- **A visible metric dictionary**, per [section 14](#14-the-metric-definition-layer). Every KPI links to its definition, window and source.
- Compare enabled by default against the previous equivalent period rather than requiring setup.
- Leaderboard podium goes. Ranking is a table with a sparkline per rep and a clear "you" row. Gamification lives in the copy and the movement indicator, not in 3D furniture.

### 21.3 Acceptance
- [ ] Every chart's visual encoding matches its label arithmetic.
- [ ] Connect rate is identical on Dashboard, Reports and Leaderboard for the same window, or visibly scoped differently.
- [ ] Every KPI tile in a row has identical height.
- [ ] Leaderboard uses the same components as every other table in the product.

---

## 22. Recordings

`/recordings` · **P1**

### 22.1 Measured
- 20,622 calls, no default filter. The list is dominated by five-second no-answers.
- Some play buttons render dimmed with no explanation.

### 22.2 Replace with
- **Default filter to conversations only**: connected calls above a minimum duration. That is the only reason anyone opens this screen. Everything else stays one click away.
- An unavailable play control states why: no recording, still processing, or retention expired.
- Transcript search is already the promise in the page description. Make it the primary input and show matched snippets in the row.
- Retention policy visible per row, since recording retention is a compliance surface.

### 22.3 Acceptance
- [ ] First screen shows conversations, not no-answers.
- [ ] Every disabled control states its reason.
- [ ] Transcript search returns highlighted snippets inline.

---

## 23. Assignments, No need right now, Campaigns

`/assignments`, `/bills-fine`, `/campaigns` · **P1**

### 23.1 Measured
- **Assignments:** eight of fourteen named "Upload · Pack 1" or "Pack 2". Assignee, Status, Priority and Due have zero variance across every row. Rows at 32/32 worked still show "Active". Rows with 0 leads also show "Active".
- **No need right now:** "TOTAL 61" and "READY TO RE-DIAL 61" are the same number in two of four tiles; the other two are empty. The list claims oldest first but the first three rows have no date.
- **Campaigns:** "No campaigns yet" while every lead row carries a campaign value.

### 23.2 Replace with
- Assignments status **derived from data**: Complete when worked equals total, Empty when total is zero, Active only in between. Name defaults to source plus date plus count, never "Pack 1".
- Columns with zero variance do not render.
- No need right now: rename to **Nurture**, two tiles not four, and only if they can differ.
- Campaigns: reconcile the model. Either the Leads campaign column is a source tag and should be renamed, or campaigns exist and the page queries wrong. One of the two screens is lying.
- All three lists get bulk select. 61 leads all "ready to re-dial" with no way to select them is a queue with no door.

### 23.3 Acceptance
- [ ] No two screens disagree about whether an entity exists.
- [ ] Status is derived from data, never stored independently of it.
- [ ] Every list supports multi-select and a bulk action.
- [ ] No column with zero variance renders.

---

## 24. Admin

`/admin`, six tabs · **P0**

### 24.1 Measured, per tab

| Tab | Findings |
|---|---|
| **Members** | Join code `F911E01` in plaintext on the default tab. Inline native selects for role. Three unlabelled icon buttons per row including a trash. Owner row has no controls, so rows ragged-align. |
| **Organization** | Six-tab row wraps, orphaning "Data & integrations". Brand colour and accent colour both `#2563eb`, neither matching any app token. Editing the tagline replaced the product name in the sidebar: "Donny's Dialer" became "Manual outbound calling". Native select for Specialization. |
| **Notifications** | Env var names `APPOINTMENT_NOTIFY_EMAILS` and `RESEND_FROM` exposed in user-facing copy. Placeholder `brock@example.com`. |
| **Companies** | "No companies yet", consistent with Console. **The Do Not Call list lives here**, as the second card. 157 suppressed numbers rendered unpaginated, unvirtualised, no search, no date column. Two of three columns have zero variance ("Rep call", "Marked do not call on a call"). |
| **Activity log** | Reasonable. Flat list, no filter, no date grouping, no pagination. |
| **Data & integrations** | Integrations panel collapses; descriptions render one word per line. Six integrations all Connected. Lead totals here (12,358 / 22 qualified / 18 appointments / 9,989 never dialed) disagree with Leads and Appointments. |

### 24.2 Replace with
- **Move DNC out of Companies into its own top-level Admin tab**, ranked first. It is the most regulated surface in the product and it is currently a subsection of a page about teams.
- DNC table gets: search, pagination or virtualisation, a **request date column**, a source column that distinguishes rep-marked from imported from registry-scrubbed, and an SLA indicator. The obligation runs 5 years from the request, so the date is not optional.
- Tabs become a scrollable single row, or a left sub-nav above six items.
- Mask the join code with a reveal and a rotate control.
- Icon buttons get accessible names. Role select becomes a token-styled component.
- Brand and accent colour wire to the token system or are removed. Two fields with the same value that affect nothing are worse than no fields.
- Tagline never overwrites product name in the shell.
- Env var names never appear in user copy.
- Integrations panel gets a real grid: name, status, last checked, action. Not a squeezed two-column collapse.

### 24.3 Acceptance
- [ ] No secret renders unmasked by default.
- [ ] Every icon-only control has an accessible name.
- [ ] DNC is reachable in one click from Admin and shows request dates.
- [ ] No environment variable name appears in any user-facing string.
- [ ] The tab row never wraps.
- [ ] Editing any org field updates only the field it names.

---

## 25. Superadmin Console

`/console`, four tabs · **P0**

### 25.1 Measured

| Tab | Findings |
|---|---|
| **Overview** | Rendered `ORGANIZATIONS 0` and `ACCOUNTS 1` above a list of eleven organisations with 8, 15 and 2 members. "Shut down app" third from top with no visible confirmation. Stat tile icons are red for Organizations and Companies, implying danger where none exists. |
| **Organizations** | **Nine join codes in plaintext**: ED7B9AB, F911E01, QAROSTER, LL2Y4QM, AHRCLL9 and more. Two organisations both named "Sunrun". "Build with AI" is the brightest control and it is red. Suspend at equal weight to Manage. Unlabelled trash beside Suspend. "0 companies" on every row. |
| **Accounts** | 50 rows at once, no pagination, search or filter. Two native selects per row (**[D]** ~100 on the page). "Make platform" grants platform privilege at the same weight as "Suspend". Suspend, Make platform and Delete adjacent. "seen 22 hour…" truncated mid-word. |
| **App Control** | "Shut down app" again, beside a lockout message field, no typed confirmation, no reason field. ~80% empty space. |

### 25.2 Replace with
- **Console keeps its separate identity, deliberately.** Same tokens, distinct chrome, so it is obvious you have left the product. Its accent is `--signal-stop` used sparingly, not as a general surface colour.
- **One kill switch, on one tab, behind a real gate:** typed confirmation of the platform name, a mandatory reason field, and a stated blast radius ("11 organisations, 50 accounts will lose access immediately"). Five9's pattern is the reference: defaults exist to keep you compliant, and changing one raises a warning naming the default.
- **Join codes masked by default**, revealed one at a time, with rotate and copy actions and an audit entry on reveal.
- Accounts gets search, filter by org and status, and pagination or virtualisation.
- **Destructive actions separate from constructive ones.** Suspend and Delete move into an overflow menu. "Make platform" gets its own confirmation naming what the privilege grants. NN/g lists proximity of destructive and confirmation actions as a top-ten mistake; this row commits it three times.
- Stat tile icons take neutral treatment. Colour on a tile means the value needs attention, not that the category exists.
- Two orgs with the same name get a generated monogram and colour from their id, so they are visually distinguishable.

### 25.3 Acceptance
- [ ] No irreversible platform action is reachable in fewer than three deliberate steps.
- [ ] Every destructive confirmation states its blast radius in numbers.
- [ ] No join code or secret renders unmasked by default.
- [ ] Stat tiles never contradict the list directly beneath them.
- [ ] Destructive and constructive actions are never adjacent in a row.

---

## 26. Hub and Settings

`/hub`, `/settings` · **P1**

### 26.1 Measured
- **Hub:** two organisations both named "Sunrun", separable only by subtitle. Nine identical building icons differing only by chip colour. Cards ~180px tall holding three lines. No search, no sort, no last-used. No sidebar, no header: a fourth chrome pattern.
- **Settings:** left card ~60% empty around an avatar. A checklist of fourteen green ticks consuming a full screen. Legal links stuffed under a Save button.

### 26.2 Replace with
- **Hub:** search, last-opened ordering, a generated monogram and colour per org derived from its id, and a compact list mode above six orgs. Show role and member count on the card. Adopt the shell's header so it is recognisably the same product.
- **Settings:** a two-column form with real sections (Profile, Preferences, Notifications, Legal). The permissions checklist collapses to a role summary line with details on demand. Legal links move to a footer.

### 26.3 Acceptance
- [ ] Two organisations with the same name are visually distinguishable at a glance.
- [ ] Hub is usable at 25 organisations.
- [ ] No card reserves more than 1.5× the height of its content.

---
---

# PART V · COMPONENTS

## 27. Component inventory

42 components in four tiers. Each tier unblocks the next. **No component in a later tier may introduce a new colour, radius, shadow or type value.**

### Tier 1 · Primitives (15)

| Component | Variants | Notes |
|---|---|---|
| `Button` | primary, secondary, ghost, danger, link × sm/md/lg | One primary per view. Danger uses `--signal-stop`. Never a gradient. |
| `IconButton` | same | **`aria-label` is a required prop.** Minimum 24×24, target 32×32. |
| `Input` | text, number, phone, search | Phone uses `mono-13` with tabular figures. |
| `Textarea` | | Auto-grow to 6 rows then scroll. |
| `Select` | | **Replaces every native `<select>` in the product.** Highest-value single component in the tier. |
| `Combobox` | single, multi | Typeahead. Used for assignment, owner, campaign. |
| `Checkbox` | | 16px box, 24px hit area via the spacing exception. |
| `Radio` | | |
| `Switch` | | State announced to assistive tech on change. |
| `Chip` | neutral, accent, live, ring, stop | Colour plus shape. Never colour alone. |
| `Badge` | count, dot | Count badges cap at 99+. |
| `Avatar` | xs/sm/md, monogram fallback | Monogram colour derived from id, not from a random palette. |
| `Tooltip` | | Never the only source of a control's name. |
| `Spinner` | | Only for actions, never for page load. Pages use skeletons. |
| `Skeleton` | text, box, row, tile | Matches final geometry exactly. Opacity shimmer only. |

### Tier 2 · Layout and shell (13)

| Component | Notes |
|---|---|
| `AppShell` | Owns the four regions and the z-scale. Mounts once. |
| `SidebarNav` | Three tiers, role-scoped, collapsible, exact-match active state. |
| `TopBar` | Opaque. No primary action. |
| `CallBar` | Persistent. Scroll padding and focus order solved here, once. |
| `CommandPalette` | `Cmd/Ctrl K` with correct platform detection. Opaque panel. |
| `Page` | Title, description, one optional primary action. |
| `Panel` | Collapses to one line when empty. |
| `Toolbar` | The only home for filter and view controls. One per page. |
| `Overlay` | Modal, palette, drawer, popover, sheet. See [section 12](#12-the-overlay-system). |
| `Tabs` | Scrollable single row. Never wraps. |
| `SegmentedControl` | Max 4 options. Beyond that it is a Select. |
| `SplitView` | `min-width: 0` on every track. |
| `Toast` | Bottom-centre, above the CallBar, auto-dismiss 5s, never for errors requiring action. |

### Tier 3 · Data (10)

| Component | Notes |
|---|---|
| `DataTable` | Virtualised, sticky header, pinned first column, density-aware, `min-height` rows. Hides columns empty across the result set. |
| `ColumnManager` | **Keyboard operable.** Drag is an enhancement, not the mechanism. |
| `FilterPanel` | Typed filters: field, operator, value. Replaces five idioms. |
| `SavedViews` | Per user, shareable to team. |
| `BulkActionBar` | Appears on selection, at the top of the table per Carbon. |
| `EmptyState` | Statement plus the action that resolves it. |
| `Pagination` | Or infinite scroll with a count. Never neither. |
| `StatTile` | Fixed height. Reserved caption line. Requires a window and a scope. Renders `unavailable`, never a misleading zero. |
| `Sparkline` | Emphasised endpoint, faint baseline. |
| `Funnel` | Encoding basis stated on the chart. |

### Tier 4 · Telephony (10) · **[U]** live states unvalidated

| Component | Notes |
|---|---|
| `LineStatusRow` | Number, ring elapsed, outcome. Ringing / connected / abandoned / **blocked** distinguishable without reading. |
| `DispositionGrid` | Numeric keys 1 to 9 mapped in display order. Never a modal. |
| `DialPad` | Collapsed by default. Opens on `#`. |
| `RecordingIndicator` | 3:1 non-text contrast. Dot plus ring. Opacity-only animation. |
| `CallerIdSummary` | One line at rest. Expands to pool health. |
| `BriefingPanel` | Metrics at `metric-40`, opening line at `copy-14` at 66ch. |
| `TranscriptStream` | Live, auto-scroll with a pause-on-scroll-up. |
| `WrapForm` | Disposition, note, next action. Focus lands in the note field. |
| `QueuePreview` | Virtualised up-next list. |
| `LocalTimeBadge` | Called-party local time with a calling-window state. |

### 27.1 The rule that stops the drift

> A component may not use a hex value, a raw rem value, or a shadow that is not in the token file.

Enforce it with a lint rule in CI, not with discipline. The current build has a good token file and still shipped a red focus ring on a blue button, because nothing stopped it.

```
// eslint config sketch
"no-restricted-syntax": [error,
  { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: "Use a token." },
  { selector: "Literal[value=/\\d+(\\.\\d+)?rem/]",     message: "Use a space token." },
  { selector: "Literal[value=/rgba?\\(/]",              message: "Use a token." }
]
```

Plus a build-time check that every `box-shadow`, `border-radius` and `font-size` in the compiled CSS appears in the allowed set.

---
---

# PART VI · THE EDGE

## 28. Compliance surface

This is the part of the plan that is not about fixing what is broken.

I read the public documentation for JustCall, Kixie, Salesfinity, Nooks, Talkdesk, Orum, Close, Five9, Outreach, Salesloft, Apollo and Aircall. **None of them surface regulatory state in the calling workspace.** All of it is derivable from data AIATWORK already holds, and it is the most defensible differentiator available to a product this size.

> **Read this as a design input, not as legal advice.** These citations are current as of this audit and they are here because they shape the interface. I am not a lawyer. Anything encoded as an enforced rule, the recording consent state list above all, needs review by counsel before it ships.

### 28.1 The eight surfaces

| Rule | What it requires | What to put in the UI |
|---|---|---|
| **Calling hours**<br>47 CFR 64.1200(c)(1)<br>16 CFR 310.4(c) | No solicitation before 8am or after 9pm **local time at the called party's location**. | Local time on every lead row and in the call bar. Out-of-window leads **gated** in the queue, not merely annotated. The dialer already shows a timezone on the lead card; make it a rule. |
| **Abandonment**<br>47 CFR 64.1200(a)(7)<br>16 CFR 310.4(b)(1)(iv) | Max 3% of live-answered telemarketing calls abandoned. A call is abandoned if not connected to a live rep within **2 seconds** of the greeting. FCC measures over 30 days; FTC measures **per campaign**. | A live abandon-rate readout scoped **per campaign per rolling 30 days**, which satisfies both regulators at once. Parallel line controls warn as the projected rate approaches the cap. |
| **Ring time floor**<br>16 CFR 310.4(b)(1)(iv) | Must let the phone ring at least **15 seconds or 4 rings** before disconnecting. | A hard floor in pacing settings, not a free numeric input. |
| **Recording consent** | All-party states include CA, FL, IL, MA, MI, MT, NH, PA, WA and MD. Nevada requires all-party for phone calls specifically. Connecticut is split: one-party criminally, all-party for civil exposure unless a recorded warning is played. | Consent state derived from the **called party's** location, same as calling hours. Connecticut's recorded-warning safe harbour makes an automated announcement the lowest-friction universal default. **Do not hardcode a state list without legal review.** |
| **Caller ID duties**<br>47 CFR 64.1601(e) | Telemarketers must transmit CPN or ANI, may substitute the seller's customer-service number, and **that number must accept do-not-call requests during business hours**. Blocking caller ID is prohibited outright. | The real constraint on rotation. Every number in the 11-number pool must be inbound-capable and handle DNC. Surface pool health in Admin: inbound reachable, DNC routed, calls placed today, reputation, attestation level. |
| **Blocked calls**<br>47 CFR 64.1200(k) | Blocked calls return **SIP 603 or higher**. Providers must give a caller-ID dispute status update within 24 hours. | Surface **Blocked** as a distinct call outcome, separate from "no answer". Nobody does this. A rep currently cannot tell a spam block from a dead number, and those need completely different responses. |
| **Internal DNC**<br>47 CFR 64.1200(d) | Record the request when made; honour within a reasonable time **not exceeding 10 business days**; honour for **5 years**. National registry scrub must use a list **no more than 31 days old**. | One-keystroke DNC from the call workspace with an SLA clock. A 5-year retention model preserving the original request timestamp. Scrub freshness as a visible Admin status, not a silent cron job. **The current DNC table has no date column at all.** |
| **One-to-one consent** | Vacated by the Eleventh Circuit January 2025 (*Insurance Marketing Coalition v. FCC*), mandate 30 Apr 2025, formally repealed at 90 FR 42137 effective 29 Aug 2025. Prior express written consent definition restored. | Do not build a per-seller consent cardinality constraint into the lead model. Record the consent artifact, its disclosure text, and the signature timestamp. |

### 28.2 The caller-ID pool panel

The single most differentiated screen in the plan. Admin, under Telephony.

| Column | Source | Why it matters |
|---|---|---|
| Number | Twilio | |
| Area code / market | derived | Local presence matching |
| Attestation | STIR/SHAKEN A / B / C | A = "authenticated the calling party and they are authorized to use the calling number." B and C degrade answer rates. |
| Reputation | carrier / third-party feed | Spam-likely labelling |
| Calls today | own data | Volume per number drives labelling |
| Inbound reachable | health check | **Required by 64.1601(e)** |
| DNC routed | config check | **Required by 64.1601(e)** |
| Blocked rate | SIP 603+ | Early warning a number is burned |

Kixie's documented approach rotates "over 50 local numbers" per area code. **[D]** That implies 50+ inbound-capable, DNC-handling numbers per area code, which is an admin requirement every product hides. Making it visible is both a compliance feature and a sales feature.

---

## 29. Keyboard model

Dials per hour is the metric the product is sold on, and it is decided almost entirely by how long the wrap state takes.

Of the twelve dialers researched, only Close, Aircall, Kixie, Dialpad and Genesys publish a shortcut list at all, and only Close covers the full loop. Kixie has no shortcut for disposition, voicemail drop or next call.

### 29.1 The map

| Key | Action | Notes |
|---|---|---|
| `Space` | Start or end call | Only when no text input has focus. The most-used key in the product. |
| `1`–`9` | Apply disposition | Mapped to the disposition grid in display order. This is the wrap loop. |
| `N` | Save and next | Commits the wrap and dials the next lead. |
| `/` | Focus notes | Types straight into the note field from anywhere on screen. |
| `C` | Schedule callback | Opens the scheduler with the next sensible slot preselected. |
| `B` | Book appointment | Inline, never in a modal that hides the lead. |
| `D` | Mark do not call | Starts the 10-business-day SLA clock. Confirms once. |
| `M` / `H` / `R` | Mute / hold / record | Toggles. Each announces its new state to assistive tech. |
| `J` / `K` | Previous / next lead | Works in the queue and in any table. |
| `Cmd/Ctrl K` | Command palette | Correct modifier per platform. Present at every breakpoint. |
| `?` | Shortcut sheet | Close's pattern. Teaches the shortcuts rather than hiding them in docs. |
| `Esc` | Close | **Never bound to any destructive action, anywhere.** |

### 29.2 Two mistakes to avoid, both shipping in real products today

**Do not bind two actions to one key.** Close binds `Cmd .` to hang up *and* pause dialer. Aircall binds `Alt E` to decline *and* end call. NN/g lists proximity of destructive and confirmatory actions as a top-ten application design mistake, and a shared binding is the most extreme form of it.

**Never place hang up adjacent to next call**, in the layout or in the key map.

### 29.3 Discoverability

- The `?` sheet is reachable from every screen and lists only the shortcuts valid in the current context.
- The command palette shows each action's shortcut beside it, which is how people learn them without reading documentation.
- Shortcuts fire only when the app has focus, which Aircall documents explicitly. Say so in the sheet rather than letting reps discover it during a call.
- **Fix the modifier hint.** The header chip currently reads ⌘K while only Ctrl K works.

---
---

# PART VII · QUALITY

## 30. Accessibility gates

WCAG 2.2 Level AA. Anything below is a build failure, not a backlog item.

| Criterion | Threshold | What it means here, including the exemptions available |
|---|---|---|
| **1.4.3** Contrast | 4.5:1 text, 3:1 large | Large means 18pt, or 14pt bold, and above. Every ink token in [section 6](#6-colour) is pre-verified against every surface it can sit on. |
| **1.4.11** Non-text contrast | 3:1 | Applies to component state, which explicitly includes the recording indicator, live call state, line status dots and disposition chips. A 1px colour-only border fails. Current control borders measure 1.39:1. |
| **1.4.10** Reflow | 320 CSS px | Exemption reads "except for parts of the content which require two-dimensional layout for usage or meaning" and names **"data tables (not individual cells)"**. The queue table is exempt as a whole; cell contents are not. The example list also covers "interfaces where it is necessary to keep toolbars in view", which covers the CallBar. |
| **2.4.11** Focus not obscured | Not entirely hidden | Sticky header plus docked call bar is exactly what this targets. Scroll padding reserves both. |
| **2.5.8** Target size | 24 × 24 px | The **Spacing** exception is what makes a dense table legal: an undersized target passes if a 24px circle centred on it does not intersect another target's circle. This becomes a lint check, not a guess. |
| **2.5.3** Label in name | Accessible name contains visible label | The Leads "Filters" button currently fails: its accessible name is its tooltip. |
| **1.4.12** Text spacing | 1.5× line height | Row heights use `min-height`. Fixed heights are the classic failure. |
| **2.4.3** Focus order | Logical | The CallBar sits last in DOM order so it does not interrupt page tab order. |
| **1.4.1** Use of colour | Not colour alone | Every state chip pairs colour with a shape. |
| **2.3.3** Animation | AAA, adopt anyway | Colour and opacity changes are excluded from the definition of motion animation. Everything that translates or scales needs a `prefers-reduced-motion` path, and MDN's guidance is to tone down rather than strip. |

### 30.1 Automated gates in CI

```
axe-core          zero violations on every route, both themes
contrast script   every leaf text node ≥ 4.5:1 (or ≥ 3:1 if large), both themes
target size       every interactive element ≥ 24×24 or passes the spacing circle test
heading order     no skipped levels on any route
label in name     every control's accessible name contains its visible label
overlay assert    every overlay panel has background alpha 1 and a scrim sibling
```

## 31. Performance budgets

| Metric | Budget | Why this number |
|---|---|---|
| **INP** | < 200ms p75 | The most important metric in this product. A dialer session is one long-lived page with hundreds of interactions, and INP takes near-worst-case across the whole visit. One slow disposition save at call 40 sets the score. Optimise what repeats per call, not page load. |
| **LCP** | < 2.5s p75 | Core Web Vitals good threshold. |
| **CLS** | < 0.1 p75 | Reserve space for every async panel. Skeletons match final geometry. Opening an overlay must produce a CLS delta of 0. |
| Interaction response | < 100ms | RAIL: complete a transition initiated by user input within 100ms; 0 to 100ms feels instantaneous. |
| Animation frame | < 10ms | RAIL: 16ms at 60fps minus ~6ms of browser render. |
| **Perceived connect** | < 100ms | Bridge event to painted state change, **not** from dial. The FCC's 2-second connect deadline is 20× the RAIL instantaneous budget, so the regulatory limit is no guide to what feels right. |
| Mouth-to-ear audio | < 150ms one way | ITU-T G.114: below 150ms "most applications will experience essentially transparent interactivity." 400ms is the planning ceiling. Vendor "sub 0.5 second connect" claims describe bridge time, not audio latency; do not conflate them. |
| DOM nodes | < 800 in body | Lighthouse warns at ~800, errors at ~1,400. This is what forces virtualisation on the queue table. |
| Route transition | < 200ms to first paint | And the shell must not unmount during it. |

## 32. Test strategy

| Layer | Covers |
|---|---|
| **Visual regression** | Every route × 2 themes × 3 viewports (1440, 1024, 390). Plus every overlay open. The overlay screenshots are what would have caught defects 1 to 3. |
| **Interaction** | The wrap loop end to end with keyboard only, timed. Route transitions asserting the nav item count never decreases. |
| **Contrast** | Automated across every leaf text node, both themes, as a build gate. |
| **State** | Every metric component rendered in all four states (loading, error, unavailable, ok). A snapshot asserting no `0` appears in a loading state. |
| **Data reconciliation** | A nightly job asserting the same metric id returns the same value across every screen for the same window and scope. This is what stops cause 6 from returning. |
| **Live call** | Against a staging org with test numbers. The four dialer states, the connect beat timing, the CallBar across route changes. **This is the gap in the current audit and it must be closed before Phase 3.** |

---
---

# PART VIII · EXECUTION

## 33. Rebuild sequence

Full shell rebuild, which means the first two phases produce no new screens. Each phase names what actually ships, because a rebuild with no visible output is how rebuilds get cancelled.

### Phase 0 · Week 1 · Stop the bleeding

No architecture change. Six visible fixes, all P0.

- [ ] Give `Overlay` an opaque background and a scrim. **Fixes defects 1, 2 and 3 in one change.**
- [ ] Fix `--primary` so it is not the same hue as `--danger`, and make the primary button read the token instead of a literal gradient.
- [ ] Give `.glass` a real `backdrop-filter` and an opaque base, or make the header opaque.
- [ ] Fix nav active matching from prefix to exact.
- [ ] Remove the "All caught up" string whenever overdue > 0.
- [ ] Mask the Admin join code and the nine Console join codes.
- [ ] Fix the AI Agent paywall email and route it to an upgrade flow.

> **Ships:** the three worst defects in the product, gone, in a week.

### Phase 1 · Weeks 2 to 4 · Token layer and primitives

- [ ] Replace the token file with [section 6](#6-colour) through [section 8](#8-space-radius-elevation) in full. Both themes, verified contrast on every ink-over-surface pair.
- [ ] Build the 15 primitives. **`Select` first**: it removes every native select in the product in a single change.
- [ ] Add the CI lint rule banning hex, raw rem and off-token shadows.
- [ ] Ban opacity modifiers on ink tokens and remove every existing instance.
- [ ] Fix the heading hierarchy so no level is skipped.

> **Ships:** a visibly calmer product on every screen, and a light mode that is not two products glued together.

### Phase 2 · Weeks 4 to 7 · The shell

- [ ] `AppShell` with the persistence contract. Shell mounts once and never unmounts on navigation.
- [ ] Three-tier role-scoped navigation, opaque top bar, command palette at every breakpoint with correct modifier detection.
- [ ] The persistent `CallBar`, with 2.4.11 scroll padding and focus order solved once, globally.
- [ ] Loading, empty and error state system. The zero rule enforced by the `Metric` type.
- [ ] Density setting, stored per user, applied globally.
- [ ] The Stage layer: ambient field, glass on its three permitted surfaces, the curve set.

> **Ships:** a live call visible from every screen. The change reps notice first.

### Phase 3 · Weeks 7 to 11 · Power Dialer

- [ ] Run the live-call audit against staging first. Close the **[U]** gap.
- [ ] Three-column, zero-scroll, four-state workspace per [section 15](#15-power-dialer).
- [ ] Full keyboard model with the `?` sheet.
- [ ] Caller-ID summary line, status strip regrouped, briefing promoted to the centre column.
- [ ] The connect beat, instrumented against the 100ms target.

> **Ships:** the product's core loop. Measure dials per hour before and after. This is where the number moves.

### Phase 4 · Weeks 11 to 15 · Data surfaces

- [ ] `DataTable` with virtualisation, sticky header, pinned column, keyboard-operable column manager.
- [ ] Column sets and saved views. Leads, Recordings, Assignments, Nurture, Console Accounts and the DNC list all move onto it.
- [ ] Callbacks becomes a queue with the board as a secondary view.
- [ ] Bulk select and bulk actions everywhere.

> **Ships:** 77 due callbacks workable in one session instead of 77 clicks.

### Phase 5 · Weeks 15 to 18 · Truth

- [ ] The metric registry. Every KPI gets a name, window, denominator and source.
- [ ] Dashboard, Reports and Leaderboard read from it. The three-way connect-rate disagreement closes structurally.
- [ ] Work the reconciliation backlog in [section 14.3](#143-reconciliation-backlog). Every question answered.
- [ ] Funnel encoding corrected. Appointments triage. Assignment status derived from data. Campaigns reconciled.
- [ ] Nightly reconciliation job in CI.

> **Ships:** no two screens disagree. The phase that makes the product demoable to an enterprise buyer.

### Phase 6 · Weeks 18 to 22 · The differentiator

- [ ] Called-party local time as a queue gate, not a label.
- [ ] Live abandon rate, scoped per campaign per rolling 30 days.
- [ ] Caller-ID pool health panel: inbound reachable, DNC routed, volume today, reputation, attestation.
- [ ] **Blocked** as a distinct call outcome from SIP 603+.
- [ ] One-keystroke DNC with the 10-business-day SLA clock and 5-year retention, and a date column on the DNC table.
- [ ] DNC promoted out of the Companies tab.
- [ ] Console hardening: one kill switch, typed confirmation, reason field, stated blast radius.

> **Ships:** capability no competitor documents. This is what the product gets sold on.

### 33.1 Dependency graph

```
Phase 0  ──┐
           ├──> Phase 1 ──> Phase 2 ──┬──> Phase 3 ──> Phase 6
           │                          └──> Phase 4 ──> Phase 5
Live-call audit ───────────────────────────^
```

Phases 3 and 4 can run in parallel with two teams. Phase 5 depends on Phase 4's DataTable. Phase 6 depends on Phase 3's dialer.

---

## 34. Definition of done

A screen is not finished until every line is true of it. No exceptions.

### Design system
- [ ] Zero hex values, raw rem values or off-token shadows in the component source. Enforced in CI.
- [ ] Exactly one element uses `--accent` as a filled background per view.
- [ ] No opacity modifier is applied to any ink token, anywhere.
- [ ] No text renders below 11px.
- [ ] Heading levels are sequential with none skipped.

### Accessibility
- [ ] Every text and icon pair passes 4.5:1, and every state indicator passes 3:1, in both themes, verified by automated check.
- [ ] Every interactive target is 24 × 24 CSS px or passes the 24px spacing circle test.
- [ ] No icon-only control ships without an accessible name.
- [ ] Every control's accessible name contains its visible label.
- [ ] Fully operable by keyboard, and focus is never entirely hidden by the header or the CallBar.
- [ ] Renders correctly at 320 CSS px, taking the data-table exemption only where it genuinely applies.
- [ ] Nothing translates or scales without a `prefers-reduced-motion` path.

### Overlays and state
- [ ] Every overlay has an opaque panel and a scrim. Screenshot-verified.
- [ ] No numeric slot renders `0` while loading.
- [ ] Every metric that cannot be computed reads "not enough data", never a misleading value.
- [ ] Every empty state offers the next action, and no empty panel reserves more height than its content.
- [ ] Every disabled control states why it is disabled.
- [ ] The shell does not unmount during navigation.

### Data and trust
- [ ] No native `<select>`, anywhere in the product.
- [ ] Every column empty across the current result set is hidden.
- [ ] Zero raw schema names visible in the UI.
- [ ] Every number on screen has a visible scope and window.
- [ ] No two numbers in the product disagree for the same metric, window and scope.
- [ ] Positive status strings cannot render while contradicting evidence is on the same page.
- [ ] No environment variable name appears in any user-facing string.

### Safety
- [ ] No secret renders unmasked by default.
- [ ] No irreversible action is reachable in fewer than three deliberate steps.
- [ ] Every destructive confirmation states its blast radius in numbers.
- [ ] Destructive and constructive actions are never adjacent in a row.

### Cinema
- [ ] Depth, blur and glow appear on Stage surfaces only, and never behind text.
- [ ] The ambient field runs at ≤ 30fps, pauses when hidden or on a live call, and renders one static frame under reduced motion.
- [ ] Exactly three surfaces use glass.
- [ ] Perceived connect is under 100ms at p75.

---

## 35. Appendix: measurement log

Conditions and instrumentation, so any number here can be reproduced.

| Item | Value |
|---|---|
| Date | 29 August 2026 |
| Build | `aiatworkdialer.vercel.app`, production |
| Org context | VICC / Donny's Dialer, Owner role |
| Viewports | 1512×950, 1440×900, 430×900 |
| Themes | Dark (default) and light, via the header toggle |
| Routes visited | 18 top-level, plus 6 Admin tabs, 4 Console tabs, 3 Live Floor tabs, 4 Appointments views |
| Overlays opened | Command palette, notifications, New appointment |

**Method.** Computed styles and DOM geometry read directly in the running page. Per-column emptiness computed across all rendered `tbody` rows. Contrast computed with WCAG 2.x relative luminance over the nearest ancestor with an effective alpha above 0.85, on every leaf text node, in both themes. Nav overflow measured as `scrollHeight - clientHeight` on the nav's scroll container. Token values read from the parsed stylesheet's `:root` and `.dark` rules.

**Known limitations.** The contrast walker treats `oklab` alpha crudely, so dark-theme ratios for alpha-modified tokens are approximate in magnitude though correct in direction. Some counts drifted across the 40-minute window because the org was live; drift is flagged where it appears and is separated from genuine disagreement.

## 36. Appendix: sources

**Design systems**
- IBM Carbon: spacing scale, type sets, 2x grid, data table row heights (24 / 32 / 40 / 48 / 64px, 16px cell padding at every size)
- Material 3: elevation tokens 0 to 5, "surface tint color is deprecated", state layer opacities (hover 8%, focus 10%, press 10%, drag 16%, disabled 38%), 32% scrim
- Vercel Geist: 10-step colour roles, the Label versus Copy split, tabular figures guidance
- Radix Colors: 12-step scale, one job per step
- Apple HIG: Materials, Spatial layout, depth and glass guidance
- USWDS and Section508.gov: font size guidance for the web

**Accessibility**
- W3C WCAG 2.2 Understanding documents: SC 1.4.1, 1.4.3, 1.4.10, 1.4.11, 1.4.12, 2.3.3, 2.4.3, 2.4.11, 2.5.3, 2.5.8
- MDN: `prefers-reduced-motion`

**Performance**
- web.dev: Core Web Vitals thresholds, INP, RAIL, virtualisation guidance
- Chrome DevTools docs: DOM size audit thresholds
- ITU-T G.114: one-way transmission time

**Regulatory**
- eCFR 47 CFR 64.1200, 64.1601, 64.1604, 64.6301
- eCFR 16 CFR 310.4
- Federal Register 90 FR 42137 (29 Aug 2025)
- Reporters Committee for Freedom of the Press, Reporter's Recording Guide

**Competitor documentation**
- Close, Aircall, Kixie, Dialpad, Genesys Cloud, Orum, Nooks, Salesfinity, JustCall, Outreach, Salesloft, Apollo, Five9, Talkdesk

**Interaction research**
- NN/g: "Data Tables: Four Major User Tasks", "Top 10 Application Design Mistakes"
- Linear: the Linear Method, "Invisible details"

---

*End of specification. 80 defects, 42 components, 7 phases