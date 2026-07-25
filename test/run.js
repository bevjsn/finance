/* Attending Launch — engine regression tests.
 * Run:  node test/run.js
 * Zero dependencies. Golden numbers are hand-computed from 2025 IRS/SSA
 * tables so a silent change to the tax or projection engine fails loudly.
 */
'use strict';

global.window = global;
const mem = {};
global.localStorage = {
  getItem: function (k) { return k in mem ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};

require('../js/taxes.js');
require('../js/calc.js');
require('../js/store.js');
require('../js/persist.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  FAIL ' + name); }
}
function close(name, actual, expected, tol) {
  const t = tol == null ? 1 : tol;
  if (Math.abs(actual - expected) <= t) { pass++; }
  else { fail++; console.error('  FAIL ' + name + ' — expected ' + expected + ' got ' + actual); }
}
function plan(mutate) {
  const p = Store.getDefault();
  if (mutate) mutate(p);
  return p;
}

/* ---------------------------------------------------------------- */
console.log('federal brackets (2025)');
/* Single, taxable 100,000:
 * 11,925×10% + 36,550×12% + 51,525×22% = 1,192.50 + 4,386 + 11,335.50 */
close('single taxable 100k', Taxes.bracketTax(100000, Taxes.FEDERAL_BRACKETS.single), 16914, 0.01);
/* MFJ, taxable 200,000: 2,385 + 8,772 + 22,671 */
close('mfj taxable 200k', Taxes.bracketTax(200000, Taxes.FEDERAL_BRACKETS.married), 33828, 0.01);
ok('std deduction single', Taxes.STANDARD_DEDUCTION.single === 15000);
ok('std deduction mfj', Taxes.STANDARD_DEDUCTION.married === 30000);
ok('std deduction hoh', Taxes.STANDARD_DEDUCTION.hoh === 22500);
ok('std deduction mfs', Taxes.STANDARD_DEDUCTION.mfs === 15000);
ok('std deduction qss', Taxes.STANDARD_DEDUCTION.qss === 30000);
ok('qss uses mfj brackets', Taxes.FEDERAL_BRACKETS.qss === Taxes.FEDERAL_BRACKETS.married);
ok('marginal 35% at 307.2k single', Taxes.federalMarginalAt(307200, 'single') === 0.35);

/* ---------------------------------------------------------------- */
console.log('FICA (2025)');
/* 200k single: SS 176,100×6.2% = 10,918.20; Medicare 2,900; no addl */
close('fica 200k single', Taxes.ficaTax(200000, 'single'), 13818.20, 0.01);
/* 300k single: + Medicare 4,350 + addl (100k×0.9%) 900 */
close('fica 300k single', Taxes.ficaTax(300000, 'single'), 16168.20, 0.01);
/* 300k married: addl only above 250k → 450 */
close('fica 300k married', Taxes.ficaTax(300000, 'married'), 15718.20, 0.01);

/* ---------------------------------------------------------------- */
console.log('state & local tax');
close('PA flat 100k', Taxes.stateTax(100000, 'PA', 'single'), 3070, 0.01);
ok('TX no income tax', Taxes.stateTax(100000, 'TX', 'single') === 0);
/* CA single 50k: 107.56 + 294.86 + 589.84 + 585.30 */
close('CA graduated 50k single', Taxes.stateTax(50000, 'CA', 'single'), 1577.56, 0.01);
/* CA married doubles brackets: 215.12 + 589.72 + 1,179.68 + 1,170.60 */
close('CA graduated 100k married', Taxes.stateTax(100000, 'CA', 'married'), 3155.12, 0.01);
close('NYC local 100k', Taxes.localTax(100000, 'NY', 'New York City'), 3876, 0.01);
close('Detroit local 100k', Taxes.localTax(100000, 'MI', 'Detroit'), 2400, 0.01);
ok('unknown city -> 0', Taxes.localTax(100000, 'MD', 'Nowhere') === 0);

/* ---------------------------------------------------------------- */
console.log('full computeTaxes (golden: $350k single, CA, 401k+HSA pre-tax)');
const t = Taxes.computeTaxes({
  gross: 350000, filing: 'single', preTax: 27800, hsaPreTax: 4300,
  state: 'CA', city: '', deductions: { mode: 'standard' }
});
close('federal', t.federal, 77067.25, 0.5);
close('fica', t.fica, 17242.15, 0.5);
close('CA state (regression)', t.state, 25112, 5);
ok('local zero', t.local === 0);
ok('takeHome = gross - total', Math.abs(t.takeHome - (350000 - t.total)) < 0.01);

