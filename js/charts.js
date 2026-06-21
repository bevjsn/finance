/* WealthMD — Chart setup & rendering (charts.js)
 * Wraps Chart.js v4. Exposes a global `Charts` object.
 */
(function (global) {
  'use strict';

  const FONT = "'Inter', system-ui, sans-serif";
  const GRID = 'rgba(148,163,184,0.10)';
  const TICK = '#64748b';
  const INDIGO = '#3b82f6';   // primary blue accent
  const BLUE_LT = '#60a5fa';  // lighter blue for band edges
  const GREEN = '#22c55e';
  const RED = '#ef4444';
  const PURPLE = '#a855f7';   // reserved for the Employer Match cash-flow category
  const AMBER = '#f59e0b';

  const charts = {};

  function fmtAxis(v) {
    const abs = Math.abs(v);
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }
  function fmtMoney(v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  if (global.Chart) {
    Chart.defaults.color = TICK;
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 11;
  }

  const baseScales = function (extra) {
    return Object.assign({
      x: { grid: { color: GRID, drawBorder: false }, ticks: { color: TICK, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { grid: { color: GRID, drawBorder: false }, ticks: { color: TICK, callback: function (v) { return fmtAxis(v); } } }
    }, extra || {});
  };

  const tooltip = {
    backgroundColor: '#0a0f1e',
    borderColor: 'rgba(59,130,246,0.4)',
    borderWidth: 1,
    titleColor: '#e2e8f0',
    bodyColor: '#cbd5e1',
    padding: 10,
    callbacks: {
      label: function (ctx) {
        const label = ctx.dataset.label || '';
        return label + ': ' + fmtMoney(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed.x);
      }
    }
  };

  /* Plugin: amber dashed vertical line at retirement year with a badge */
  const retirementLinePlugin = {
    id: 'retirementLine',
    afterDraw: function (chart, args, opts) {
      const cfg = chart.config.options.plugins.retirementLine;
      if (!cfg || cfg.index == null || cfg.index < 0) return;
      const xScale = chart.scales.x;
      const yArea = chart.chartArea;
      const x = xScale.getPixelForValue(cfg.index);
      if (x == null || isNaN(x)) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = AMBER;
      ctx.moveTo(x, yArea.top);
      ctx.lineTo(x, yArea.bottom);
      ctx.stroke();
      // badge
      ctx.setLineDash([]);
      const text = cfg.label || 'Retirement';
      ctx.font = '600 10px ' + FONT;
      const tw = ctx.measureText(text).width;
      const padX = 6, bh = 18;
      let bx = x - (tw + padX * 2) / 2;
      bx = Math.max(yArea.left, Math.min(bx, yArea.right - (tw + padX * 2)));
      ctx.fillStyle = AMBER;
      const by = yArea.top + 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw + padX * 2, bh, 4); ctx.fill(); }
      else { ctx.fillRect(bx, by, tw + padX * 2, bh); }
      ctx.fillStyle = '#0a0f1e';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + padX, by + bh / 2);
      ctx.restore();
    }
  };
  if (global.Chart) Chart.register(retirementLinePlugin);

  function destroy(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  /* ---- Net Worth Projection ------------------------------------------- */
  function netWorth(canvasId, proj, retirementIndex) {
    const labels = proj.rows.map(function (r) { return 'Age ' + r.age; });
    const data = {
      labels: labels,
      datasets: [
        {
          label: 'Net Worth', data: proj.rows.map(function (r) { return r.netWorth; }),
          borderColor: INDIGO, backgroundColor: 'rgba(59,130,246,0.18)', fill: true,
          tension: 0.3, pointRadius: 0, borderWidth: 2
        },
        {
          label: 'Total Assets', data: proj.rows.map(function (r) { return r.totalAssets; }),
          borderColor: GREEN, backgroundColor: 'rgba(34,197,94,0.06)', fill: true,
          borderDash: [6, 4], tension: 0.3, pointRadius: 0, borderWidth: 1.5
        },
        {
          label: 'Loan Balance', data: proj.rows.map(function (r) { return r.loanBalance; }),
          borderColor: RED, backgroundColor: 'transparent', fill: false,
          tension: 0.2, pointRadius: 0, borderWidth: 1.5
        }
      ]
    };
    render('netWorth', canvasId, 'line', data, {
      scales: baseScales(),
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: '#94a3b8' }, position: 'bottom' },
        tooltip: tooltip,
        retirementLine: { index: retirementIndex, label: 'Retirement' }
      }
    });
  }

  /* ---- Monte Carlo ----------------------------------------------------- */
  function monteCarlo(canvasId, mc, ages, retirementIndex) {
    const labels = ages.map(function (a) { return 'Age ' + a; });
    // Datasets ordered high -> low so fill:'+1' shades the band down to the
    // next (lower) percentile line.
    const data = {
      labels: labels,
      datasets: [
        { label: 'P90', data: mc.bands.p90, borderColor: '#60a5fa', backgroundColor: 'rgba(59,130,246,0.10)', fill: '+1', tension: 0.25, pointRadius: 0, borderWidth: 1 },
        { label: 'P75', data: mc.bands.p75, borderColor: 'rgba(96,165,250,0.6)', backgroundColor: 'rgba(59,130,246,0.16)', fill: '+1', tension: 0.25, pointRadius: 0, borderWidth: 1 },
        { label: 'P50', data: mc.bands.p50, borderColor: INDIGO, backgroundColor: 'rgba(59,130,246,0.16)', fill: '+1', tension: 0.25, pointRadius: 0, borderWidth: 2 },
        { label: 'P25', data: mc.bands.p25, borderColor: 'rgba(96,165,250,0.6)', backgroundColor: 'rgba(59,130,246,0.10)', fill: '+1', tension: 0.25, pointRadius: 0, borderWidth: 1 },
        { label: 'P10', data: mc.bands.p10, borderColor: '#60a5fa', backgroundColor: 'transparent', fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1 }
      ]
    };
    render('monteCarlo', canvasId, 'line', data, {
      scales: baseScales(),
      plugins: {
        legend: { display: false },
        tooltip: tooltip,
        retirementLine: { index: retirementIndex, label: 'Retirement' }
      }
    });
  }

  /* ---- Portfolio by bucket (stacked area) ------------------------------ */
  function portfolio(canvasId, proj) {
    const labels = proj.rows.map(function (r) { return 'Age ' + r.age; });
    const colors = {
      trad401k: '#2563eb', roth401k: '#60a5fa', plan457: '#22c55e',
      rothIra: '#14b8a6', hsa: '#eab308', taxable: '#f97316', cash: '#64748b'
    };
    const datasets = Calc.BUCKETS.map(function (b) {
      return {
        label: b.label, data: proj.rows.map(function (r) { return r.buckets[b.key]; }),
        borderColor: colors[b.key], backgroundColor: colors[b.key] + '55',
        fill: true, stack: 'portfolio', tension: 0.3, pointRadius: 0, borderWidth: 1
      };
    });
    render('portfolio', canvasId, 'line', { labels: labels, datasets: datasets }, {
      scales: baseScales({ y: { stacked: true, grid: { color: GRID }, ticks: { color: TICK, callback: function (v) { return fmtAxis(v); } } } }),
      plugins: {
        legend: { labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, color: '#94a3b8', font: { size: 10 } }, position: 'bottom' },
        tooltip: tooltip,
        retirementLine: { index: -1 }
      }
    });
  }

  /* ---- Tax breakdown donut -------------------------------------------- */
  function taxDonut(canvasId, tax) {
    const data = {
      labels: ['Federal', 'FICA', 'State', 'Local', 'Take-Home'],
      datasets: [{
        data: [tax.federal, tax.fica, tax.state, tax.local, tax.takeHome],
        backgroundColor: [RED, '#fb7185', AMBER, '#f97316', GREEN],
        borderColor: '#111827', borderWidth: 2, hoverOffset: 4
      }]
    };
    render('taxDonut', canvasId, 'doughnut', data, {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: Object.assign({}, tooltip, { callbacks: { label: function (ctx) { return ctx.label + ': ' + fmtMoney(ctx.parsed); } } }),
        retirementLine: { index: -1 }
      }
    });
  }

  /* ---- Annual cash flow (horizontal stacked bar) ----------------------- */
  function cashFlow(canvasId, flow) {
    const data = {
      labels: ['Annual'],
      datasets: [
        { label: 'Taxes', data: [flow.taxes], backgroundColor: RED },
        { label: 'Your Savings', data: [flow.savings], backgroundColor: INDIGO },
        { label: 'Employer Match', data: [flow.match], backgroundColor: PURPLE },
        { label: 'Loan Payment', data: [flow.loan], backgroundColor: AMBER },
        { label: 'Spending', data: [flow.spending], backgroundColor: GREEN }
      ]
    };
    render('cashFlow', canvasId, 'bar', data, {
      indexAxis: 'y',
      scales: {
        x: { stacked: true, grid: { color: GRID }, ticks: { color: TICK, callback: function (v) { return fmtAxis(v); } } },
        y: { stacked: true, grid: { display: false }, ticks: { color: TICK } }
      },
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: '#94a3b8' }, position: 'bottom' },
        tooltip: tooltip,
        retirementLine: { index: -1 }
      }
    });
  }

  function render(key, canvasId, type, data, options) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const baseOptions = {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 250 }
    };
    const opts = Object.assign(baseOptions, options);
    if (charts[key]) {
      charts[key].data = data;
      charts[key].options = opts;
      charts[key].update();
    } else {
      charts[key] = new Chart(el.getContext('2d'), { type: type, data: data, options: opts });
    }
  }

  global.Charts = {
    netWorth: netWorth,
    monteCarlo: monteCarlo,
    portfolio: portfolio,
    taxDonut: taxDonut,
    cashFlow: cashFlow,
    fmtMoney: fmtMoney,
    fmtAxis: fmtAxis,
    destroy: destroy
  };
})(typeof window !== 'undefined' ? window : this);
