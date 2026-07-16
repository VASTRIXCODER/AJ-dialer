# Data-point audit — every UI number that was wrong, and the fix

Context: the team reported that figures in the app "were wrong… it's just the UI, the
back end is still functional." That was accurate — the persisted data was correct; the
**displayed** numbers were miscounted, wrongly-windowed, or capped. This is the full list,
each with where it showed, what was wrong, and what changed. All fixes are display/query
logic only — no call, appointment, or lead data was altered.

| # | Metric (where shown) | What was wrong | Fix |
|---|---|---|---|
| 1 | **Total calls / Connections / Avg talk / Dispositions / Funnel** — Reports & Dashboard | Reporting fetched call rows under a fixed cap (2,000 for a rep, 20,000 for a supervisor) and counted them in JS. A rep power-dialing passes 2,000 calls in ~2 weeks, so every 30-day and all-time report **silently under-counted** "the amount of calls." | `getReportingData` now **pages** the fetch to completion and bounds it to the window in play (`src/lib/db/metrics.ts`). Ranged reports pull only their window; all-time pages the whole history to a 50k ceiling (oldest-first drop, logged). A rep's 30-day report is now exact. |
| 2 | **Appointments** — Reports KPI | Ignored the date-range selector — it always showed all-time, so "Today" could read *"5 calls / 340 appointments."* | Now scoped to the selected range (by booking date, org timezone), still sourced from the appointments table so it agrees with the Dashboard + calendar. |
| 3 | **"Appointments"** shown in 3 places with 3 different numbers | Dashboard/Reports counted booked appointment **rows**; the Leads page counted **leads in 'appointment' status**; the funnel counted **call outcomes**. All three were labeled "Appointments." | The Leads tile is relabeled **"In appointment stage"**; the Reports KPI and Dashboard use the same appointments-table source; the funnel keeps its own (outcome-based) label. |
| 4 | **"connects" — dialer session bar** | Only ever incremented on a human answered call, so an **AI** session read **"N dials · 0 connects" forever**. | The client can't truthfully know AI answer-state (that lives on the server / Live Monitor), so the "connects" stat is now **hidden in AI mode** instead of showing a false 0. |
| 5 | **"dials" — dialer session bar & day counter** | A **3× parallel human dial** counted as **1** dial, while AI counted each lead — so the two modes' dial totals meant different things and multi-line human sessions under-counted. | Human dials now count **each line placed** (a 3× dial = 3 dials), matching AI. |
| 6 | **Completed / Connect rate / Appointments — AI Live Monitor KPI strip** | Computed over only the **last ≤8–12** finished calls, so the tiles were noisy and never reconciled with Reports. | Now whole-**day** totals (org timezone) via cheap server count queries, excluding "never a real call" rows from the connect-rate denominator (`getAITodayStats`). |
| 7 | **Connect rate — Dashboard hero** | Showed the **all-time** rate right beside "Calls **today**," so a great day next to a mediocre lifetime looked self-contradictory. | The Dashboard hero now shows **today's** connect rate (`connectRateToday`); period/all-time rate still lives on Reports. |
| 8 | **dials today** — dialer | Computed and persisted, but **rendered nowhere** (dead metric). | Now shown in the session bar as an all-day counter, distinct from the per-session count. |
| 9 | **Any report** — on a transient DB error | On a caught query error the code fell back to the bundled **demo** dataset, which (only if `NEXT_PUBLIC_DEMO_DATA=true`) could paint **fabricated numbers over real data**. | A configured-Supabase query failure now returns an **empty** result, never demo data. Also confirm `NEXT_PUBLIC_DEMO_DATA` is unset in production. |

## Deliberately left as-is (not bugs)

- **Leaderboard weekly/monthly windows use rolling epoch math while "daily" uses the org
  timezone.** This is intentional and documented: rolling 7-/30-day windows aren't
  calendar-day-boundary sensitive the way a single day is (`src/lib/leaderboard.ts`).
- **AI-vs-human channel split** counts an AI attempt (incl. no-answer) as a call but a human
  call only once the rep dispositions it — the two channels record at different points by
  design. The split is labeled as a comparison, not a shared total.

## Known bound (documented, not a regression)

For an organization whose **all-time** history exceeds 50,000 calls, the all-time
distribution charts (not the headline counts) reflect the most recent 50,000 calls; a
warning is logged when that ceiling is hit. Ranged reports (Today/7d/30d) are always exact.
