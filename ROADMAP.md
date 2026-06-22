# WealthMD — Product Roadmap

A phased plan for evolving WealthMD from a single-page calculator into a
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
a GitHub Pages workflow publishes the static site for browser testing.

### Phase 3 — Generic retirement depth *(prioritized over physician modules)*
- Decumulation / spend-down phase modeling
- Tax-efficient withdrawal sequencing (taxable → tax-deferred → Roth)
- Social Security claiming optimizer (62 / 67 / 70)
- RMD modeling at 73; lifetime tax map

### Phase 4 — Scenarios & success score
Named plans (save / duplicate / compare two side by side) and a headline
"probability of success %" derived from the Monte Carlo engine.

### Phase 5 — Cloud accounts (login) *(committed)*
Supabase adapter behind the Phase 0 persist interface + auth → cross-device
sync and cloud-stored scenarios. Cheap because of the adapter design.

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
