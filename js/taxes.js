/* WealthMD — Tax Engine (2025 tax year)
 * Exposes a global `Taxes` object with 2025 federal, FICA, state and local data
 * plus helper functions used by the financial engine.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* Federal income tax brackets (2025)                                      */
  /* Each bracket: { rate, upTo } where upTo is the top of the bracket.      */
  /* ---------------------------------------------------------------------- */
  const FEDERAL_BRACKETS = {
    single: [
      { rate: 0.10, upTo: 11925 },
      { rate: 0.12, upTo: 48475 },
      { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 },
      { rate: 0.32, upTo: 250525 },
      { rate: 0.35, upTo: 626350 },
      { rate: 0.37, upTo: Infinity }
    ],
    married: [
      { rate: 0.10, upTo: 23850 },
      { rate: 0.12, upTo: 96950 },
      { rate: 0.22, upTo: 206700 },
      { rate: 0.24, upTo: 394600 },
      { rate: 0.32, upTo: 501050 },
      { rate: 0.35, upTo: 751600 },
      { rate: 0.37, upTo: Infinity }
    ]
  };

  const STANDARD_DEDUCTION = { single: 15000, married: 30000 };

  /* FICA constants (2025) */
  const FICA = {
    ssRate: 0.062,
    ssWageBase: 176100,
    medicareRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { single: 200000, married: 250000 }
  };

  /* SALT cap and medical AGI floor for itemized deductions */
  const SALT_CAP = 10000;
  const MEDICAL_AGI_FLOOR = 0.075;

  /* ---------------------------------------------------------------------- */
  /* State income tax (2025).                                                */
  /* type: 'none' | 'flat' | 'graduated'                                     */
  /* graduated brackets are SINGLE thresholds; MFJ uses `mfjDouble` factor   */
  /* (most states that don't double brackets are approximated).              */
  /* ---------------------------------------------------------------------- */
  function g(brackets, mfjDouble) {
    return { type: 'graduated', brackets: brackets, mfjDouble: mfjDouble !== false };
  }

  const STATES = {
    AL: { name: 'Alabama', ...g([{ rate: 0.02, upTo: 500 }, { rate: 0.04, upTo: 3000 }, { rate: 0.05, upTo: Infinity }]) },
    AK: { name: 'Alaska', type: 'none' },
    AZ: { name: 'Arizona', type: 'flat', rate: 0.025 },
    AR: { name: 'Arkansas', ...g([{ rate: 0.02, upTo: 4400 }, { rate: 0.039, upTo: Infinity }]) },
    CA: { name: 'California', ...g([
      { rate: 0.01, upTo: 10756 }, { rate: 0.02, upTo: 25499 }, { rate: 0.04, upTo: 40245 },
      { rate: 0.06, upTo: 55866 }, { rate: 0.08, upTo: 70606 }, { rate: 0.093, upTo: 360659 },
      { rate: 0.103, upTo: 432787 }, { rate: 0.113, upTo: 721314 }, { rate: 0.123, upTo: Infinity }
    ]) },
    CO: { name: 'Colorado', type: 'flat', rate: 0.044 },
    CT: { name: 'Connecticut', ...g([
      { rate: 0.02, upTo: 10000 }, { rate: 0.045, upTo: 50000 }, { rate: 0.055, upTo: 100000 },
      { rate: 0.06, upTo: 200000 }, { rate: 0.065, upTo: 250000 }, { rate: 0.069, upTo: 500000 },
      { rate: 0.0699, upTo: Infinity }
    ]) },
    DE: { name: 'Delaware', ...g([
      { rate: 0.022, upTo: 5000 }, { rate: 0.039, upTo: 10000 }, { rate: 0.048, upTo: 20000 },
      { rate: 0.052, upTo: 25000 }, { rate: 0.0555, upTo: 60000 }, { rate: 0.066, upTo: Infinity }
    ], false) },
    DC: { name: 'District of Columbia', ...g([
      { rate: 0.04, upTo: 10000 }, { rate: 0.06, upTo: 40000 }, { rate: 0.065, upTo: 60000 },
      { rate: 0.085, upTo: 250000 }, { rate: 0.0925, upTo: 500000 }, { rate: 0.0975, upTo: 1000000 },
      { rate: 0.1075, upTo: Infinity }
    ], false) },
    FL: { name: 'Florida', type: 'none' },
    GA: { name: 'Georgia', type: 'flat', rate: 0.0539 },
    HI: { name: 'Hawaii', ...g([
      { rate: 0.014, upTo: 2400 }, { rate: 0.032, upTo: 4800 }, { rate: 0.055, upTo: 9600 },
      { rate: 0.064, upTo: 14400 }, { rate: 0.068, upTo: 19200 }, { rate: 0.072, upTo: 24000 },
      { rate: 0.076, upTo: 36000 }, { rate: 0.079, upTo: 48000 }, { rate: 0.0825, upTo: 150000 },
      { rate: 0.09, upTo: 175000 }, { rate: 0.10, upTo: 200000 }, { rate: 0.11, upTo: Infinity }
    ]) },
    ID: { name: 'Idaho', type: 'flat', rate: 0.05695 },
    IL: { name: 'Illinois', type: 'flat', rate: 0.0495 },
    IN: { name: 'Indiana', type: 'flat', rate: 0.03 },
    IA: { name: 'Iowa', type: 'flat', rate: 0.038 },
    KS: { name: 'Kansas', ...g([{ rate: 0.052, upTo: 23000 }, { rate: 0.0558, upTo: Infinity }]) },
    KY: { name: 'Kentucky', type: 'flat', rate: 0.04 },
    LA: { name: 'Louisiana', type: 'flat', rate: 0.03 },
    ME: { name: 'Maine', ...g([{ rate: 0.058, upTo: 26050 }, { rate: 0.0675, upTo: 61600 }, { rate: 0.0715, upTo: Infinity }]) },
    MD: { name: 'Maryland', ...g([
      { rate: 0.02, upTo: 1000 }, { rate: 0.03, upTo: 2000 }, { rate: 0.04, upTo: 3000 },
      { rate: 0.0475, upTo: 100000 }, { rate: 0.05, upTo: 125000 }, { rate: 0.0525, upTo: 150000 },
      { rate: 0.055, upTo: 250000 }, { rate: 0.0575, upTo: Infinity }
    ]) },
    MA: { name: 'Massachusetts', type: 'flat', rate: 0.05 },
    MI: { name: 'Michigan', type: 'flat', rate: 0.0425 },
    MN: { name: 'Minnesota', ...g([
      { rate: 0.0535, upTo: 32570 }, { rate: 0.068, upTo: 106990 },
      { rate: 0.0785, upTo: 198630 }, { rate: 0.0985, upTo: Infinity }
    ]) },
    MS: { name: 'Mississippi', type: 'flat', rate: 0.044 },
    MO: { name: 'Missouri', ...g([{ rate: 0.02, upTo: 1273 }, { rate: 0.025, upTo: 2546 }, { rate: 0.03, upTo: 3819 }, { rate: 0.035, upTo: 5092 }, { rate: 0.047, upTo: Infinity }]) },
    MT: { name: 'Montana', ...g([{ rate: 0.047, upTo: 21100 }, { rate: 0.059, upTo: Infinity }]) },
    NE: { name: 'Nebraska', ...g([{ rate: 0.0246, upTo: 3700 }, { rate: 0.0351, upTo: 22170 }, { rate: 0.0501, upTo: 35730 }, { rate: 0.052, upTo: Infinity }]) },
    NV: { name: 'Nevada', type: 'none' },
    NH: { name: 'New Hampshire', type: 'none' },
    NJ: { name: 'New Jersey', ...g([
      { rate: 0.014, upTo: 20000 }, { rate: 0.0175, upTo: 35000 }, { rate: 0.035, upTo: 40000 },
      { rate: 0.05525, upTo: 75000 }, { rate: 0.0637, upTo: 500000 }, { rate: 0.0897, upTo: 1000000 },
      { rate: 0.1075, upTo: Infinity }
    ], false) },
    NM: { name: 'New Mexico', ...g([
      { rate: 0.015, upTo: 5500 }, { rate: 0.032, upTo: 16500 }, { rate: 0.043, upTo: 33500 },
      { rate: 0.047, upTo: 66500 }, { rate: 0.049, upTo: 210000 }, { rate: 0.059, upTo: Infinity }
    ]) },
    NY: { name: 'New York', ...g([
      { rate: 0.04, upTo: 8500 }, { rate: 0.045, upTo: 11700 }, { rate: 0.0525, upTo: 13900 },
      { rate: 0.055, upTo: 80650 }, { rate: 0.06, upTo: 215400 }, { rate: 0.0685, upTo: 1077550 },
      { rate: 0.0965, upTo: 5000000 }, { rate: 0.103, upTo: 25000000 }, { rate: 0.109, upTo: Infinity }
    ]) },
    NC: { name: 'North Carolina', type: 'flat', rate: 0.0425 },
    ND: { name: 'North Dakota', ...g([{ rate: 0.0, upTo: 47150 }, { rate: 0.0195, upTo: 238200 }, { rate: 0.025, upTo: Infinity }]) },
    OH: { name: 'Ohio', ...g([{ rate: 0.0, upTo: 26050 }, { rate: 0.0275, upTo: 100000 }, { rate: 0.035, upTo: Infinity }]) },
    OK: { name: 'Oklahoma', ...g([{ rate: 0.0025, upTo: 1000 }, { rate: 0.0075, upTo: 2500 }, { rate: 0.0175, upTo: 3750 }, { rate: 0.0275, upTo: 4900 }, { rate: 0.0375, upTo: 7200 }, { rate: 0.0475, upTo: Infinity }]) },
    OR: { name: 'Oregon', ...g([
      { rate: 0.0475, upTo: 4300 }, { rate: 0.0675, upTo: 10750 }, { rate: 0.0875, upTo: 125000 },
      { rate: 0.099, upTo: Infinity }
    ]) },
    PA: { name: 'Pennsylvania', type: 'flat', rate: 0.0307 },
    RI: { name: 'Rhode Island', ...g([{ rate: 0.0375, upTo: 79900 }, { rate: 0.0475, upTo: 181650 }, { rate: 0.0599, upTo: Infinity }]) },
    SC: { name: 'South Carolina', ...g([{ rate: 0.0, upTo: 3560 }, { rate: 0.03, upTo: 17830 }, { rate: 0.062, upTo: Infinity }]) },
    SD: { name: 'South Dakota', type: 'none' },
    TN: { name: 'Tennessee', type: 'none' },
    TX: { name: 'Texas', type: 'none' },
    UT: { name: 'Utah', type: 'flat', rate: 0.0455 },
    VT: { name: 'Vermont', ...g([{ rate: 0.0335, upTo: 45400 }, { rate: 0.066, upTo: 110050 }, { rate: 0.076, upTo: 229550 }, { rate: 0.0875, upTo: Infinity }]) },
    VA: { name: 'Virginia', ...g([{ rate: 0.02, upTo: 3000 }, { rate: 0.03, upTo: 5000 }, { rate: 0.05, upTo: 17000 }, { rate: 0.0575, upTo: Infinity }], false) },
    WA: { name: 'Washington', type: 'none' },
    WV: { name: 'West Virginia', ...g([{ rate: 0.0222, upTo: 10000 }, { rate: 0.0296, upTo: 25000 }, { rate: 0.0333, upTo: 40000 }, { rate: 0.0444, upTo: 60000 }, { rate: 0.0482, upTo: Infinity }]) },
    WI: { name: 'Wisconsin', ...g([{ rate: 0.035, upTo: 14680 }, { rate: 0.044, upTo: 29370 }, { rate: 0.053, upTo: 323290 }, { rate: 0.0765, upTo: Infinity }]) },
    WY: { name: 'Wyoming', type: 'none' }
  };

  /* ---------------------------------------------------------------------- */
  /* Local / city income taxes (2025). Keyed by state code.                  */
  /* ---------------------------------------------------------------------- */
  const CITY_TAXES = {
    NY: [{ name: 'New York City', rate: 0.03876 }, { name: 'Yonkers', rate: 0.01477 }],
    PA: [{ name: 'Philadelphia', rate: 0.0375 }, { name: 'Pittsburgh', rate: 0.03 }, { name: 'Scranton', rate: 0.034 }],
    MI: [{ name: 'Detroit', rate: 0.024 }, { name: 'Grand Rapids', rate: 0.015 }, { name: 'Lansing', rate: 0.01 }],
    OH: [{ name: 'Columbus', rate: 0.025 }, { name: 'Cleveland', rate: 0.025 }, { name: 'Cincinnati', rate: 0.018 }, { name: 'Toledo', rate: 0.0225 }, { name: 'Akron', rate: 0.025 }],
    MD: [{ name: 'Baltimore', rate: 0.032 }, { name: 'Montgomery County', rate: 0.032 }],
    KY: [{ name: 'Louisville', rate: 0.0228 }, { name: 'Lexington', rate: 0.0225 }],
    IN: [{ name: 'Indianapolis', rate: 0.02 }, { name: 'Fort Wayne', rate: 0.0148 }],
    MO: [{ name: 'Kansas City', rate: 0.01 }, { name: 'St. Louis', rate: 0.01 }],
    DE: [{ name: 'Wilmington', rate: 0.0125 }],
    AL: [{ name: 'Birmingham', rate: 0.01 }],
    OR: [{ name: 'Portland (Metro)', rate: 0.01 }]
  };

  /* ---------------------------------------------------------------------- */
  /* Core tax calculations                                                   */
  /* ---------------------------------------------------------------------- */

  function bracketTax(taxableIncome, brackets) {
    let tax = 0;
    let lower = 0;
    for (const b of brackets) {
      if (taxableIncome <= lower) break;
      const slice = Math.min(taxableIncome, b.upTo) - lower;
      tax += slice * b.rate;
      lower = b.upTo;
    }
    return Math.max(0, tax);
  }

  function marginalRate(taxableIncome, brackets) {
    let rate = brackets[0].rate;
    let lower = 0;
    for (const b of brackets) {
      if (taxableIncome > lower) rate = b.rate;
      lower = b.upTo;
    }
    return rate;
  }

  function getFederalBrackets(filing) {
    return filing === 'married' ? FEDERAL_BRACKETS.married : FEDERAL_BRACKETS.single;
  }

  /* Compute itemized deduction total */
  function itemizedTotal(agi, items) {
    items = items || {};
    const mortgage = Math.max(0, items.mortgage || 0);
    const salt = Math.min(SALT_CAP, Math.max(0, items.salt || 0));
    const charity = Math.max(0, items.charity || 0);
    const medicalRaw = Math.max(0, items.medical || 0);
    const medical = Math.max(0, medicalRaw - agi * MEDICAL_AGI_FLOOR);
    return mortgage + salt + charity + medical;
  }

  function federalDeduction(agi, filing, deductions) {
    const std = STANDARD_DEDUCTION[filing] || STANDARD_DEDUCTION.single;
    if (deductions && deductions.mode === 'itemize') {
      const itemized = itemizedTotal(agi, deductions);
      return { amount: Math.max(std, itemized), itemized: itemized, standard: std, used: itemized > std ? 'itemized' : 'standard' };
    }
    return { amount: std, itemized: 0, standard: std, used: 'standard' };
  }

  function federalTax(agi, filing, deductions) {
    const brackets = getFederalBrackets(filing);
    const ded = federalDeduction(agi, filing, deductions);
    const taxable = Math.max(0, agi - ded.amount);
    return {
      tax: bracketTax(taxable, brackets),
      taxable: taxable,
      deduction: ded,
      marginal: marginalRate(taxable, brackets)
    };
  }

  function ficaTax(wages, filing) {
    const ss = Math.min(wages, FICA.ssWageBase) * FICA.ssRate;
    const medicare = wages * FICA.medicareRate;
    const threshold = FICA.addlMedicareThreshold[filing] || FICA.addlMedicareThreshold.single;
    const addl = Math.max(0, wages - threshold) * FICA.addlMedicareRate;
    return ss + medicare + addl;
  }

  function stateTax(taxableIncome, stateCode, filing) {
    const st = STATES[stateCode];
    if (!st || st.type === 'none') return 0;
    if (st.type === 'flat') return Math.max(0, taxableIncome) * st.rate;
    // graduated
    let brackets = st.brackets;
    if (filing === 'married' && st.mfjDouble) {
      brackets = brackets.map(function (b) {
        return { rate: b.rate, upTo: b.upTo === Infinity ? Infinity : b.upTo * 2 };
      });
    }
    return bracketTax(Math.max(0, taxableIncome), brackets);
  }

  function localTax(taxableIncome, stateCode, cityName) {
    if (!cityName) return 0;
    const cities = CITY_TAXES[stateCode] || [];
    const city = cities.find(function (c) { return c.name === cityName; });
    if (!city) return 0;
    return Math.max(0, taxableIncome) * city.rate;
  }

  /* Full tax summary for a given gross income & profile.
   * preTax = pre-tax contributions (trad 401k/457/HSA) that reduce AGI & wages.
   */
  function computeTaxes(opts) {
    const gross = Math.max(0, opts.gross || 0);
    const filing = opts.filing === 'married' ? 'married' : 'single';
    const preTax = Math.max(0, opts.preTax || 0);
    const stateCode = opts.state || 'CA';
    const cityName = opts.city || '';
    const deductions = opts.deductions || { mode: 'standard' };

    const wages = Math.max(0, gross - preTax);   // FICA does not apply to 401k but DOES apply normally; SS/Medicare apply to gross-401k? 401k is FICA-taxable. We treat HSA via cafeteria as FICA-exempt; keep simple: FICA on gross minus HSA only.
    const ficaWages = Math.max(0, gross - (opts.hsaPreTax || 0));
    const agi = Math.max(0, gross - preTax);

    const fed = federalTax(agi, filing, deductions);
    const fica = ficaTax(ficaWages, filing);
    const stTaxable = fed.taxable; // approximate state taxable income with federal taxable
    const state = stateTax(stTaxable, stateCode, filing);
    const local = localTax(agi, stateCode, cityName);

    const total = fed.tax + fica + state + local;
    return {
      gross: gross,
      agi: agi,
      taxable: fed.taxable,
      federal: fed.tax,
      fica: fica,
      state: state,
      local: local,
      total: total,
      deduction: fed.deduction,
      marginalFederal: fed.marginal,
      takeHome: gross - total,
      effectiveRate: gross > 0 ? total / gross : 0
    };
  }

  /* Estimate the federal marginal rate at a given taxable income level */
  function federalMarginalAt(taxableIncome, filing) {
    return marginalRate(Math.max(0, taxableIncome), getFederalBrackets(filing));
  }

  global.Taxes = {
    FEDERAL_BRACKETS: FEDERAL_BRACKETS,
    STANDARD_DEDUCTION: STANDARD_DEDUCTION,
    FICA: FICA,
    SALT_CAP: SALT_CAP,
    STATES: STATES,
    CITY_TAXES: CITY_TAXES,
    bracketTax: bracketTax,
    federalTax: federalTax,
    ficaTax: ficaTax,
    stateTax: stateTax,
    localTax: localTax,
    computeTaxes: computeTaxes,
    federalMarginalAt: federalMarginalAt,
    getFederalBrackets: getFederalBrackets
  };
})(typeof window !== 'undefined' ? window : this);
