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

### Phase 6A — Correctness foundation ✅ (shipped)
From the consulting review, before any new features:
- **One engine everywhere.** `project()` is now a full-lifecycle projection
  (contributions and employer match stop at retirement; drawdown, RMDs, and
  Social Security follow), and the Monte Carlo runs the *same* yearly logic
  with random returns — so the success %, the bands, and the deterministic
  charts can no longer contradict each other. The steady-return case is drawn
  as a dashed line inside the probability band.
- **Single horizon.** The "years to project" slider is gone; every view runs
  from current age to the plan-to age.
- **Test suite** (`test/run.js`, `node test/run.js`): 64 golden-number
  regression tests for federal/FICA/state/local taxes, deductions, match,
  limits, SSA factors, RMDs, the lifecycle projection, the stochastic engine,
  and persistence. It already caught a scenario-ID collision bug.
- **Disclaimer footer** on every page (and in the PDF): educational estimates
  only, not financial/tax/investment/legal advice.

### Phase 6B — Compare Job Offers ✅ (shipped)
The flagship feature for residents signing their first attending contract:
- Up to 3 offers side by side, each with salary, signing bonus, state + city,
  employer match, 457(b) availability, and employer type (501(c)(3)/government
  vs private).
- True after-tax comparison using the full tax engine and the user's filing
  status, deductions, and contribution amounts: federal / FICA / state / local
  taxes, take-home, match dollars, **real annual value** (take-home + match,
  winner starred), year-1 value with after-tax bonus.
- Surfaces what salary comparisons hide: unused 457(b) space (≈ annual tax
  deferred at the offer's combined marginal rate) and PSLF eligibility flagged
  against the user's actual loans.
- Offers live in the plan → persist locally, sync via cloud, and are captured
  in saved scenarios. 11 engine tests (75 total).

### Phase 6C — Student loan strategy ✅ (shipped)
The Student Loans tab now compares the four realistic paths for a physician's
federal loans, with a net-cost chart, side-by-side table, and verdict:
- **Keep current payment** (baseline; flags payments that never retire the loan)
- **Refinance** (rate + 5/7/10/15-yr term controls; closed-form amortization)
- **PSLF** — income-driven payment (10% of discretionary income at current
  income) until 120 total qualifying payments; residency months already made
  are credited via a control, remainder forgiven tax-free; detects when the
  payment retires the loan before forgiveness matters
- **IDR to 20-yr forgiveness** — negative amortization supported; forgiven
  balance taxed at the combined marginal rate
Verdict ties into the Job Offers tab (names a PSLF-qualifying offer if one is
saved). 13 engine tests (87 total). Simplifications documented on-page.

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
