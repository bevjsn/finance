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

  function buildCityOptions() {
    const sel = $('input-city');
    const cities = Taxes.CITY_TAXES[state.state] || [];
    let html = '<option value="">No local tax</option>';
    html += cities.map(function (c) {
      return '<option value="' + c.name + '">' + c.name + ' (' + (c.rate * 100).toFixed(2) + '%)</option>';
    }).join('');
    sel.innerHTML = html;
    sel.disabled = cities.length === 0;
    sel.value = state.city || '';
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

    $('toggle-single').classList.toggle('active', state.filing !== 'married');
    $('toggle-married').classList.toggle('active', state.filing === 'married');

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

    $('onboard-age').value = state.age;
    $('onboard-retire').value = state.retirementAge;
  }

  /* ------------------------------------------------------------------ */
  /* Inputs -> state                                                     */
  /* ------------------------------------------------------------------ */
  function readInputs() {
    state.age = num($('input-age').value) || state.age;
    state.retirementAge = num($('input-retire').value) || state.retirementAge;
    state.income = num($('input-income').value);
    state.filing = $('toggle-married').classList.contains('active') ? 'married' : 'single';
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
      return '<div class="stat-card"><span class="stat-label">' + s.label +
        '</span><span class="stat-val">' + s.val + '</span></div>';
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

  const pages = {
    overview: renderOverview,
    taxes: renderTaxes,
    retirement: renderRetirement,
    montecarlo: renderMonteCarlo,
    loans: renderLoans
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

    $('toggle-single').addEventListener('click', function () { setFiling('single'); });
    $('toggle-married').addEventListener('click', function () { setFiling('married'); });
    $('ded-standard').addEventListener('click', function () { setDeduction('standard'); });
    $('ded-itemize').addEventListener('click', function () { setDeduction('itemize'); });

    document.querySelectorAll('.collapsible-header').forEach(function (h) {
      h.addEventListener('click', function () { h.closest('.card').classList.toggle('collapsed'); });
    });

    $('input-return').addEventListener('input', function () { $('return-val').textContent = this.value + '%'; });
    $('input-years').addEventListener('input', function () { $('years-val').textContent = this.value + ' yrs'; });

    $('btn-pdf').addEventListener('click', function () { window.print(); });

    $('nav-toggle').addEventListener('click', function () {
      document.body.classList.toggle('sidebar-open');
    });
    // tapping a tab on mobile closes the input drawer
    document.querySelectorAll('[data-route]').forEach(function (tab) {
      tab.addEventListener('click', function () { document.body.classList.remove('sidebar-open'); });
    });

    $('onboard-build').addEventListener('click', function () {
      state.age = num($('onboard-age').value) || 32;
      state.retirementAge = num($('onboard-retire').value) || 62;
      state.onboarded = true;
      $('input-age').value = state.age;
      $('input-retire').value = state.retirementAge;
      Persist.saveNow(Store.toPlan());
      $('onboard-modal').classList.add('hidden');
      renderActive();
    });
  }

  function setFiling(f) {
    state.filing = f;
    $('toggle-single').classList.toggle('active', f === 'single');
    $('toggle-married').classList.toggle('active', f === 'married');
    renderActive();
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

    if (state.onboarded) {
      $('onboard-modal').classList.add('hidden');
    }

    Router.start({
      '/': 'overview',
      '/taxes': 'taxes',
      '/retirement': 'retirement',
      '/montecarlo': 'montecarlo',
      '/loans': 'loans'
    }, '/', function (pageKey) {
      activePage = pageKey;
      renderActive(pageKey);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.WealthMD = { state: state, render: renderActive };
})(typeof window !== 'undefined' ? window : this);
