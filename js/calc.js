/* Attending Launch — Financial Engine (calc.js)
 * One lifecycle engine drives every view: accumulate until retirement age
 * (contributions and employer match STOP there), then draw down to the
 * plan-to age with tax-aware withdrawal ordering, RMDs at 73, and Social
 * Security. The Monte Carlo simulation runs the SAME yearly logic with
 * random returns, so the percentile bands and the chance-of-success number
 * can never contradict the deterministic projection.
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

  /* The savings buckets in display order. growth: 'market' | 'cash'. */
  const BUCKETS = [
    { key: 'trad401k', label: '401k/403b Traditional', growth: 'market', preTax: true, limitKey: 'k401', group: 'retirement' },
    { key: 'roth401k', label: '401k/403b Roth', growth: 'market', preTax: false, limitKey: 'k401', group: 'retirement' },
    { key: 'plan457', label: '457(b)', growth: 'market', preTax: true, limitKey: 'k457', group: 'retirement' },
    { key: 'rothIra', label: 'Backdoor Roth IRA', growth: 'market', preTax: false, limitKey: 'ira', group: 'retirement' },
    { key: 'hsa', label: 'HSA', growth: 'market', preTax: true, limitKey: 'hsa', group: 'retirement' },
    { key: 'taxable', label: 'Taxable Brokerage', growth: 'market', preTax: false, limitKey: null, group: 'savings' },
    { key: 'cash', label: 'Cash / Emergency Fund', growth: 'cash', preTax: false, limitKey: null, group: 'savings' }
  ];

  const BUCKET_GROUPS = [
    { id: 'retirement', label: 'Retirement Accounts', hint: 'Tax-advantaged, for retirement' },
    { id: 'savings', label: 'Savings & Cash', hint: 'Accessible before retirement' }
  ];

  /* ---- Employer match -------------------------------------------------- */
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

  /* ===================================================================== */
  /* Retirement mechanics: RMDs, Social Security, withdrawal sequencing     */
  /* ===================================================================== */

  /* IRS Uniform Lifetime Table divisors (2022+), ages 73–100. */
  const RMD_DIVISORS = {
    73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
    80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
    87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
    94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4
  };
  function rmdDivisor(age) {
    if (age < RMD_AGE) return Infinity;
    return RMD_DIVISORS[age] || 6.0;
  }

  /* Social Security claim-age adjustment vs full retirement age (67). */
  function ssFactor(claimAge) {
    const fra = 67;
    if (claimAge < fra) {
      const months = (fra - claimAge) * 12;
      const reduction = Math.min(36, months) * (5 / 9) / 100 +
        Math.max(0, months - 36) * (5 / 12) / 100;
      return Math.max(0, 1 - reduction);
    } else if (claimAge > fra) {
      const months = (claimAge - fra) * 12;
      return 1 + months * (2 / 3) / 100;   // 8% per year delayed credit
    }
    return 1;
  }

  /* Ordinary-income tax in retirement (no FICA): federal + state + local. */
  function retirementOrdinaryTax(ordinary, filing, stateCode, city) {
    const o = Math.max(0, ordinary);
    const fed = Taxes.federalTax(o, filing, { mode: 'standard' });
    const st = Taxes.stateTax(fed.taxable, stateCode, filing);
    const loc = Taxes.localTax(o, stateCode, city);
    return fed.tax + st + loc;
  }

  /* Withdrawal sequence: cash → taxable → tax-deferred → HSA → Roth. */
  const WITHDRAW_ORDER = [
    { key: 'cash', type: 'free' },
    { key: 'taxable', type: 'gains' },
    { key: 'trad401k', type: 'ordinary' },
    { key: 'plan457', type: 'ordinary' },
    { key: 'hsa', type: 'free' },
    { key: 'roth401k', type: 'free' },
    { key: 'rothIra', type: 'free' }
  ];
  const CAPGAINS_EFFECTIVE = 0.075;  // ~15% LTCG on ~50% gains assumption

  /* Pull `targetGross` from balances in order, forcing at least `rmdMin`
   * out of tax-deferred first. Mutates the passed balance object. */
  function pullFunds(bal, targetGross, rmdMin) {
    let ordinary = 0, gains = 0, free = 0, withdrawn = 0;
    function take(key, amt) {
      const t = Math.min(bal[key], Math.max(0, amt));
      bal[key] -= t;
      return t;
    }
    // Required minimum distribution (taxable, ordinary) comes out first.
    let rmdLeft = rmdMin;
    ['trad401k', 'plan457'].forEach(function (k) {
      if (rmdLeft <= 0) return;
      const t = take(k, rmdLeft);
      ordinary += t; withdrawn += t; rmdLeft -= t;
    });
    let need = Math.max(0, targetGross - withdrawn);
    for (let i = 0; i < WITHDRAW_ORDER.length && need > 0; i++) {
      const o = WITHDRAW_ORDER[i];
      const t = take(o.key, need);
      withdrawn += t; need -= t;
      if (o.type === 'ordinary') ordinary += t;
      else if (o.type === 'gains') gains += t;
      else free += t;
    }
    return { withdrawn: withdrawn, ordinary: ordinary, gains: gains, free: free, shortfall: need };
  }

  function cloneBalances(bal) {
    const c = {};
    BUCKETS.forEach(function (b) { c[b.key] = bal[b.key]; });
    return c;
  }

  /* Fund one retirement year: solve the gross withdrawal (incl. taxes) needed to
   * cover spending after Social Security, honoring the RMD minimum. Mutates bal,
   * reinvests any surplus into taxable, and returns {tax, withdrawal, shortfall}. */
  function fundRetirementYear(bal, spendingNeed, ss, rmd, filing, stateCode, city) {
    const ssOrdinary = 0.85 * ss;
    let target = Math.max(0, spendingNeed - ss);
    let res = null;
    for (let it = 0; it < 6; it++) {
      res = pullFunds(cloneBalances(bal), target, rmd);
      const t = retirementOrdinaryTax(res.ordinary + ssOrdinary, filing, stateCode, city) +
        res.gains * CAPGAINS_EFFECTIVE;
      const spendable = ss + res.withdrawn - t;
      const gap = spendingNeed - spendable;
      if (gap <= 1 || res.shortfall > 0) break;
      target += gap;
    }
    res = pullFunds(bal, target, rmd);
    const tax = retirementOrdinaryTax(res.ordinary + ssOrdinary, filing, stateCode, city) +
      res.gains * CAPGAINS_EFFECTIVE;
    const surplus = (ss + res.withdrawn - tax) - spendingNeed;
    if (surplus > 0) bal.taxable += surplus;
    return { tax: tax, withdrawal: res.withdrawn, shortfall: res.shortfall };
  }

  /* ===================================================================== */
  /* Full-lifecycle deterministic projection (THE engine)                   */
  /* ===================================================================== */
  function project(state) {
    const ret = state.retirement || {};
    const startAge = state.age;
    const retAge = state.retirementAge;
    const endAge = Math.max(retAge + 1, Math.min(100, Math.round(ret.planToAge || 95)));
    const r = (state.projection.returnPct || 0) / 100;
    const infl = (ret.inflation || 2.5) / 100;
    const match = employerMatch(state);
    const filing = state.filing, stateCode = state.state, city = state.city;

    const contribByBucket = {};
    BUCKETS.forEach(function (b) { contribByBucket[b.key] = Math.max(0, state.buckets[b.key].contrib || 0); });
    const bal = {};
    BUCKETS.forEach(function (b) { bal[b.key] = Math.max(0, state.buckets[b.key].balance || 0); });

    const loan = state.loans || { enabled: false };
    let loanBal = loan.enabled ? Math.max(0, loan.balance || 0) : 0;
    const loanRate = (loan.rate || 0) / 100;
    const loanPmt = Math.max(0, loan.payment || 0);

    const tax = taxSummary(state);
    const annualContrib = totalContributions(state);
    const workingSpending = Math.max(0, tax.takeHome - annualContrib - (loan.enabled ? loanPmt : 0));

    const baseSpending = Math.max(0, ret.spending || 0);
    const claimAge = ret.ssClaimAge || 67;
    const ssAnnual = Math.max(0, ret.ssAnnual || 0) * ssFactor(claimAge);

    const rows = [];
    let depleteAge = null;
    let lifetimeTax = 0;
    let retirementAssets = 0;
    let retirementNetWorth = 0;

    function totalAssets() {
      let s = 0; BUCKETS.forEach(function (b) { s += bal[b.key]; }); return s;
    }
    function snapshot(age, extra) {
      const assets = totalAssets();
      rows.push(Object.assign({
        yearIndex: age - startAge,
        age: age,
        calendarYear: 2025 + (age - startAge),
        netWorth: assets - loanBal,
        totalAssets: assets,
        loanBalance: loanBal,
        buckets: cloneBalances(bal)
      }, extra));
    }

    snapshot(startAge, { employerMatch: 0, totalSaved: 0, spending: 0, withdrawal: 0, tax: 0, ss: 0, retired: startAge >= retAge });

    for (let age = startAge + 1; age <= endAge; age++) {
      const yearIndex = age - startAge;
      BUCKETS.forEach(function (b) {
        const growth = b.growth === 'cash' ? CASH_RATE : r;
        bal[b.key] = bal[b.key] * (1 + growth);
      });

      const retired = age >= retAge;
      let withdrawal = 0, taxPaid = 0, ss = 0, spendingNeed = 0, savedNow = 0, matchNow = 0;

      if (!retired) {
        // accumulation years: contributions + employer match (into traditional)
        BUCKETS.forEach(function (b) { bal[b.key] += contribByBucket[b.key]; });
        bal.trad401k += match;
        savedNow = annualContrib + match;
        matchNow = match;
        spendingNeed = workingSpending;
      } else {
        // drawdown years: NO contributions, NO match — fund spending instead
        if (retirementAssets === 0) {
          retirementAssets = totalAssets();
          retirementNetWorth = retirementAssets - loanBal;
        }
        spendingNeed = baseSpending * Math.pow(1 + infl, yearIndex);
        ss = (age >= claimAge) ? ssAnnual * Math.pow(1 + infl, yearIndex) : 0;
        const rmd = (age >= RMD_AGE) ? (bal.trad401k + bal.plan457) / rmdDivisor(age) : 0;
        const flow = fundRetirementYear(bal, spendingNeed, ss, rmd, filing, stateCode, city);
        taxPaid = flow.tax;
        withdrawal = flow.withdrawal;
        lifetimeTax += taxPaid;
        if (flow.shortfall > 0 && depleteAge === null) depleteAge = age;
      }

      if (loanBal > 0) {
        const interest = loanBal * loanRate;
        const principal = Math.max(0, loanPmt - interest);
        loanBal = Math.max(0, loanBal - principal);
      }

      snapshot(age, { employerMatch: matchNow, totalSaved: savedNow, spending: spendingNeed, withdrawal: withdrawal, tax: taxPaid, ss: ss, retired: retired });
    }

    const last = rows[rows.length - 1];
    return {
      rows: rows,
      match: match,
      tax: tax,
      annualSpending: workingSpending,
      totalContrib: annualContrib,
      retAge: retAge,
      endAge: endAge,
      depleteAge: depleteAge,
      lastsToPlan: depleteAge === null,
      lifetimeTax: lifetimeTax,
      retirementAssets: retirementAssets,
      retirementNetWorth: retirementNetWorth,
      endingAssets: last.totalAssets,
      finalNetWorth: last.netWorth,
      firstYearSpending: baseSpending * Math.pow(1 + infl, Math.max(0, retAge - startAge)),
      ssAnnualAtClaim: ssAnnual
    };
  }

  /* ===================================================================== */
  /* Stochastic engine — SAME yearly logic, random returns                  */
  /* ===================================================================== */

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

  /* One simulated lifetime: mirrors project() year by year but draws each
   * year's market return from the caller. Records the net-worth path and
   * whether any retirement year could not be funded. */
  function simulateLifecycle(state, drawReturn) {
    const ret = state.retirement || {};
    const startAge = state.age, retAge = state.retirementAge;
    const endAge = Math.max(retAge + 1, Math.min(100, Math.round(ret.planToAge || 95)));
    const infl = (ret.inflation || 2.5) / 100;
    const match = employerMatch(state);
    const filing = state.filing, stateCode = state.state, city = state.city;
    const contrib = {}; BUCKETS.forEach(function (b) { contrib[b.key] = Math.max(0, state.buckets[b.key].contrib || 0); });
    const bal = {}; BUCKETS.forEach(function (b) { bal[b.key] = Math.max(0, state.buckets[b.key].balance || 0); });
    const baseSpending = Math.max(0, ret.spending || 0);
    const claimAge = ret.ssClaimAge || 67;
    const ssAnnual = Math.max(0, ret.ssAnnual || 0) * ssFactor(claimAge);

    const loan = state.loans || { enabled: false };
    let loanBal = loan.enabled ? Math.max(0, loan.balance || 0) : 0;
    const loanRate = (loan.rate || 0) / 100;
    const loanPmt = Math.max(0, loan.payment || 0);

    let depleted = false;
    function assets() { let s = 0; BUCKETS.forEach(function (b) { s += bal[b.key]; }); return s; }
    const path = [assets() - loanBal];

    for (let age = startAge + 1; age <= endAge; age++) {
      const yearIndex = age - startAge;
      const mret = drawReturn();
      BUCKETS.forEach(function (b) {
        const g = b.growth === 'cash' ? CASH_RATE : mret;
        bal[b.key] = Math.max(0, bal[b.key] * (1 + g));
      });
      if (age < retAge) {
        BUCKETS.forEach(function (b) { bal[b.key] += contrib[b.key]; });
        bal.trad401k += match;
      } else {
        const spendingNeed = baseSpending * Math.pow(1 + infl, yearIndex);
        const ss = (age >= claimAge) ? ssAnnual * Math.pow(1 + infl, yearIndex) : 0;
        const rmd = (age >= RMD_AGE) ? (bal.trad401k + bal.plan457) / rmdDivisor(age) : 0;
        const flow = fundRetirementYear(bal, spendingNeed, ss, rmd, filing, stateCode, city);
        if (flow.shortfall > 0) depleted = true;
      }
      if (loanBal > 0) {
        const interest = loanBal * loanRate;
        loanBal = Math.max(0, loanBal - Math.max(0, loanPmt - interest));
      }
      path.push(assets() - loanBal);
    }
    return { depleted: depleted, endingAssets: assets(), path: path };
  }

  /* The one stochastic engine for the app: percentile bands per year AND the
   * chance-of-success rate, computed from the same simulated paths. */
  function simulate(state, runsArg) {
    const runs = runsArg || 500;
    const mean = (state.projection.returnPct || 0) / 100;
    const stdDev = 0.14;
    const ret = state.retirement || {};
    const endAge = Math.max(state.retirementAge + 1, Math.min(100, Math.round(ret.planToAge || 95)));
    const years = endAge - state.age;

    const perYear = [];
    for (let y = 0; y <= years; y++) perYear.push(new Float64Array(runs));
    let lasted = 0;
    const endings = [];

    for (let run = 0; run < runs; run++) {
      const res = simulateLifecycle(state, function () { return mean + stdDev * randNormal(); });
      if (!res.depleted) lasted++;
      endings.push(res.endingAssets);
      for (let y = 0; y <= years; y++) perYear[y][run] = res.path[y];
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
    endings.sort(function (a, b) { return a - b; });

    return {
      bands: bands,
      runs: runs,
      years: years,
      successRate: lasted / runs,
      medianEnding: percentile(endings, 0.5),
      p10Ending: percentile(endings, 0.10),
      p90Ending: percentile(endings, 0.90),
      finalP10: bands.p10[years],
      finalP50: bands.p50[years],
      finalP90: bands.p90[years]
    };
  }

  /* ---- Social Security claim-age comparison ----------------------------- */
  function socialSecurity(state) {
    const ret = state.retirement || {};
    const base = Math.max(0, ret.ssAnnual || 0);   // benefit at FRA 67
    const planTo = Math.max(71, Math.min(100, Math.round(ret.planToAge || 95)));
    return [62, 67, 70].map(function (claim) {
      const factor = ssFactor(claim);
      const annual = base * factor;
      const years = Math.max(0, planTo - claim);
      return {
        claimAge: claim,
        factor: factor,
        annual: annual,
        monthly: annual / 12,
        years: years,
        lifetime: annual * years,
        selected: (ret.ssClaimAge || 67) === claim
      };
    });
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
    const annualConversion = Math.max(0, top22 - retTaxable);

    // Traditional balance available to convert (projected balance at retirement)
    const proj = project(state);
    const retRow = proj.rows.find(function (r) { return r.age >= state.retirementAge; }) || proj.rows[proj.rows.length - 1];
    const tradAtRet = retRow ? (retRow.buckets.trad401k + retRow.buckets.plan457) : 0;

    const totalConvertible = Math.min(tradAtRet, annualConversion * windowYears);
    // blended estimate — approximation, not a filing-grade figure
    const estTaxCost = totalConvertible * 0.22 * 0.85;

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
    BUCKET_GROUPS: BUCKET_GROUPS,
    employerMatch: employerMatch,
    preTaxContrib: preTaxContrib,
    taxSummary: taxSummary,
    totalContributions: totalContributions,
    totalBalance: totalBalance,
    project: project,
    retirementProjection: project,   // legacy alias — same engine
    simulate: simulate,
    rothPlan: rothPlan,
    limitWarnings: limitWarnings,
    rmdDivisor: rmdDivisor,
    ssFactor: ssFactor,
    socialSecurity: socialSecurity
  };
})(typeof window !== 'undefined' ? window : this);
