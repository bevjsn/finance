/* WealthMD — App controller (app.js)
 * Builds the sidebar, syncs inputs <-> Store, persists the plan, and renders
 * the active routed page. Heavy charts render lazily per page (so canvases are
 * always visible when drawn).
 */
(function (global) {
  'use strict';

  const state = Store.state;          // live reference; hydrate() mutates in place
  const $ = function (id) { return document.getElementById(id); };
  const num = function (v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const fmtMoney = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  const fmtPct = function (v) { return (v * 100).toFixed(1) + '%'; };

  let activePage = 'overview';

  /* ------------------------------------------------------------------ */
  /* Sidebar construction                                                */
  /* ------------------------------------------------------------------ */
  function buildStateOptions() {
    const sel = $('input-state');
    const codes = Object.keys(Taxes.STATES).sort(function (a, b) {
      return Taxes.STATES[a].name.localeCompare(Taxes.STATES[b].name);
    });
    sel.innerHTML = codes.map(function (c) {
      return '<option value="' + c + '">' + Taxes.STATES[c].name + '</option>';
    }).join('');
  }

  function cityOptionsHtml(stateCode, selected) {
    const cities = (Taxes.CITY_TAXES[stateCode] || []).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    let html = '<option value="">No local tax</option>';
    html += cities.map(function (c) {
      return '<option value="' + c.name + '"' + (c.name === selected ? ' selected' : '') +
        '>' + c.name + ' (' + (c.rate * 100).toFixed(2) + '%)</option>';
    }).join('');
    const anyTaxed = cities.some(function (c) { return c.rate > 0; });
    return { html: html, count: cities.length, anyTaxed: anyTaxed };
  }

  function cityHintText(out) {
    if (out.count === 0) return 'No local income tax in this state.';
    if (!out.anyTaxed) return 'No local personal income tax in this state — cities listed at 0% for reference.';
    return out.count + ' local-tax jurisdiction' + (out.count === 1 ? '' : 's') +
      ' — only cities/counties that levy a local income tax are listed.';
  }

  function buildCityOptions() {
    const sel = $('input-city');
    const out = cityOptionsHtml(state.state, state.city);
    sel.innerHTML = out.html;
    sel.value = state.city || '';
    // Only show the city picker for states that actually levy a local income tax.
    const field = $('city-field');
    if (field) field.style.display = out.anyTaxed ? '' : 'none';
    const hint = $('city-hint');
    if (hint) hint.textContent = cityHintText(out);
  }

  function bucketRow(b) {
    const v = state.buckets[b.key];
    return '<div class="bucket-row" data-key="' + b.key + '">' +
      '<label class="bucket-label">' + b.label + '</label>' +
      '<div class="bucket-inputs">' +
      '<div class="bucket-input balance">' +
      '<span class="bucket-input-tag">Balance now</span>' +
      '<div class="input-prefix sm"><span>$</span>' +
      '<input type="number" class="num bucket-balance" data-key="' + b.key + '" value="' + v.balance + '" min="0" step="1000" aria-label="' + b.label + ' current balance"></div>' +
      '</div>' +
      '<div class="bucket-input contrib">' +
      '<span class="bucket-input-tag">Adds / yr</span>' +
      '<div class="input-prefix sm"><span>$</span>' +
      '<input type="number" class="num bucket-contrib" data-key="' + b.key + '" value="' + v.contrib + '" min="0" step="500" aria-label="' + b.label + ' annual contribution"></div>' +
      '</div>' +
      '</div>' +
      '<div class="warn" id="warn-' + b.key + '"></div>' +
      '</div>';
  }

  function buildBuckets() {
    const wrap = $('buckets-rows');
    wrap.innerHTML = Calc.BUCKET_GROUPS.map(function (grp) {
      const rows = Calc.BUCKETS.filter(function (b) { return b.group === grp.id; })
        .map(bucketRow).join('');
      return '<div class="bucket-group">' +
        '<div class="bucket-group-head">' + grp.label +
        '<span class="bucket-group-hint">' + grp.hint + '</span></div>' +
        rows +
        '</div>';
    }).join('');
  }

  /* Push current state values into all sidebar controls (used after load). */
  function syncSidebarFromState() {
    $('input-age').value = state.age;
    $('input-retire').value = state.retirementAge;
    $('input-income').value = state.income;
    $('input-filing').value = state.filing;
    $('input-state').value = state.state;
    buildCityOptions();

    $('ded-standard').classList.toggle('active', state.deductions.mode !== 'itemize');
    $('ded-itemize').classList.toggle('active', state.deductions.mode === 'itemize');
    $('itemize-fields').style.display = state.deductions.mode === 'itemize' ? 'block' : 'none';
    $('ded-mortgage').value = state.deductions.mortgage;
    $('ded-salt').value = state.deductions.salt;
    $('ded-charity').value = state.deductions.charity;
    $('ded-medical').value = state.deductions.medical;

    $('match-toggle').checked = !!state.match.enabled;
    $('match-rate').value = state.match.rateCents;
    $('match-cap').value = state.match.capPct;

    buildBuckets();

    $('loan-toggle').checked = !!state.loans.enabled;
    $('loan-balance').value = state.loans.balance;
    $('loan-rate').value = state.loans.rate;
    $('loan-payment').value = state.loans.payment;

    $('input-return').value = state.projection.returnPct;
    $('input-years').value = state.projection.years;
    $('return-val').textContent = state.projection.returnPct + '%';
    $('years-val').textContent = state.projection.years + ' yrs';

    $('input-ret-spending').value = state.retirement.spending;
    $('input-ret-ss').value = state.retirement.ssAnnual;
    $('input-ret-claim').value = state.retirement.ssClaimAge;
    $('input-ret-planage').value = state.retirement.planToAge;
    $('input-ret-inflation').value = state.retirement.inflation;
    $('ret-planage-val').textContent = state.retirement.planToAge;
    $('ret-inflation-val').textContent = state.retirement.inflation + '%';
  }

  /* ------------------------------------------------------------------ */
  /* Inputs -> state                                                     */
  /* ------------------------------------------------------------------ */
  function readInputs() {
    state.age = num($('input-age').value) || state.age;
    state.retirementAge = num($('input-retire').value) || state.retirementAge;
    state.income = num($('input-income').value);
    state.filing = $('input-filing').value;
    state.state = $('input-state').value;
    state.city = $('input-city').value;

    state.deductions.mode = $('ded-itemize').classList.contains('active') ? 'itemize' : 'standard';
    state.deductions.mortgage = num($('ded-mortgage').value);
    state.deductions.salt = num($('ded-salt').value);
    state.deductions.charity = num($('ded-charity').value);
    state.deductions.medical = num($('ded-medical').value);

    state.match.enabled = $('match-toggle').checked;
    state.match.rateCents = num($('match-rate').value);
    state.match.capPct = num($('match-cap').value);

    document.querySelectorAll('.bucket-balance').forEach(function (el) {
      state.buckets[el.dataset.key].balance = num(el.value);
    });
    document.querySelectorAll('.bucket-contrib').forEach(function (el) {
      state.buckets[el.dataset.key].contrib = num(el.value);
    });

    state.loans.enabled = $('loan-toggle').checked;
    state.loans.balance = num($('loan-balance').value);
    state.loans.rate = num($('loan-rate').value);
    state.loans.payment = num($('loan-payment').value);

    state.projection.returnPct = num($('input-return').value);
    state.projection.years = num($('input-years').value);

    state.retirement.spending = num($('input-ret-spending').value);
    state.retirement.ssAnnual = num($('input-ret-ss').value);
    state.retirement.ssClaimAge = num($('input-ret-claim').value) || 67;
    state.retirement.planToAge = num($('input-ret-planage').value) || 95;
    state.retirement.inflation = num($('input-ret-inflation').value);
  }

  /* ------------------------------------------------------------------ */
  /* Compute (shared derived data)                                       */
  /* ------------------------------------------------------------------ */
  function compute() {
    const proj = Calc.project(state);
    const tax = proj.tax;
    const match = proj.match;
    const savingsRate = state.income > 0 ? (proj.totalContrib + match) / state.income : 0;
    const flow = {
      taxes: tax.total,
      savings: proj.totalContrib,
      match: match,
      loan: state.loans.enabled ? state.loans.payment : 0,
      spending: proj.annualSpending
    };
    const retIndex = Math.max(-1, Math.min(state.projection.years, state.retirementAge - state.age));
    return { proj: proj, tax: tax, match: match, savingsRate: savingsRate, flow: flow, retIndex: retIndex };
  }

  /* ------------------------------------------------------------------ */
  /* Renderers                                                           */
  /* ------------------------------------------------------------------ */
  function renderSidebarDerived(d) {
    $('match-estimate').textContent = fmtMoney(d.match) + ' / yr';
    const warns = Calc.limitWarnings(state);
    Calc.BUCKETS.forEach(function (b) {
      const el = $('warn-' + b.key);
      if (!el) return;
      if (warns[b.key]) {
        const limit = b.limitKey ? Calc.LIMITS[b.limitKey] : 0;
        el.textContent = '⚠ exceeds ' + fmtMoney(limit) + ' limit';
        el.style.display = 'block';
      } else {
        el.textContent = '';
        el.style.display = 'none';
      }
    });
  }

  function renderOverview(d) {
    $('kpi-takehome').textContent = fmtMoney(d.tax.takeHome);
    $('kpi-takehome-sub').textContent = fmtMoney(d.tax.takeHome / 12) + ' / mo';
    $('kpi-taxrate').textContent = fmtPct(d.tax.effectiveRate);
    $('kpi-taxrate-sub').textContent = 'Marginal ' + fmtPct(d.tax.marginalFederal) + ' fed';
    $('kpi-savings').textContent = fmtPct(d.savingsRate);
    $('kpi-savings-sub').textContent = fmtMoney(d.proj.totalContrib + d.match) + ' / yr';
    $('kpi-networth').textContent = fmtMoney(d.proj.finalNetWorth);
    $('kpi-networth-sub').textContent = 'at age ' + (state.age + state.projection.years);

    Charts.netWorth('chart-networth', d.proj, d.retIndex);
    Charts.cashFlow('chart-cashflow', d.flow);
    renderSuccess();
  }

  let successTimer = null;
  function renderSuccess() {
    const endAge = Math.max(state.retirementAge + 1, Math.min(100, Math.round(state.retirement.planToAge)));
    $('success-age').textContent = endAge;
    $('success-note').textContent = 'Running 400 market simulations…';
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(function () {
      const sc = Calc.successScore(state, 400);
      const pct = Math.round(sc.successRate * 100);
      const tier = pct >= 80 ? 'good' : (pct >= 50 ? 'mid' : 'bad');
      $('success-pct').textContent = pct + '%';
      $('success-pct').className = 'success-pct ' + tier;
      const bar = $('success-bar');
      bar.style.width = pct + '%';
      bar.className = 'success-bar-fill ' + tier;
      $('success-note').textContent = 'Across ' + sc.runs + ' simulated market histories your money survives in ' +
        pct + '% of them (median ending balance ' + fmtMoney(sc.medianEnding) +
        '). This accounts for market ups and downs — the Retirement tab’s drawdown assumes a steady return, so it looks rosier.';
    }, 400);
  }

  function renderTaxes(d) {
    Charts.taxDonut('chart-taxdonut', d.tax);

    const rows = [
      { label: 'Federal', val: d.tax.federal, color: '#ef4444' },
      { label: 'FICA', val: d.tax.fica, color: '#fb7185' },
      { label: 'State', val: d.tax.state, color: '#f59e0b' },
      { label: 'Local', val: d.tax.local, color: '#f97316' }
    ];
    const max = Math.max.apply(null, rows.map(function (r) { return r.val; }).concat([1]));
    $('tax-rows').innerHTML = rows.map(function (r) {
      const pct = max > 0 ? (r.val / max * 100) : 0;
      return '<div class="tax-row">' +
        '<div class="tax-row-top"><span>' + r.label + '</span><span>' + fmtMoney(r.val) + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + r.color + '"></div></div>' +
        '</div>';
    }).join('');

    const stats = [
      { label: 'Gross income', val: fmtMoney(d.tax.gross) },
      { label: 'Adjusted gross income', val: fmtMoney(d.tax.agi) },
      { label: 'Deduction (' + d.tax.deduction.used + ')', val: fmtMoney(d.tax.deduction.amount) },
      { label: 'Taxable income', val: fmtMoney(d.tax.taxable) },
      { label: 'Total tax', val: fmtMoney(d.tax.total) },
      { label: 'Take-home', val: fmtMoney(d.tax.takeHome) }
    ];
    $('tax-summary').innerHTML = statCards(stats);
  }

  function renderRetirement(d) {
    // --- Phase 3: full lifecycle readiness, drawdown, Social Security ---
    const rp = Calc.retirementProjection(state);
    const lastsVal = rp.lastsToPlan
      ? 'Lasts to ' + rp.endAge + '+'
      : 'Depletes at ' + rp.depleteAge;
    $('ret-readiness').innerHTML = statCards([
      { label: 'Money', val: lastsVal, cls: rp.lastsToPlan ? 'good' : 'bad' },
      { label: 'Assets at retirement (age ' + rp.retAge + ')', val: fmtMoney(rp.retirementAssets) },
      { label: 'Est. balance at age ' + rp.endAge, val: fmtMoney(rp.endingAssets) },
      { label: 'First-year spending need', val: fmtMoney(rp.firstYearSpending) },
      { label: 'Social Security / yr', val: fmtMoney(rp.ssAnnualAtClaim) },
      { label: 'Lifetime taxes in retirement', val: fmtMoney(rp.lifetimeTax) }
    ]);
    Charts.drawdown('chart-drawdown', rp);

    const ss = Calc.socialSecurity(state);
    $('ss-compare').innerHTML = ss.map(function (o) {
      return '<div class="ss-card' + (o.selected ? ' selected' : '') + '">' +
        '<div class="ss-claim">Claim at ' + o.claimAge + (o.selected ? ' <span class="ss-tag">current</span>' : '') + '</div>' +
        '<div class="ss-monthly">' + fmtMoney(o.monthly) + '<span>/mo</span></div>' +
        '<div class="ss-detail">' + (o.factor * 100).toFixed(0) + '% of full benefit</div>' +
        '<div class="ss-detail">Lifetime: <strong>' + fmtMoney(o.lifetime) + '</strong></div>' +
        '</div>';
    }).join('');

    Charts.portfolio('chart-portfolio', d.proj);

    const plan = Calc.rothPlan(state);
    $('roth-current').textContent = fmtPct(plan.currentMarginal);
    $('roth-retire').textContent = fmtPct(plan.retirementMarginal);
    $('roth-window').textContent = 'Age ' + plan.windowStart + ' – ' + plan.windowEnd + ' (' + plan.windowYears + ' yrs)';
    $('roth-annual').textContent = fmtMoney(plan.annualConversion);
    $('roth-total').textContent = fmtMoney(plan.totalConvertible);
    $('roth-taxcost').textContent = fmtMoney(plan.estTaxCost);
    const verdict = $('roth-verdict');
    if (plan.windowYears <= 0) {
      verdict.textContent = 'No conversion window — retirement age is at or past RMD age (73).';
      verdict.className = 'roth-verdict neutral';
    } else if (plan.currentMarginal > plan.retirementMarginal) {
      verdict.textContent = 'Your current marginal rate (' + fmtPct(plan.currentMarginal) + ') is higher than your estimated retirement rate. Convert during low-income years between retirement and age 73 to fill the 22% bracket.';
      verdict.className = 'roth-verdict good';
    } else {
      verdict.textContent = 'Conversions look marginal — your retirement rate is similar to today. Revisit if income drops in early retirement.';
      verdict.className = 'roth-verdict neutral';
    }

    $('table-body').innerHTML = d.proj.rows.map(function (r) {
      const highlight = (r.age === state.retirementAge) ? ' class="ret-row"' : '';
      return '<tr' + highlight + '>' +
        '<td>' + r.calendarYear + ' · ' + r.age + '</td>' +
        '<td>' + fmtMoney(r.netWorth) + '</td>' +
        '<td>' + fmtMoney(r.totalAssets) + '</td>' +
        '<td>' + fmtMoney(r.loanBalance) + '</td>' +
        '<td>' + fmtMoney(r.employerMatch) + '</td>' +
        '<td>' + fmtMoney(r.totalSaved) + '</td>' +
        '<td>' + fmtMoney(r.spending) + '</td>' +
        '</tr>';
    }).join('');
  }

  let mcTimer = null;
  function renderMonteCarlo(d) {
    const meanEl = $('mc-mean');
    if (meanEl) meanEl.textContent = state.projection.returnPct + '%';
    if (mcTimer) clearTimeout(mcTimer);
    mcTimer = setTimeout(function () {
      const mc = Calc.monteCarlo(state, 500);
      const ages = d.proj.rows.map(function (r) { return r.age; });
      Charts.monteCarlo('chart-montecarlo', mc, ages, d.retIndex);
      $('mc-p10').textContent = fmtMoney(mc.finalP10);
      $('mc-p50').textContent = fmtMoney(mc.finalP50);
      $('mc-p90').textContent = fmtMoney(mc.finalP90);
    }, 300);
  }

  function renderLoans(d) {
    const wrap = $('loan-summary');
    if (!state.loans.enabled || state.loans.balance <= 0) {
      wrap.innerHTML = '<div class="empty-note">No student loans on file — you\'re debt-free here 🎉</div>';
      return;
    }
    const s = loanSummary();
    const payoff = s.neverPaysOff
      ? '<span class="bad">Never (payment ≤ interest)</span>'
      : (s.payoffYears + ' yrs · age ' + s.payoffAge);
    const stats = [
      { label: 'Current balance', val: fmtMoney(state.loans.balance) },
      { label: 'Interest rate', val: state.loans.rate + '%' },
      { label: 'Annual payment', val: fmtMoney(state.loans.payment) },
      { label: 'Time to payoff', val: payoff },
      { label: 'Total interest paid', val: fmtMoney(s.totalInterest) },
      { label: 'Total paid', val: fmtMoney(s.totalPaid) }
    ];
    wrap.innerHTML = statCards(stats);
  }

  function statCards(stats) {
    return stats.map(function (s) {
      const cls = s.cls ? ' ' + s.cls : '';
      return '<div class="stat-card"><span class="stat-label">' + s.label +
        '</span><span class="stat-val' + cls + '">' + s.val + '</span></div>';
    }).join('');
  }

  function loanSummary() {
    let bal = Math.max(0, state.loans.balance);
    const rate = (state.loans.rate || 0) / 100;
    const pmt = Math.max(0, state.loans.payment);
    let totalInterest = 0, totalPaid = 0, years = 0;
    let neverPaysOff = false;
    for (let y = 1; y <= 80; y++) {
      const interest = bal * rate;
      if (pmt <= interest) { neverPaysOff = true; break; }
      const pay = Math.min(pmt, bal + interest);
      bal = Math.max(0, bal - (pay - interest));
      totalInterest += interest;
      totalPaid += pay;
      years = y;
      if (bal <= 0) break;
    }
    return {
      neverPaysOff: neverPaysOff,
      payoffYears: years,
      payoffAge: state.age + years,
      totalInterest: totalInterest,
      totalPaid: totalPaid
    };
  }

  /* ---- Scenarios (Phase 4) -------------------------------------------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function deepAssign(target, src) {
    if (!src || typeof src !== 'object') return target;
    Object.keys(src).forEach(function (k) {
      const sv = src[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) && target[k] && typeof target[k] === 'object') {
        deepAssign(target[k], sv);
      } else if (sv !== undefined) {
        target[k] = sv;
      }
    });
    return target;
  }
  function fillDefaults(plan) { return deepAssign(Store.getDefault(), plan); }

  function planMetrics(plan, withSuccess) {
    const full = fillDefaults(plan);
    const proj = Calc.project(full);
    const rp = Calc.retirementProjection(full);
    const m = {
      networth: proj.finalNetWorth,
      effRate: proj.tax.effectiveRate,
      takeHome: proj.tax.takeHome,
      lasts: rp.lastsToPlan, depleteAge: rp.depleteAge, endAge: rp.endAge,
      retAssets: rp.retirementAssets, lifetimeTax: rp.lifetimeTax
    };
    if (withSuccess) m.success = Calc.successScore(full, 250).successRate;
    return m;
  }

  function populateCompareSelects(list) {
    const opts = '<option value="current">Current plan</option>' +
      list.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
    ['compare-a', 'compare-b'].forEach(function (id) {
      const sel = $(id); const prev = sel.value; sel.innerHTML = opts;
      if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) sel.value = prev;
    });
    if (!$('compare-a').value) $('compare-a').value = 'current';
    if (!$('compare-b').value) $('compare-b').value = list.length ? list[0].id : 'current';
  }

  function renderScenariosList() {
    const list = Persist.listScenarios();
    const el = $('scenario-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-note">No saved scenarios yet — name one above and hit Save.</div>';
    } else {
      el.innerHTML = list.map(function (s) {
        const m = planMetrics(s.plan, false);
        const lasts = m.lasts ? ('lasts to ' + m.endAge) : ('depletes at ' + m.depleteAge);
        return '<div class="scenario-item">' +
          '<div class="scenario-meta"><div class="scenario-name">' + esc(s.name) + '</div>' +
          '<div class="scenario-stats">Net worth ' + fmtMoney(m.networth) + ' · ' + lasts + ' · ' + fmtPct(m.effRate) + ' eff. tax</div></div>' +
          '<div class="scenario-actions">' +
          '<button class="btn-ghost sc-load" data-id="' + s.id + '">Load</button>' +
          '<button class="btn-ghost sc-del" data-id="' + s.id + '">Delete</button>' +
          '</div></div>';
      }).join('');
    }
    populateCompareSelects(list);
  }

  function renderCompare() {
    const list = Persist.listScenarios();
    function planFor(v) {
      if (v === 'current') return Store.toPlan();
      const s = list.find(function (x) { return x.id === v; });
      return s ? s.plan : null;
    }
    const aPlan = planFor($('compare-a').value);
    const bPlan = planFor($('compare-b').value);
    const out = $('compare-table');
    if (!aPlan || !bPlan) { out.innerHTML = '<div class="empty-note">Save a scenario to compare against your current plan.</div>'; return; }
    out.innerHTML = '<div class="empty-note">Crunching simulations…</div>';
    // defer so the "crunching" note paints before the heavy work
    setTimeout(function () {
      const A = planMetrics(aPlan, true), B = planMetrics(bPlan, true);
      const nameA = $('compare-a').selectedOptions[0].text, nameB = $('compare-b').selectedOptions[0].text;
      const rows = [
        ['Projected net worth', fmtMoney(A.networth), fmtMoney(B.networth)],
        ['Chance of success', fmtPct(A.success), fmtPct(B.success)],
        ['Money', A.lasts ? ('lasts to ' + A.endAge) : ('depletes ' + A.depleteAge), B.lasts ? ('lasts to ' + B.endAge) : ('depletes ' + B.depleteAge)],
        ['Assets at retirement', fmtMoney(A.retAssets), fmtMoney(B.retAssets)],
        ['Effective tax rate', fmtPct(A.effRate), fmtPct(B.effRate)],
        ['Annual take-home', fmtMoney(A.takeHome), fmtMoney(B.takeHome)],
        ['Lifetime retirement tax', fmtMoney(A.lifetimeTax), fmtMoney(B.lifetimeTax)]
      ];
      out.innerHTML = '<table class="compare-tbl"><thead><tr><th></th><th>' + esc(nameA) + '</th><th>' + esc(nameB) +
        '</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
        '</tbody></table>';
    }, 20);
  }

  function loadScenario(plan) {
    Store.hydrate(plan);
    syncSidebarFromState();
    Persist.save(Store.toPlan());
    renderActive();
  }

  const pages = {
    overview: renderOverview,
    taxes: renderTaxes,
    retirement: renderRetirement,
    montecarlo: renderMonteCarlo,
    loans: renderLoans,
    scenarios: renderScenariosList
  };

  /* Read inputs, persist, render sidebar bits + the active page only. */
  function renderActive(pageKey) {
    if (pageKey) activePage = pageKey;
    readInputs();
    Persist.save(Store.toPlan());
    const d = compute();
    renderSidebarDerived(d);
    (pages[activePage] || pages.overview)(d);
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */
  function wire() {
    document.querySelectorAll('#sidebar input, #sidebar select').forEach(function (el) {
      el.addEventListener('input', function () {
        if (el.id === 'input-state') { buildCityOptions(); }
        renderActive();
      });
      el.addEventListener('change', function () { renderActive(); });
    });

    $('ded-standard').addEventListener('click', function () { setDeduction('standard'); });
    $('ded-itemize').addEventListener('click', function () { setDeduction('itemize'); });

    document.querySelectorAll('.collapsible-header').forEach(function (h) {
      h.addEventListener('click', function () { h.closest('.card').classList.toggle('collapsed'); });
    });

    $('input-return').addEventListener('input', function () { $('return-val').textContent = this.value + '%'; });
    $('input-years').addEventListener('input', function () { $('years-val').textContent = this.value + ' yrs'; });
    $('input-ret-planage').addEventListener('input', function () { $('ret-planage-val').textContent = this.value; });
    $('input-ret-inflation').addEventListener('input', function () { $('ret-inflation-val').textContent = this.value + '%'; });

    $('btn-pdf').addEventListener('click', function () { window.print(); });

    $('nav-toggle').addEventListener('click', function () {
      document.body.classList.toggle('sidebar-open');
    });
    // tapping a tab on mobile closes the input drawer
    document.querySelectorAll('[data-route]').forEach(function (tab) {
      tab.addEventListener('click', function () { document.body.classList.remove('sidebar-open'); });
    });

    // scenarios
    $('scenario-save-btn').addEventListener('click', function () {
      const name = $('scenario-name').value.trim() || ('Plan ' + new Date().toLocaleDateString());
      Persist.saveScenario(name, Store.toPlan());
      $('scenario-name').value = '';
      renderScenariosList();
      renderCompare();
    });
    $('compare-a').addEventListener('change', renderCompare);
    $('compare-b').addEventListener('change', renderCompare);
    $('scenario-list').addEventListener('click', function (e) {
      const load = e.target.closest('.sc-load');
      const del = e.target.closest('.sc-del');
      if (load) {
        const s = Persist.listScenarios().find(function (x) { return x.id === load.dataset.id; });
        if (s) loadScenario(s.plan);
      } else if (del) {
        Persist.deleteScenario(del.dataset.id);
        renderScenariosList();
        renderCompare();
      }
    });

    wireWizard();
    wireAccount();
  }

  /* ------------------------------------------------------------------ */
  /* Onboarding wizard                                                   */
  /* ------------------------------------------------------------------ */
  const WIZ_STEPS = 8;
  const WIZ_SKIPPABLE = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true };
  let wizStep = 0;

  function buildWizardOptions() {
    const sel = $('wiz-state');
    const codes = Object.keys(Taxes.STATES).sort(function (a, b) {
      return Taxes.STATES[a].name.localeCompare(Taxes.STATES[b].name);
    });
    sel.innerHTML = codes.map(function (c) {
      return '<option value="' + c + '">' + Taxes.STATES[c].name + '</option>';
    }).join('');
    sel.value = state.state;
    buildWizardCities();
  }

  function buildWizardCities() {
    const sel = $('wiz-city');
    const out = cityOptionsHtml($('wiz-state').value, state.city);
    sel.innerHTML = out.html;
    const field = $('wiz-city-field');
    if (field) field.style.display = out.anyTaxed ? '' : 'none';
    const hint = $('wiz-city-hint');
    if (hint) hint.textContent = cityHintText(out);
  }

  function buildWizardBuckets() {
    const wrap = $('wiz-buckets');
    wrap.innerHTML = Calc.BUCKET_GROUPS.map(function (grp) {
      const rows = Calc.BUCKETS.filter(function (b) { return b.group === grp.id; }).map(function (b) {
        const v = state.buckets[b.key];
        return '<div class="wiz-bucket-row">' +
          '<label>' + b.label + '</label>' +
          '<div class="wiz-bucket-fields">' +
          '<div class="input-prefix sm"><span>$</span><input type="number" id="wiz-bk-' + b.key + '-bal" value="' + v.balance + '" min="0" step="1000" aria-label="' + b.label + ' balance"></div>' +
          '<div class="input-prefix sm"><span>$</span><input type="number" id="wiz-bk-' + b.key + '-con" value="' + v.contrib + '" min="0" step="500" aria-label="' + b.label + ' annual"></div>' +
          '</div>' +
          '</div>';
      }).join('');
      return '<div class="wiz-bucket-group">' +
        '<div class="wiz-bucket-grouphead">' + grp.label +
        '<span class="wiz-bucket-cols">balance · annual</span></div>' + rows + '</div>';
    }).join('');
  }

  function prefillWizard() {
    $('wiz-age').value = state.age;
    $('wiz-retire').value = state.retirementAge;
    $('wiz-income').value = state.income;
    $('wiz-filing').value = state.filing;
    $('wiz-match-toggle').checked = !!state.match.enabled;
    $('wiz-match-rate').value = state.match.rateCents;
    $('wiz-match-cap').value = state.match.capPct;
    $('wiz-loan-toggle').checked = !!state.loans.enabled;
    $('wiz-loan-balance').value = state.loans.balance;
    $('wiz-loan-rate').value = state.loans.rate;
    $('wiz-loan-payment').value = state.loans.payment;
    buildWizardOptions();
    buildWizardBuckets();
  }

  function showWizStep(i) {
    wizStep = Math.max(0, Math.min(WIZ_STEPS - 1, i));
    document.querySelectorAll('.wizard-step').forEach(function (s) {
      s.classList.toggle('active', Number(s.getAttribute('data-step')) === wizStep);
    });
    $('wiz-progress').style.width = Math.round((wizStep + 1) / WIZ_STEPS * 100) + '%';
    $('wiz-step-count').textContent = 'Step ' + (wizStep + 1) + ' of ' + WIZ_STEPS;
    $('wiz-back').style.visibility = wizStep === 0 ? 'hidden' : 'visible';
    $('wiz-skip').style.visibility = WIZ_SKIPPABLE[wizStep] ? 'visible' : 'hidden';
    $('wiz-next').textContent = wizStep === WIZ_STEPS - 1 ? 'Build My Plan →' : 'Next →';
    if (wizStep === WIZ_STEPS - 1) renderWizSummary();
  }

  function readWizStep(i) {
    if (i === 1) {
      state.age = num($('wiz-age').value) || state.age;
      state.retirementAge = num($('wiz-retire').value) || state.retirementAge;
    } else if (i === 2) {
      state.state = $('wiz-state').value;
      state.city = $('wiz-city').value;
    } else if (i === 3) {
      state.income = num($('wiz-income').value);
      state.filing = $('wiz-filing').value;
    } else if (i === 4) {
      state.match.enabled = $('wiz-match-toggle').checked;
      state.match.rateCents = num($('wiz-match-rate').value);
      state.match.capPct = num($('wiz-match-cap').value);
    } else if (i === 5) {
      Calc.BUCKETS.forEach(function (b) {
        const bal = $('wiz-bk-' + b.key + '-bal');
        const con = $('wiz-bk-' + b.key + '-con');
        if (bal) state.buckets[b.key].balance = num(bal.value);
        if (con) state.buckets[b.key].contrib = num(con.value);
      });
    } else if (i === 6) {
      state.loans.enabled = $('wiz-loan-toggle').checked;
      state.loans.balance = num($('wiz-loan-balance').value);
      state.loans.rate = num($('wiz-loan-rate').value);
      state.loans.payment = num($('wiz-loan-payment').value);
    }
  }

  function renderWizSummary() {
    const cityTxt = state.city ? ' · ' + state.city : '';
    const totalBal = Calc.totalBalance(state);
    const totalContrib = Calc.totalContributions(state);
    const rows = [
      ['Age', state.age + ' → retire at ' + state.retirementAge],
      ['Location', (Taxes.STATES[state.state] ? Taxes.STATES[state.state].name : state.state) + cityTxt],
      ['Income', fmtMoney(state.income) + ' · ' + (Taxes.FILING_SHORT[state.filing] || 'Single')],
      ['Employer match', state.match.enabled ? (state.match.rateCents + '¢/$ up to ' + state.match.capPct + '%') : 'None'],
      ['Total balances', fmtMoney(totalBal)],
      ['Saved per year', fmtMoney(totalContrib)],
      ['Student loans', state.loans.enabled && state.loans.balance > 0 ? fmtMoney(state.loans.balance) + ' @ ' + state.loans.rate + '%' : 'None']
    ];
    $('wiz-summary').innerHTML = rows.map(function (r) {
      return '<div class="wiz-summary-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>';
    }).join('');
  }

  function finishWizard() {
    state.onboarded = true;
    syncSidebarFromState();
    Persist.saveNow(Store.toPlan());
    $('onboard-modal').classList.add('hidden');
    renderActive();
  }

  function wireWizard() {
    $('wiz-state').addEventListener('change', buildWizardCities);
    $('wiz-next').addEventListener('click', function () {
      readWizStep(wizStep);
      if (wizStep === WIZ_STEPS - 1) finishWizard();
      else showWizStep(wizStep + 1);
    });
    $('wiz-back').addEventListener('click', function () { showWizStep(wizStep - 1); });
    $('wiz-skip').addEventListener('click', function () { showWizStep(wizStep + 1); });
  }

  /* ---- Account / cloud sync UI (Phase 5) ------------------------------ */
  function updateAccountUI(st) {
    const btn = $('account-btn');
    if (st.signedIn) btn.textContent = '👤 ' + (st.email || 'Account').split('@')[0];
    else if (st.configured) btn.textContent = 'Sign in';
    else btn.textContent = '☁ Set up sync';
    $('account-config').style.display = st.configured ? 'none' : 'block';
    $('account-signin').style.display = (st.configured && !st.signedIn) ? 'block' : 'none';
    $('account-signedin').style.display = st.signedIn ? 'block' : 'none';
    $('account-sdk-warn').style.display = st.sdk ? 'none' : 'block';
    if (st.signedIn) $('account-email').textContent = st.email || '';
  }

  function wireAccount() {
    $('account-btn').addEventListener('click', function () { $('account-modal').classList.remove('hidden'); });
    $('account-close').addEventListener('click', function () { $('account-modal').classList.add('hidden'); });
    $('account-config-save').addEventListener('click', function () {
      if (!global.Cloud) return;
      const url = $('supabase-url').value.trim();
      const key = $('supabase-key').value.trim();
      if (!url || !key) return;
      global.Cloud.setConfig(url, key);
      location.reload();
    });
    $('account-signin-btn').addEventListener('click', function () {
      if (!global.Cloud) return;
      const email = $('account-email-input').value.trim();
      const msg = $('account-msg');
      if (!email) { msg.textContent = 'Enter your email.'; return; }
      msg.textContent = 'Sending…';
      global.Cloud.signIn(email).then(function () {
        msg.textContent = 'Check your email for the magic link.';
      }).catch(function (e) { msg.textContent = 'Error: ' + (e.message || e); });
    });
    $('account-signout-btn').addEventListener('click', function () {
      if (global.Cloud) global.Cloud.signOut();
    });
  }

  function setDeduction(mode) {
    state.deductions.mode = mode;
    $('ded-standard').classList.toggle('active', mode === 'standard');
    $('ded-itemize').classList.toggle('active', mode === 'itemize');
    $('itemize-fields').style.display = mode === 'itemize' ? 'block' : 'none';
    renderActive();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  function init() {
    buildStateOptions();

    const saved = Persist.load();
    if (saved) Store.hydrate(saved);

    syncSidebarFromState();
    wire();
    prefillWizard();

    if (state.onboarded) {
      $('onboard-modal').classList.add('hidden');
    } else {
      showWizStep(0);
    }

    Router.start({
      '/': 'overview',
      '/taxes': 'taxes',
      '/retirement': 'retirement',
      '/montecarlo': 'montecarlo',
      '/loans': 'loans',
      '/scenarios': 'scenarios'
    }, '/', function (pageKey) {
      activePage = pageKey;
      renderActive(pageKey);
      // heavy compare only computes on entering the tab (not on every keystroke)
      if (pageKey === 'scenarios') renderCompare();
    });

    // optional cloud sync — no-op (local-only) until configured & signed in
    if (global.Cloud) {
      Persist.onWrite = function () { global.Cloud.schedulePush(); };
      global.Cloud.init(updateAccountUI);
    } else {
      updateAccountUI({ sdk: false, configured: false, signedIn: false });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposed for the cloud mirror: re-sync the UI after a remote pull.
  global.AppUI = {
    reload: function () { syncSidebarFromState(); renderActive(); },
    render: renderActive
  };
  global.WealthMD = { state: state, render: renderActive };
})(typeof window !== 'undefined' ? window : this);
