/* WealthMD — App wiring (app.js)
 * Builds the UI from state, reads inputs, and re-renders everything live.
 */
(function (global) {
  'use strict';

  /* ---- Default state --------------------------------------------------- */
  function defaultState() {
    return {
      age: 32,
      retirementAge: 62,
      income: 350000,
      filing: 'single',
      state: 'CA',
      city: '',
      deductions: { mode: 'standard', mortgage: 0, salt: 0, charity: 0, medical: 0 },
      match: { enabled: true, rateCents: 100, capPct: 4 },
      buckets: {
        trad401k: { balance: 0, contrib: 23500 },
        roth401k: { balance: 0, contrib: 0 },
        plan457: { balance: 0, contrib: 0 },
        rothIra: { balance: 0, contrib: 7000 },
        hsa: { balance: 0, contrib: 4300 },
        taxable: { balance: 0, contrib: 12000 },
        cash: { balance: 0, contrib: 6000 }
      },
      loans: { enabled: true, balance: 220000, rate: 6.5, payment: 24000 },
      projection: { returnPct: 7, years: 30 }
    };
  }

  let state = defaultState();
  const $ = function (id) { return document.getElementById(id); };
  const fmtMoney = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  const fmtPct = function (v) { return (v * 100).toFixed(1) + '%'; };

  /* ---- Build sidebar dynamic pieces ------------------------------------ */
  function buildStateOptions() {
    const sel = $('input-state');
    const codes = Object.keys(Taxes.STATES).sort(function (a, b) {
      return Taxes.STATES[a].name.localeCompare(Taxes.STATES[b].name);
    });
    sel.innerHTML = codes.map(function (c) {
      return '<option value="' + c + '"' + (c === state.state ? ' selected' : '') + '>' + Taxes.STATES[c].name + '</option>';
    }).join('');
  }

  function buildCityOptions() {
    const sel = $('input-city');
    const cities = Taxes.CITY_TAXES[state.state] || [];
    let html = '<option value="">No local tax</option>';
    html += cities.map(function (c) {
      return '<option value="' + c.name + '"' + (c.name === state.city ? ' selected' : '') +
        '>' + c.name + ' (' + (c.rate * 100).toFixed(2) + '%)</option>';
    }).join('');
    sel.innerHTML = html;
    sel.disabled = cities.length === 0;
  }

  function buildBuckets() {
    const wrap = $('buckets-rows');
    wrap.innerHTML = Calc.BUCKETS.map(function (b) {
      const v = state.buckets[b.key];
      return '<div class="bucket-row" data-key="' + b.key + '">' +
        '<label class="bucket-label">' + b.label + '</label>' +
        '<div class="bucket-inputs">' +
        '<input type="number" class="num bucket-balance" data-key="' + b.key + '" value="' + v.balance + '" min="0" step="1000" aria-label="' + b.label + ' balance">' +
        '<input type="number" class="num bucket-contrib" data-key="' + b.key + '" value="' + v.contrib + '" min="0" step="500" aria-label="' + b.label + ' contribution">' +
        '</div>' +
        '<div class="warn" id="warn-' + b.key + '"></div>' +
        '</div>';
    }).join('');
  }

  /* ---- Read inputs into state ------------------------------------------ */
  function readInputs() {
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

  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /* ---- Render everything ----------------------------------------------- */
  let mcTimer = null;

  function renderAll() {
    readInputs();

    const proj = Calc.project(state);
    const tax = proj.tax;
    const match = proj.match;

    // KPI cards
    $('kpi-takehome').textContent = fmtMoney(tax.takeHome);
    $('kpi-takehome-sub').textContent = fmtMoney(tax.takeHome / 12) + ' / mo';
    $('kpi-taxrate').textContent = fmtPct(tax.effectiveRate);
    $('kpi-taxrate-sub').textContent = 'Marginal ' + fmtPct(tax.marginalFederal) + ' fed';
    const savingsRate = state.income > 0 ? (proj.totalContrib + match) / state.income : 0;
    $('kpi-savings').textContent = fmtPct(savingsRate);
    $('kpi-savings-sub').textContent = fmtMoney(proj.totalContrib + match) + ' / yr';
    $('kpi-networth').textContent = fmtMoney(proj.finalNetWorth);
    $('kpi-networth-sub').textContent = 'at age ' + (state.age + state.projection.years);

    // retirement index within projection
    const retIndex = Math.max(-1, Math.min(state.projection.years, state.retirementAge - state.age));

    // Charts
    Charts.netWorth('chart-networth', proj, retIndex);
    Charts.portfolio('chart-portfolio', proj);
    Charts.taxDonut('chart-taxdonut', tax);

    // tax breakdown rows
    renderTaxRows(tax);

    // cash flow
    const flow = {
      taxes: tax.total,
      savings: proj.totalContrib,
      match: match,
      loan: state.loans.enabled ? state.loans.payment : 0,
      spending: proj.annualSpending
    };
    Charts.cashFlow('chart-cashflow', flow);

    // Roth optimizer
    renderRoth();

    // year-by-year table
    renderTable(proj, retIndex);

    // limit warnings
    renderWarnings();

    // estimated match label
    $('match-estimate').textContent = fmtMoney(match) + ' / yr';

    // Monte Carlo (debounced 300ms)
    if (mcTimer) clearTimeout(mcTimer);
    mcTimer = setTimeout(function () {
      const mc = Calc.monteCarlo(state, 500);
      const ages = proj.rows.map(function (r) { return r.age; });
      Charts.monteCarlo('chart-montecarlo', mc, ages, retIndex);
      $('mc-p10').textContent = fmtMoney(mc.finalP10);
      $('mc-p50').textContent = fmtMoney(mc.finalP50);
      $('mc-p90').textContent = fmtMoney(mc.finalP90);
    }, 300);
  }

  function renderTaxRows(tax) {
    const rows = [
      { label: 'Federal', val: tax.federal, color: '#ef4444' },
      { label: 'FICA', val: tax.fica, color: '#fb7185' },
      { label: 'State', val: tax.state, color: '#f59e0b' },
      { label: 'Local', val: tax.local, color: '#f97316' }
    ];
    const max = Math.max.apply(null, rows.map(function (r) { return r.val; }).concat([1]));
    $('tax-rows').innerHTML = rows.map(function (r) {
      const pct = max > 0 ? (r.val / max * 100) : 0;
      return '<div class="tax-row">' +
        '<div class="tax-row-top"><span>' + r.label + '</span><span>' + fmtMoney(r.val) + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + r.color + '"></div></div>' +
        '</div>';
    }).join('');
  }

  function renderRoth() {
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
  }

  function renderTable(proj, retIndex) {
    const body = $('table-body');
    body.innerHTML = proj.rows.map(function (r) {
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

  function renderWarnings() {
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

  /* ---- Event wiring ---------------------------------------------------- */
  function wire() {
    // text/number/select inputs -> live update
    document.querySelectorAll('#sidebar input, #sidebar select').forEach(function (el) {
      el.addEventListener('input', function () {
        if (el.id === 'input-state') { buildCityOptions(); }
        renderAll();
      });
      el.addEventListener('change', renderAll);
    });

    // filing status toggle
    $('toggle-single').addEventListener('click', function () { setFiling('single'); });
    $('toggle-married').addEventListener('click', function () { setFiling('married'); });

    // deductions toggle
    $('ded-standard').addEventListener('click', function () { setDeduction('standard'); });
    $('ded-itemize').addEventListener('click', function () { setDeduction('itemize'); });

    // collapsible sections
    document.querySelectorAll('.collapsible-header').forEach(function (h) {
      h.addEventListener('click', function () {
        const card = h.closest('.card');
        card.classList.toggle('collapsed');
      });
    });

    // sliders show values
    $('input-return').addEventListener('input', function () { $('return-val').textContent = this.value + '%'; });
    $('input-years').addEventListener('input', function () { $('years-val').textContent = this.value + ' yrs'; });

    // PDF / print
    $('btn-pdf').addEventListener('click', function () { window.print(); });

    // onboarding modal
    $('onboard-build').addEventListener('click', function () {
      state.age = num($('onboard-age').value) || 32;
      state.retirementAge = num($('onboard-retire').value) || 62;
      $('onboard-modal').classList.add('hidden');
      renderAll();
    });
  }

  function setFiling(f) {
    state.filing = f;
    $('toggle-single').classList.toggle('active', f === 'single');
    $('toggle-married').classList.toggle('active', f === 'married');
    renderAll();
  }

  function setDeduction(mode) {
    state.deductions.mode = mode;
    $('ded-standard').classList.toggle('active', mode === 'standard');
    $('ded-itemize').classList.toggle('active', mode === 'itemize');
    $('itemize-fields').style.display = mode === 'itemize' ? 'block' : 'none';
    renderAll();
  }

  /* ---- Init ------------------------------------------------------------ */
  function init() {
    buildStateOptions();
    buildCityOptions();
    buildBuckets();
    wire();
    // sync slider labels
    $('return-val').textContent = state.projection.returnPct + '%';
    $('years-val').textContent = state.projection.years + ' yrs';
    // initial render behind modal so the app looks alive
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.WealthMD = { state: state, render: renderAll };
})(typeof window !== 'undefined' ? window : this);
