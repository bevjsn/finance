/* WealthMD — Financial Engine (calc.js)
 * Projection, Monte Carlo, employer match and Roth-conversion logic.
 * Depends on global `Taxes`.
 */
(function (global) {
  'use strict';

  const LIMITS = {
    k401: 23500,   // 401k/403b employee deferral (Traditional or Roth)
    k457: 23500,   // 457(b)
    ira: 7000,     // Backdoor Roth IRA
    hsa: 4300      // HSA (self-only)
  };

  const CASH_RATE = 0.045; // HYSA rate for cash/emergency bucket
  const RMD_AGE = 73;

  /* The savings buckets in display order. growth: 'market' | 'cash'.
   * taxClass used for pre-tax (AGI-reducing) determination.            */
  const BUCKETS = [
    { key: 'trad401k', label: '401k/403b Traditional', growth: 'market', preTax: true, limitKey: 'k401' },
    { key: 'roth401k', label: '401k/403b Roth', growth: 'market', preTax: false, limitKey: 'k401' },
    { key: 'plan457', label: '457(b)', growth: 'market', preTax: true, limitKey: 'k457' },
    { key: 'rothIra', label: 'Backdoor Roth IRA', growth: 'market', preTax: false, limitKey: 'ira' },
    { key: 'hsa', label: 'HSA', growth: 'market', preTax: true, limitKey: 'hsa' },
    { key: 'taxable', label: 'Taxable Brokerage', growth: 'market', preTax: false, limitKey: null },
    { key: 'cash', label: 'Cash / Emergency Fund', growth: 'cash', preTax: false, limitKey: null }
  ];

  /* ---- Employer match -------------------------------------------------- */
  // employeeContrib counted toward match = traditional + roth 401k deferrals
  function employerMatch(state) {
    const m = state.match;
    if (!m || !m.enabled) return 0;
    const salary = Math.max(0, state.income || 0);
    const employeeContrib = (state.buckets.trad401k.contrib || 0) + (state.buckets.roth401k.contrib || 0);
    const matchRate = (m.rateCents || 0) / 100;             // cents per dollar -> ratio
    const capDollars = salary * ((m.capPct || 0) / 100);
    return Math.min(employeeContrib, capDollars) * matchRate;
  }

  /* ---- Pre-tax contribution total (reduces AGI) ------------------------ */
  function preTaxContrib(state) {
    let total = 0;
    BUCKETS.forEach(function (b) {
      if (b.preTax) total += Math.max(0, state.buckets[b.key].contrib || 0);
    });
    return total;
  }

  function hsaContrib(state) {
    return Math.max(0, state.buckets.hsa.contrib || 0);
  }

  /* ---- Tax summary for the current state ------------------------------- */
  function taxSummary(state) {
    return Taxes.computeTaxes({
      gross: state.income,
      filing: state.filing,
      preTax: preTaxContrib(state),
      hsaPreTax: hsaContrib(state),
      state: state.state,
      city: state.city,
      deductions: state.deductions
    });
  }

  /* ---- Totals --------------------------------------------------------- */
  function totalContributions(state) {
    let total = 0;
    BUCKETS.forEach(function (b) { total += Math.max(0, state.buckets[b.key].contrib || 0); });
    return total;
  }

  function totalBalance(state) {
    let total = 0;
    BUCKETS.forEach(function (b) { total += Math.max(0, state.buckets[b.key].balance || 0); });
    return total;
  }

  /* ---- Year-by-year deterministic projection --------------------------- */
  /* Returns array of yearly rows from year 0 (current) through N years.     */
  function project(state) {
    const years = Math.max(1, Math.round(state.projection.years));
    const r = (state.projection.returnPct || 0) / 100;
    const match = employerMatch(state);
    const contribByBucket = {};
    BUCKETS.forEach(function (b) { contribByBucket[b.key] = Math.max(0, state.buckets[b.key].contrib || 0); });

    // running balances per bucket
    const bal = {};
    BUCKETS.forEach(function (b) { bal[b.key] = Math.max(0, state.buckets[b.key].balance || 0); });

    // loan
    const loan = state.loans || { enabled: false };
    let loanBal = loan.enabled ? Math.max(0, loan.balance || 0) : 0;
    const loanRate = (loan.rate || 0) / 100;
    const loanPmt = Math.max(0, loan.payment || 0);

    const tax = taxSummary(state);
    const annualSpending = Math.max(0, tax.takeHome - totalContributions(state) - (loan.enabled ? loanPmt : 0));

    const rows = [];

    function snapshot(yearIndex) {
      let assets = 0;
      const bucketVals = {};
      BUCKETS.forEach(function (b) { assets += bal[b.key]; bucketVals[b.key] = bal[b.key]; });
      rows.push({
        yearIndex: yearIndex,
        age: state.age + yearIndex,
        calendarYear: 2025 + yearIndex,
        netWorth: assets - loanBal,
        totalAssets: assets,
        loanBalance: loanBal,
        employerMatch: yearIndex === 0 ? 0 : match,
        totalSaved: yearIndex === 0 ? 0 : totalContributions(state) + match,
        spending: yearIndex === 0 ? 0 : annualSpending,
        buckets: bucketVals
      });
    }

    snapshot(0);

    for (let y = 1; y <= years; y++) {
      // grow & contribute each bucket
      BUCKETS.forEach(function (b) {
        const growth = b.growth === 'cash' ? CASH_RATE : r;
        bal[b.key] = bal[b.key] * (1 + growth) + contribByBucket[b.key];
      });
      // employer match goes into traditional 401k
      bal.trad401k += match;

      // loan amortization (annual): interest then principal from payment
      if (loanBal > 0) {
        const interest = loanBal * loanRate;
        const principal = Math.max(0, loanPmt - interest);
        loanBal = Math.max(0, loanBal - principal);
      }

      snapshot(y);
    }

    return {
      rows: rows,
      match: match,
      tax: tax,
      annualSpending: annualSpending,
      totalContrib: totalContributions(state),
      finalNetWorth: rows[rows.length - 1].netWorth,
      finalAssets: rows[rows.length - 1].totalAssets
    };
  }

  /* ---- Monte Carlo ----------------------------------------------------- */
  /* Box-Muller normal draw */
  function randNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = (sortedArr.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
  }

  function monteCarlo(state, runsArg) {
    const runs = runsArg || 500;
    const years = Math.max(1, Math.round(state.projection.years));
    const meanReturn = (state.projection.returnPct || 0) / 100;
    const stdDev = 0.14;
    const match = employerMatch(state);
    const annualContrib = totalContributions(state) + match;
    const startMarket = (function () {
      let s = 0;
      BUCKETS.forEach(function (b) { if (b.growth === 'market') s += Math.max(0, state.buckets[b.key].balance || 0); });
      return s;
    })();
    const startCash = Math.max(0, state.buckets.cash.balance || 0);

    // loan path (deterministic) to subtract
    const loan = state.loans || { enabled: false };
    let loanBal = loan.enabled ? Math.max(0, loan.balance || 0) : 0;
    const loanRate = (loan.rate || 0) / 100;
    const loanPmt = Math.max(0, loan.payment || 0);
    const loanPath = [loanBal];
    for (let y = 1; y <= years; y++) {
      if (loanBal > 0) {
        const interest = loanBal * loanRate;
        loanBal = Math.max(0, loanBal - Math.max(0, loanPmt - interest));
      }
      loanPath.push(loanBal);
    }

    // cash grows deterministically at HYSA rate
    const cashPath = [startCash];
    let c = startCash;
    for (let y = 1; y <= years; y++) { c = c * (1 + CASH_RATE); cashPath.push(c); }

    // per-year array of run outcomes (market portion)
    const perYear = [];
    for (let y = 0; y <= years; y++) perYear.push(new Float64Array(runs));

    for (let run = 0; run < runs; run++) {
      let v = startMarket;
      perYear[0][run] = v + cashPath[0] - loanPath[0];
      for (let y = 1; y <= years; y++) {
        const ret = meanReturn + stdDev * randNormal();
        v = Math.max(0, v * (1 + ret) + annualContrib);
        perYear[y][run] = v + cashPath[y] - loanPath[y];
      }
    }

    const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
    for (let y = 0; y <= years; y++) {
      const arr = Array.prototype.slice.call(perYear[y]).sort(function (a, b) { return a - b; });
      bands.p10.push(percentile(arr, 0.10));
      bands.p25.push(percentile(arr, 0.25));
      bands.p50.push(percentile(arr, 0.50));
      bands.p75.push(percentile(arr, 0.75));
      bands.p90.push(percentile(arr, 0.90));
    }

    return {
      bands: bands,
      runs: runs,
      finalP10: bands.p10[years],
      finalP50: bands.p50[years],
      finalP90: bands.p90[years]
    };
  }

  /* ---- Roth conversion optimizer --------------------------------------- */
  function rothPlan(state) {
    const filing = state.filing;
    const tax = taxSummary(state);
    const currentMarginal = tax.marginalFederal;

    // Estimated retirement income & marginal rate (assume $40k retirement income)
    const retirementIncome = 40000;
    const stdDed = Taxes.STANDARD_DEDUCTION[filing] || Taxes.STANDARD_DEDUCTION.single;
    const retTaxable = Math.max(0, retirementIncome - stdDed);
    const retirementMarginal = Taxes.federalMarginalAt(retTaxable, filing);

    // Conversion window between retirement age and RMD age (73)
    const windowStart = state.retirementAge;
    const windowYears = Math.max(0, RMD_AGE - windowStart);

    // Top of 22% bracket (taxable income)
    const brackets = Taxes.getFederalBrackets(filing);
    let top22 = 0;
    for (const b of brackets) { if (b.rate === 0.22) { top22 = b.upTo; break; } }
    // Annual conversion to fill 22% bracket on top of retirement taxable income
    const annualConversion = Math.max(0, top22 - retTaxable);

    // Traditional balance available to convert (use projected trad balance at retirement)
    const proj = project(state);
    const yearsToRet = Math.max(0, state.retirementAge - state.age);
    const retRow = proj.rows.find(function (r) { return r.age >= state.retirementAge; }) || proj.rows[proj.rows.length - 1];
    const tradAtRet = retRow ? (retRow.buckets.trad401k + retRow.buckets.plan457) : 0;

    const totalConvertible = Math.min(tradAtRet, annualConversion * windowYears);
    // tax cost: marginal-ish blend — converted dollars taxed at 12% up to top of 12%, then 22%
    const estTaxCost = totalConvertible * 0.22 * 0.85; // blended estimate

    return {
      currentMarginal: currentMarginal,
      retirementMarginal: retirementMarginal,
      retirementIncome: retirementIncome,
      windowStart: windowStart,
      windowEnd: RMD_AGE,
      windowYears: windowYears,
      annualConversion: annualConversion,
      totalConvertible: totalConvertible,
      tradAtRetirement: tradAtRet,
      estTaxCost: estTaxCost,
      worthwhile: currentMarginal <= 0.24 && windowYears > 0
    };
  }

  /* ---- Contribution limit checks --------------------------------------- */
  function limitWarnings(state) {
    const warnings = {};
    // combined 401k limit across trad + roth
    const combined401k = (state.buckets.trad401k.contrib || 0) + (state.buckets.roth401k.contrib || 0);
    if (combined401k > LIMITS.k401) { warnings.trad401k = true; warnings.roth401k = true; }
    if ((state.buckets.plan457.contrib || 0) > LIMITS.k457) warnings.plan457 = true;
    if ((state.buckets.rothIra.contrib || 0) > LIMITS.ira) warnings.rothIra = true;
    if ((state.buckets.hsa.contrib || 0) > LIMITS.hsa) warnings.hsa = true;
    return warnings;
  }

  global.Calc = {
    LIMITS: LIMITS,
    CASH_RATE: CASH_RATE,
    RMD_AGE: RMD_AGE,
    BUCKETS: BUCKETS,
    employerMatch: employerMatch,
    preTaxContrib: preTaxContrib,
    taxSummary: taxSummary,
    totalContributions: totalContributions,
    totalBalance: totalBalance,
    project: project,
    monteCarlo: monteCarlo,
    rothPlan: rothPlan,
    limitWarnings: limitWarnings
  };
})(typeof window !== 'undefined' ? window : this);
