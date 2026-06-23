# Attending Launch — Product Roadmap

A phased plan for evolving Attending Launch from a single-page calculator into a
Boldin-style financial planning app that you live in over time.

## Decisions locked in
- **Navigation:** top **tabs** (sits above the main content; the left input
  sidebar stays shared across all tabs).
- **Depth priority:** **generic retirement depth first.** Physician-specific
  modules (PSLF, refinance vs. IDR, disability insurance) come later; the
  Student Loans tab ships as a light summary for now.
- **Cloud login:** **committed** as a later phase. All persistence is built
  behind one adapter interface so a Supabase cloud adapter drops in without
  touching the pages.

---

## Architecture foundations
- **Routing — hash-based SPA router** (`js/router.js`). `location.hash` maps to
  a page; the matching `[data-page]` section and `[data-route]` tab activate and
  `onChange(pageKey)` fires. Deep-linkable, back/forward friendly, no reloads.
- **State — centralized store** (`js/store.js`). One plan object with deep-merge
  hydration and a `subscribe`/`notify` hook. Inputs write to the store; pages
  read from it.
- **Persistence — adapter behind one interface** (`js/persist.js`):
  `load() / save() / saveNow() / clear()`. Today a localStorage adapter with a
  versioned envelope (`{ version, savedAt, plan }`) and migration from the old
  onboarding-only key. A `CloudAdapter` (Supabase) will implement the same
  interface for Phase 6.
- **Charts render lazily per page** so canvases are always visible when drawn.

---

## Phases

### Phase 0 — Foundation refactor ✅ (shipped)
Centralized store, persistence adapter (localStorage, versioned, migrating the
old key), and a hash router. No change to how the app looks; the whole plan now
survives reloads and the URL hash works.

### Phase 1 — Multi-page split + tabs ✅ (shipped)
Top tab bar with pages:
- **Overview** — KPI cards, Net Worth Projection, Annual Cash Flow
- **Taxes** — Tax Breakdown donut + rows, tax summary stats
- **Retirement** — Portfolio by Bucket, Roth Conversion Optimizer, Year-by-Year
- **Monte Carlo** — 500-run simulation with P10–P90 bands
- **Student Loans** — payoff summary (light; deep strategies deferred)

The input sidebar is shared across every tab.

### Phase 2 — Onboarding wizard ✅ (shipped)
Six-step, skippable flow (welcome → age → location → income/filing → savings
snapshot → reveal) with a progress bar, replacing the single modal. Each input
step can be skipped; values flow into the shared store and persist. Hosting:
GitHub Pages via "Deploy from a branch" (Settings → Pages) serves the static
site at https://bevjsn.github.io/finance/ — no build step, no login to view.

### Phase 3 — Generic retirement depth ✅ (shipped)
- Full-lifecycle projection: accumulate to retirement, then draw down to a
  plan-to age, with a "money lasts to / depletes at" readiness summary
- Tax-efficient withdrawal sequencing (cash → taxable → tax-deferred → Roth)
- Required minimum distributions starting at age 73 (Uniform Lifetime Table)
- Social Security claiming comparison (62 / 67 / 70) with monthly + lifetime
- Lifetime retirement-tax total; drawdown chart with retirement/RMD markers
- New "Retirement Plan" sidebar inputs (spending, plan-to age, SS, inflation)

  *Approximations: capital-gains tax modeled as a flat effective drag; Social
  Security taxed at 85%; figures for planning, not filing.*

### Phase 4 — Scenarios & success score ✅ (shipped)
- **Chance of success** headline on the Overview: runs 400 full-lifecycle market
  simulations and reports the % in which the plan never runs out of money. Makes
  sequence-of-returns risk visible (and clarifies why the steady-return drawdown
  view looks rosier).
- **Scenarios tab**: name and save the current plan, see saved scenarios with
  key stats, load or delete them, and compare any two side by side (net worth,
  success %, money-lasts, taxes, take-home). Stored locally per browser.
- All five **federal filing statuses** now supported (Single, MFJ, MFS, Head of
  Household, Qualifying Surviving Spouse) across the tax engine and UI.

### Phase 5 — Cloud accounts (login) ✅ (shipped)
Optional Supabase-backed login + cross-device sync, layered on the local-first
store (`js/cloud.js`):
- Passwordless **magic-link** email sign-in.
- **Local-first mirror**: the browser stays the source of truth (fast, offline),
  and plan + scenarios sync to one row per user in the background.
- Account modal in the nav: configure Supabase (URL + anon key, stored locally),
  sign in / out, status.
- **Degrades gracefully**: if unconfigured or the SDK is blocked, the app is
  fully usable local-only — nothing breaks.
- One-time setup (free Supabase project + one SQL snippet) documented in
  `CLOUD_SETUP.md`.

### Phase 6 — Physician-specific modules
Student loan strategy (PSLF vs. refinance vs. IDR, forgiveness timeline),
training-years income modeling, advanced tax-advantaged stacking
(mega-backdoor Roth, governmental vs. non-gov 457b), W-2 vs. 1099,
own-occupation disability insurance, geographic arbitrage comparisons.

### Later / optional
Account aggregation (Plaid), Medicare/IRMAA & long-term-care costs, expense &
goal modeling, estate basics, assumptions page.

---

## File map
| File | Role |
|------|------|
| `index.html` | Shell, sidebar inputs, tab bar, per-page `<section>`s |
| `css/style.css` | Dark theme, layout, tabs, responsive + print |
| `js/taxes.js` | 2025 tax engine (federal, FICA, states, local, itemized) |
| `js/calc.js` | Projection, employer match, Monte Carlo, Roth plan, limits |
| `js/charts.js` | Chart.js v4 wrappers + retirement-marker plugin |
| `js/store.js` | Centralized plan state + hydrate/serialize/subscribe |
| `js/persist.js` | Storage adapter (localStorage now; Supabase-ready) |
| `js/router.js` | Hash router (tabs + page sections) |
| `js/app.js` | Controller: sidebar build, inputs↔store, per-page render |