/* ---------------------------------------------------------------- */
console.log('itemized deductions');
const it = Taxes.computeTaxes({
  gross: 350000, filing: 'married', preTax: 30000, hsaPreTax: 0, state: 'TX', city: '',
  deductions: { mode: 'itemize', mortgage: 18000, salt: 30000, charity: 5000, medical: 40000 }
});
/* AGI 320k → medical floor 24k → 16k counts; SALT capped at 10k → 18+10+5+16 = 49k */
close('itemized total (SALT cap + medical floor)', it.deduction.amount, 49000, 0.01);
ok('itemized chosen over standard', it.deduction.used === 'itemized');
const stdWins = Taxes.computeTaxes({
  gross: 300000, filing: 'single', preTax: 0, state: 'TX', city: '',
  deductions: { mode: 'itemize', mortgage: 0, salt: 30000, charity: 0, medical: 0 }
});
ok('standard wins when itemized smaller', stdWins.deduction.used === 'standard' && stdWins.deduction.amount === 15000);

/* ---------------------------------------------------------------- */
console.log('employer match & contribution limits');
close('match default (100¢ to 4% of 350k)', Calc.employerMatch(plan()), 14000, 0.01);
close('match 50¢ per $', Calc.employerMatch(plan(function (p) { p.match.rateCents = 50; })), 7000, 0.01);
close('match capped by employee contrib', Calc.employerMatch(plan(function (p) {
  p.buckets.trad401k.contrib = 5000; p.buckets.rothIra.contrib = 0;
})), 5000, 0.01);
ok('no warnings at defaults', Object.keys(Calc.limitWarnings(plan())).length === 0);
ok('401k combined over-limit warns', !!Calc.limitWarnings(plan(function (p) { p.buckets.trad401k.contrib = 30000; })).trad401k);
ok('IRA over-limit warns', !!Calc.limitWarnings(plan(function (p) { p.buckets.rothIra.contrib = 8000; })).rothIra);
ok('HSA over-limit warns', !!Calc.limitWarnings(plan(function (p) { p.buckets.hsa.contrib = 5000; })).hsa);

/* ---------------------------------------------------------------- */
console.log('retirement mechanics');
close('ssFactor 62', Calc.ssFactor(62), 0.70, 0.001);
close('ssFactor 67', Calc.ssFactor(67), 1.0, 0.001);
close('ssFactor 70', Calc.ssFactor(70), 1.24, 0.001);
ok('rmd before 73 is none', Calc.rmdDivisor(72) === Infinity);
close('rmd divisor 73', Calc.rmdDivisor(73), 26.5, 0.001);
close('rmd divisor 80', Calc.rmdDivisor(80), 20.2, 0.001);
const ssOpts = Calc.socialSecurity(plan());
close('SS lifetime claiming at 70 to 95', ssOpts[2].lifetime, 40000 * 1.24 * 25, 1);
ok('selected claim age marked', ssOpts[1].selected === true);

/* ---------------------------------------------------------------- */
console.log('lifecycle projection (the Phase-6A fixes)');
const proj = Calc.project(plan());
ok('single horizon: rows run age 32→95', proj.rows.length === 64 && proj.rows[63].age === 95 && proj.endAge === 95);
const at61 = proj.rows.find(function (r) { return r.age === 61; });
const at62 = proj.rows.find(function (r) { return r.age === 62; });
const at72 = proj.rows.find(function (r) { return r.age === 72; });
close('saving until retirement (52.8k + 14k match)', at61.totalSaved, 66800, 0.01);
ok('contributions STOP at retirement', at62.totalSaved === 0 && at62.employerMatch === 0);
ok('still no contributions at 72', at72.totalSaved === 0 && at72.employerMatch === 0);
ok('retirement rows are flagged + withdrawing', at72.retired === true && at72.withdrawal > 0);
ok('retirement net worth captured', proj.retirementNetWorth > 0);
ok('default plan lasts to 95', proj.lastsToPlan === true && proj.depleteAge === null);
const broke = Calc.project(plan(function (p) { p.retirement.spending = 500000; }));
ok('half-million spending depletes', broke.lastsToPlan === false && broke.depleteAge > 62 && broke.depleteAge <= 95);
ok('lifetime retirement tax accumulates', proj.lifetimeTax > 0);
ok('legacy alias points at same engine', Calc.retirementProjection === Calc.project);

/* ---------------------------------------------------------------- */
console.log('one stochastic engine (bands + success from same paths)');
const simZero = Calc.simulate(plan(function (p) { p.retirement.spending = 0; }), 40);
ok('zero spending -> 100% success', simZero.successRate === 1);
const simDoom = Calc.simulate(plan(function (p) { p.retirement.spending = 5000000; }), 40);
ok('absurd spending -> 0% success', simDoom.successRate === 0);
const sim = Calc.simulate(plan(), 60);
ok('success rate in [0,1]', sim.successRate >= 0 && sim.successRate <= 1);
ok('bands span the full horizon', sim.bands.p50.length === 64 && sim.years === 63);
ok('band ordering p90 >= p10 at end', sim.finalP90 >= sim.finalP10);
ok('median of endings sorted sanely', sim.p90Ending >= sim.medianEnding && sim.medianEnding >= sim.p10Ending);

/* ---------------------------------------------------------------- */
console.log('persistence');
Persist.saveNow({ income: 123456, onboarded: true });
ok('plan round-trip', Persist.load().income === 123456);
const sc1 = Persist.saveScenario('Test A', { income: 1 });
Persist.saveScenario('Test B', { income: 2 });
ok('scenarios listed', Persist.listScenarios().length === 2);
Persist.deleteScenario(sc1.id);
ok('scenario deleted', Persist.listScenarios().length === 1 && Persist.listScenarios()[0].name === 'Test B');
delete mem['wealthmd_plan'];
mem['wealthmd_onboard'] = JSON.stringify({ done: true, age: 40, retirementAge: 65 });
const migrated = Persist.load();
ok('legacy onboarding key migrates', migrated && migrated.age === 40 && migrated.onboarded === true);

/* ---------------------------------------------------------------- */
console.log('job offer analysis');
const offerState = plan();
const caOffer = { name: 'CA Academic', salary: 350000, bonus: 0, state: 'CA', city: '', matchRateCents: 100, matchCapPct: 4, has457: false, employerType: 'private' };
const txOffer = { name: 'TX Nonprofit', salary: 350000, bonus: 20000, state: 'TX', city: '', matchRateCents: 100, matchCapPct: 4, has457: true, employerType: 'nonprofit' };
const ca = Calc.offerAnalysis(caOffer, offerState);
const tx = Calc.offerAnalysis(txOffer, offerState);
ok('TX beats CA take-home at equal salary', tx.takeHome > ca.takeHome);
ok('TX state tax is zero', tx.tax.state === 0);
ok('CA state tax positive', ca.tax.state > 0);
close('match 100¢/$ up to 4% of 350k', ca.match, 14000, 0.01);
ok('457 space only where offered', ca.space457 === 0 && tx.space457 === Calc.LIMITS.k457);
ok('457 savings positive when space exists', tx.space457Savings > 0);
ok('PSLF needs nonprofit AND loans', tx.pslf === true && ca.pslf === false);
ok('PSLF off when loans disabled', Calc.offerAnalysis(txOffer, plan(function (p) { p.loans.enabled = false; })).pslf === false);
ok('bonus raises year-1 value only', tx.year1Value > tx.realValue && tx.bonusAfterTax < tx.bonus);
const nycOffer = { name: 'NYC', salary: 350000, bonus: 0, state: 'NY', city: 'New York City', matchRateCents: 0, matchCapPct: 0, has457: false, employerType: 'private' };
const nyc = Calc.offerAnalysis(nycOffer, offerState);
ok('city local tax applied to offer', nyc.tax.local > 10000);
ok('real value = take-home + match', Math.abs(ca.realValue - (ca.takeHome + ca.match)) < 0.01);

/* ---------------------------------------------------------------- */
console.log('student loan strategies');
/* IDR monthly at default profile: AGI 322,200 − 1.5×15,650 = 298,725 → 10%/12 */
close('IDR monthly payment', Calc.idrMonthlyPayment(plan()), 2489.38, 1);
const ls = Calc.loanStrategies(plan(function (p) {
  p.loans.pslfMonths = 36; p.loans.refiRate = 5; p.loans.refiTermYears = 10;
}));
ok('four strategies returned', ls.strategies.length === 4);
const refiS = ls.strategies.find(function (s) { return s.key === 'refi'; });
close('refi monthly 220k @5%/10yr', refiS.monthly, 2333.46, 1);
close('refi total paid', refiS.totalPaid, 280015, 200);
const pslfS = ls.strategies.find(function (s) { return s.key === 'pslf'; });
ok('PSLF forgives with residency credit', pslfS.forgiven > 50000);
ok('PSLF forgiveness is tax-free', pslfS.forgivenTax === 0);
ok('PSLF wins with 36 months banked', ls.strategies[ls.bestIdx].key === 'pslf');
ok('PSLF net cost = payments only', Math.abs(pslfS.netCost - pslfS.totalPaid) < 0.01);
const idrS = ls.strategies.find(function (s) { return s.key === 'idr'; });
ok('IDR taxed only if forgiven', idrS.forgiven === 0 ? idrS.forgivenTax === 0 : idrS.forgivenTax > 0);
ok('null when loans disabled', Calc.loanStrategies(plan(function (p) { p.loans.enabled = false; })) === null);
ok('null when balance zero', Calc.loanStrategies(plan(function (p) { p.loans.balance = 0; })) === null);
const tinyPay = Calc.loanStrategies(plan(function (p) { p.loans.payment = 10000; }));
const curS = tinyPay.strategies.find(function (s) { return s.key === 'current'; });
ok('underwater current payment flagged', curS.done === false);

/* ---------------------------------------------------------------- */
console.log('roth conversion plan');
const rp = Calc.rothPlan(plan());
close('fills 22% bracket (103,350 - 25,000)', rp.annualConversion, 78350, 0.01);
ok('conversion window 62→73', rp.windowYears === 11);

/* ---------------------------------------------------------------- */
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exitCode = 1;
