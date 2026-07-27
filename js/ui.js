import {
  computePosterior,
  computeFrequentist,
  ncdf,
  tailProb,
  Z_95,
  compatibilityCurveOutputs,
  bootstrapOutputs,
  likelihoodOutputs,
} from './stats.js';
import {
  drawPlot,
  drawMultiPlot,
  drawConfidenceDistribution,
  drawConfidenceCurve,
  drawCompatibilityCurve,
  drawBootstrap,
  drawLikelihood,
  PRIOR_COLORS,
} from './plotting.js';
import {
  tableToTSV,
  tableToCSV,
  copyTextToClipboard,
  downloadBlob,
  renderReportPNG,
} from './export.js';

const fmt = (n, d) => n.toFixed(d);
const fmtP = p => p < 0.001 ? '<0.001' : p > 0.999 ? '>0.999' : p.toFixed(3);
const fmtNeg = n => n < 0 ? '−' + Math.abs(n).toFixed(2) : n.toFixed(2);

// Percent: 0.991 → "99.1%"; 0.0012 → "0.1%"; clamps to 0 / 100.
const fmtPct = p => (100 * p).toFixed(1) + '%';

// Likelihood ratio as "1 : N" — data favor MLE over reference by N to 1.
// LR > 1 never happens at reference points (MLE is the max by definition);
// LR ≈ 1 displayed as "~ 1 : 1".
const fmtLR = lr => {
  if (!Number.isFinite(lr) || lr <= 0) return '—';
  if (lr >= 0.999) return '~ 1 : 1';
  const n = 1 / lr;
  return '1 : ' + (n >= 100 ? Math.round(n) : n.toFixed(1));
};

// s-value (Shannon surprisal in bits): "6.2 bits against".
const fmtSValue = s => Number.isFinite(s) ? s.toFixed(1) + ' bits' : '—';

const REPORT_TITLE = 'Study Estimate Table';
const PRIOR_REPORT_TITLE = 'Prior Sensitivity';

// ──────────────────────────────────────────────────────────────────────────
// SCALE & PRIOR CONFIG
// ──────────────────────────────────────────────────────────────────────────
// `priors` per scale: each entry has a fixed `sd` number. (An earlier
// version supported `sdFn: mid_internal => ...` for MID-aware priors;
// the resolvePriorSD helper still handles that shape if a future prior
// needs to vary with MID.)
const SCALES = {
  linear: {
    beta:  { min: -1,   max: 1.5, step: 0.05, default: 0.4 },
    se:    { min: 0.05, max: 1,   step: 0.05, default: 0.3 },
    mid:   { min: 0.1,  max: 1.5, step: 0.05, default: 0.5 },
    betaName: 'β̂',
    betaSublabel: 'point estimate',
    midName: 'MID',
    midSublabel: 'minimum important difference',
    seModeSublabel: 'standard error',
    ciModeSublabel: '95% confidence interval',
    tableLabels: {
      pointEstimate: 'Point estimate (β̂)',
      standardError: 'Standard error',
      pValue:        'P-value (2-sided)',
      ci:            '95% CI',
    },
    toInternal: v => v,
    toUserScale: v => v,
    formatUserValue: fmtNeg,
    priors: [
      { id: 'flat',     label: 'Flat',                 sd: 100 },
      { id: 'gelman',   label: 'Gelman default',       sd: 0.25 },
      { id: 'weak',     label: 'Weakly informative',   sd: 0.10 },
      { id: 'moderate', label: 'Moderately skeptical', sd: 0.03 },
    ],
  },
  rr: {
    beta:  { min: 0.3,  max: 4,   step: 0.05, default: 0.7 },
    se:    { min: 0.05, max: 1,   step: 0.05, default: 0.15 },
    mid:   { min: 0.3,  max: 3,   step: 0.05, default: 0.8 },
    betaName: 'RR',
    betaSublabel: 'risk ratio',
    midName: 'MID',
    midSublabel: 'minimum important RR',
    seModeSublabel: 'log SE (of log RR)',
    ciModeSublabel: 'RR 95% CI',
    tableLabels: {
      pointEstimate: 'Point estimate (RR)',
      standardError: 'Standard error (log)',
      pValue:        'P-value (2-sided)',
      ci:            '95% CI (RR)',
    },
    toInternal: Math.log,
    toUserScale: Math.exp,
    formatUserValue: v => v.toFixed(2),
    priors: [
      { id: 'flat',     label: 'Flat',                 sd: 100 },
      { id: 'gelman',   label: 'Gelman default',       sd: 2.5 },
      { id: 'weak',     label: 'Weakly informative',   sd: 1.0 },
      { id: 'moderate', label: 'Moderately skeptical', sd: 0.30 },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// DOM REFS
// ──────────────────────────────────────────────────────────────────────────
const plotEl = document.getElementById('plot');
const tableBodyEl = document.getElementById('estimate-table-body');
const altFramingsBodyEl = document.getElementById('alt-framings-body');

const betaSlider = document.getElementById('beta');
const betaNum = document.getElementById('beta-num');
const seSlider = document.getElementById('se');
const seNum = document.getElementById('se-num');
const midSlider = document.getElementById('mid');
const midNum = document.getElementById('mid-num');

const ciLowNum = document.getElementById('ci-low-num');
const ciHighNum = document.getElementById('ci-high-num');
const modeSeBtn = document.getElementById('mode-se');
const modeCiBtn = document.getElementById('mode-ci');
const modeSublabel = document.getElementById('mode-sublabel');

const scaleLinearBtn = document.getElementById('scale-linear');
const scaleRRBtn = document.getElementById('scale-rr');
const betaNameEl = document.getElementById('beta-name');
const betaSublabelEl = document.getElementById('beta-sublabel');
const midNameEl = document.getElementById('mid-name');
const midSublabelEl = document.getElementById('mid-sublabel');

const legendPZeroEl = document.getElementById('legend-p-zero');
const legendPMIDEl = document.getElementById('legend-p-mid');
const legendZeroLineEl = document.getElementById('legend-zero-line');

const priorPlotEl = document.getElementById('prior-plot');
const priorTableBodyEl = document.getElementById('prior-table-body');
const priorThPZeroEl = document.getElementById('prior-th-pzero');
const priorThPMIDEl = document.getElementById('prior-th-pmid');
const priorPlotLegendEl = document.getElementById('prior-plot-legend');

const confDistPlotEl = document.getElementById('confidence-dist-plot');
const confCurvePlotEl = document.getElementById('confidence-curve-plot');

const axisToggleRow = document.getElementById('axis-toggle-row');
const axisLogBtn = document.getElementById('axis-log');
const axisRRBtn = document.getElementById('axis-rr');
const showMidEl = document.getElementById('show-mid');

// Extended frameworks (Compatibility / Bootstrap / Likelihood) — always visible
const compatReadoutsEl = document.getElementById('compat-readouts');
const bootstrapReadoutsEl = document.getElementById('bootstrap-readouts');
const likelihoodReadoutsEl = document.getElementById('likelihood-readouts');
const compatPlotEl = document.getElementById('compat-plot');
const bootstrapPlotEl = document.getElementById('bootstrap-plot');
const likelihoodPlotEl = document.getElementById('likelihood-plot');

// ──────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────
let scale = 'rr';
let axisScale = 'log';               // 'log' | 'rr' — only relevant in RR mode
let showMid = true;                  // whether to draw the MID line on the main posterior plot
let inputMode = 'se';
let currentTableData = [];           // [{label, value}, …] for upper Study Estimate Table (6 Bayesian core rows)
let currentAltFramingsData = [];     // [{label, value}, …] for the "Alternative framings" table below the main plot
let currentMultiPriorData = [];      // [[col0, col1, …], …] for prior section
const selectedPriors = new Set(['flat', 'moderate']);

function currentScale() { return SCALES[scale]; }

// ──────────────────────────────────────────────────────────────────────────
// DIRECTION
// ──────────────────────────────────────────────────────────────────────────
function deriveDirection() {
  if (scale !== 'rr') return 'right';
  const betaUser = parseFloat(betaNum.value);
  if (!Number.isFinite(betaUser)) return 'left';
  if (Math.abs(betaUser - 1) < 1e-9) return 'left';
  return betaUser < 1 ? 'left' : 'right';
}

function deriveDirectionalLabels(direction) {
  if (scale === 'rr') {
    if (direction === 'left') {
      return {
        pZero: 'P(RR < 1 | D)',
        pMID:  'P(RR < MID | D)',
        legendPZero: 'P(RR < 1)',
        legendPMID:  'P(RR < MID)',
        legendZeroLine: 'RR = 1',
        shortPZero: 'P(RR<1)',
        shortPMID:  'P(RR<MID)',
      };
    }
    return {
      pZero: 'P(RR > 1 | D)',
      pMID:  'P(RR > MID | D)',
      legendPZero: 'P(RR > 1)',
      legendPMID:  'P(RR > MID)',
      legendZeroLine: 'RR = 1',
      shortPZero: 'P(RR>1)',
      shortPMID:  'P(RR>MID)',
    };
  }
  return {
    pZero: 'P(θ > 0 | D)',
    pMID:  'P(θ > MID | D)',
    legendPZero: 'P(θ > 0)',
    legendPMID:  'P(θ > MID)',
    legendZeroLine: 'θ = 0',
    shortPZero: 'P(θ>0)',
    shortPMID:  'P(θ>MID)',
  };
}

function computeDirectionalProbs(direction, postMean, postSD, mid_internal) {
  const left0 = ncdf(0, postMean, postSD);
  const leftMID = ncdf(mid_internal, postMean, postSD);
  if (direction === 'left') return { pZero: left0,     pMID: leftMID     };
  return                            { pZero: 1 - left0, pMID: 1 - leftMID };
}

// Confidence-distribution labels — same numbers as the directional P(...|D)
// rows under flat prior, but using "Confidence distribution ..." phrasing for the
// frequentist reader. The MID suffix is appended in update() alongside the
// existing dirLabels.pMID suffix so the two MID rows stay visually parallel.
function deriveConfidenceLabels(direction) {
  if (scale === 'rr') {
    if (direction === 'left') {
      return { cZero: 'Confidence distribution RR < 1', cMID: 'Confidence distribution RR < MID' };
    }
    return { cZero: 'Confidence distribution RR > 1', cMID: 'Confidence distribution RR > MID' };
  }
  return { cZero: 'Confidence distribution θ > 0', cMID: 'Confidence distribution θ > MID' };
}

// ──────────────────────────────────────────────────────────────────────────
// SLIDER ↔ NUMBER BINDING
// ──────────────────────────────────────────────────────────────────────────
function bindSliderAndNumber(slider, num) {
  slider.addEventListener('input', () => {
    num.value = slider.value;
    update();
  });
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (Number.isFinite(v)) slider.value = v;
    update();
  });
}
bindSliderAndNumber(betaSlider, betaNum);
bindSliderAndNumber(seSlider, seNum);
bindSliderAndNumber(midSlider, midNum);

ciLowNum.addEventListener('input', update);
ciHighNum.addEventListener('input', update);

// ──────────────────────────────────────────────────────────────────────────
// PRIOR CHECKBOX WIRING
// ──────────────────────────────────────────────────────────────────────────
['flat', 'gelman', 'weak', 'moderate'].forEach(id => {
  const el = document.getElementById('prior-' + id);
  if (!el) return;
  el.checked = selectedPriors.has(id);
  el.addEventListener('change', () => {
    if (el.checked) selectedPriors.add(id);
    else            selectedPriors.delete(id);
    update();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SCALE TOGGLE
// ──────────────────────────────────────────────────────────────────────────
function configureSlider(slider, num, cfg) {
  slider.min = cfg.min;
  slider.max = cfg.max;
  slider.step = cfg.step;
  slider.value = cfg.default;
  num.value = cfg.default;
}

function applyScale(newScale) {
  scale = newScale;
  const s = currentScale();

  configureSlider(betaSlider, betaNum, s.beta);
  configureSlider(seSlider, seNum, s.se);
  configureSlider(midSlider, midNum, s.mid);

  const beta_internal = s.toInternal(s.beta.default);
  const se = s.se.default;
  ciLowNum.value = s.toUserScale(beta_internal - Z_95 * se).toFixed(3);
  ciHighNum.value = s.toUserScale(beta_internal + Z_95 * se).toFixed(3);

  betaNameEl.textContent = s.betaName;
  betaSublabelEl.textContent = s.betaSublabel;
  midNameEl.textContent = s.midName;
  midSublabelEl.textContent = s.midSublabel;
  modeSublabel.textContent = (inputMode === 'se' ? s.seModeSublabel : s.ciModeSublabel);

  scaleLinearBtn.classList.toggle('is-active', newScale === 'linear');
  scaleLinearBtn.setAttribute('aria-pressed', newScale === 'linear' ? 'true' : 'false');
  scaleRRBtn.classList.toggle('is-active', newScale === 'rr');
  scaleRRBtn.setAttribute('aria-pressed', newScale === 'rr' ? 'true' : 'false');

  // Axis-scale toggle is only relevant in RR mode. Hide in Linear mode and
  // reset to 'log' default so toggling back to RR feels predictable.
  if (newScale === 'rr') {
    axisToggleRow.hidden = false;
  } else {
    axisToggleRow.hidden = true;
    axisScale = 'log';
    axisLogBtn.classList.add('is-active');
    axisLogBtn.setAttribute('aria-pressed', 'true');
    axisRRBtn.classList.remove('is-active');
    axisRRBtn.setAttribute('aria-pressed', 'false');
  }

  update();
}

function setAxisScale(newAxisScale) {
  if (newAxisScale === axisScale) return;
  axisScale = newAxisScale;
  axisLogBtn.classList.toggle('is-active', newAxisScale === 'log');
  axisLogBtn.setAttribute('aria-pressed', newAxisScale === 'log' ? 'true' : 'false');
  axisRRBtn.classList.toggle('is-active', newAxisScale === 'rr');
  axisRRBtn.setAttribute('aria-pressed', newAxisScale === 'rr' ? 'true' : 'false');
  update();
}

axisLogBtn.addEventListener('click', () => setAxisScale('log'));
axisRRBtn.addEventListener('click', () => setAxisScale('rr'));
showMidEl.addEventListener('change', () => { showMid = showMidEl.checked; update(); });

scaleLinearBtn.addEventListener('click', () => { if (scale !== 'linear') applyScale('linear'); });
scaleRRBtn.addEventListener('click',     () => { if (scale !== 'rr')     applyScale('rr');     });

// ──────────────────────────────────────────────────────────────────────────
// SE / CI INPUT MODE TOGGLE
// ──────────────────────────────────────────────────────────────────────────
function setInputMode(mode) {
  if (mode === inputMode) return;
  const s = currentScale();
  const beta_user = parseFloat(betaNum.value);
  const beta_internal = Number.isFinite(beta_user) ? s.toInternal(beta_user) : NaN;

  if (mode === 'ci') {
    const se = parseFloat(seNum.value);
    if (Number.isFinite(beta_internal) && Number.isFinite(se)) {
      ciLowNum.value = s.toUserScale(beta_internal - Z_95 * se).toFixed(3);
      ciHighNum.value = s.toUserScale(beta_internal + Z_95 * se).toFixed(3);
    }
    // Both control rows stay visible; only the inactive set is disabled.
    seSlider.disabled = true;
    seNum.disabled = true;
    ciLowNum.disabled = false;
    ciHighNum.disabled = false;
    modeSublabel.textContent = s.ciModeSublabel;
  } else {
    const lo_user = parseFloat(ciLowNum.value);
    const hi_user = parseFloat(ciHighNum.value);
    if (Number.isFinite(lo_user) && Number.isFinite(hi_user)) {
      const lo = s.toInternal(lo_user);
      const hi = s.toInternal(hi_user);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        const derivedSE = (hi - lo) / (2 * Z_95);
        seNum.value = derivedSE.toFixed(4);
        seSlider.value = derivedSE;
      }
    }
    seSlider.disabled = false;
    seNum.disabled = false;
    ciLowNum.disabled = true;
    ciHighNum.disabled = true;
    modeSublabel.textContent = s.seModeSublabel;
  }

  modeSeBtn.classList.toggle('is-active', mode === 'se');
  modeSeBtn.setAttribute('aria-pressed', mode === 'se' ? 'true' : 'false');
  modeCiBtn.classList.toggle('is-active', mode === 'ci');
  modeCiBtn.setAttribute('aria-pressed', mode === 'ci' ? 'true' : 'false');

  inputMode = mode;
  update();
}

modeSeBtn.addEventListener('click', () => setInputMode('se'));
modeCiBtn.addEventListener('click', () => setInputMode('ci'));

// ──────────────────────────────────────────────────────────────────────────
// READING USER INPUT → INTERNAL SCALE
// ──────────────────────────────────────────────────────────────────────────
function safeToInternal(v) {
  if (!Number.isFinite(v)) return NaN;
  const i = currentScale().toInternal(v);
  return Number.isFinite(i) ? i : NaN;
}

function readBetaInternal() { return safeToInternal(parseFloat(betaNum.value)); }
function readMIDInternal()  { return safeToInternal(parseFloat(midNum.value));  }

function readSE() {
  if (inputMode === 'se') {
    return parseFloat(seNum.value);
  }
  const lo = safeToInternal(parseFloat(ciLowNum.value));
  const hi = safeToInternal(parseFloat(ciHighNum.value));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN;
  return Math.max((hi - lo) / (2 * Z_95), 1e-6);
}

// ──────────────────────────────────────────────────────────────────────────
// UPPER (SINGLE-PRIOR) TABLE
// ──────────────────────────────────────────────────────────────────────────
// Upper Study Estimate Table — Bayesian flat-prior core analysis only (6 rows).
// The alternative-framings restatements (CD, Compatibility, Bootstrap, Likelihood)
// live in a separate table below the main plot via buildAlternativeFramingsRows.
function buildTableData({ beta_user, se, freq, ciLow_user, ciHigh_user, labels, dirLabels, pZero, pMID, formatV }) {
  return [
    { label: labels.pointEstimate, value: formatV(beta_user) },
    { label: labels.standardError, value: se.toFixed(3) },
    { label: labels.pValue,        value: fmtP(freq.pValue) },
    { label: labels.ci,            value: '[' + formatV(ciLow_user) + ', ' + formatV(ciHigh_user) + ']' },
    { label: dirLabels.pZero,      value: fmt(pZero, 3) },
    { label: dirLabels.pMID,       value: fmt(pMID, 3) },
  ];
}

function renderTable(rows) {
  tableBodyEl.innerHTML = rows
    .map(r => `<tr><td>${r.label}</td><td>${r.value}</td></tr>`)
    .join('');
}

function renderAltFramingsTable(rows) {
  altFramingsBodyEl.innerHTML = rows
    .map(r => `<tr><td>${r.label}</td><td>${r.value}</td></tr>`)
    .join('');
}

function updateLegend(dirLabels) {
  legendPZeroEl.textContent = dirLabels.legendPZero;
  legendPMIDEl.textContent = dirLabels.legendPMID;
  legendZeroLineEl.textContent = dirLabels.legendZeroLine;
}

// ──────────────────────────────────────────────────────────────────────────
// PRIOR SENSITIVITY: compute, table, plot, legend
// ──────────────────────────────────────────────────────────────────────────
function resolvePriorSD(prior, mid_internal) {
  if (typeof prior.sdFn === 'function') return prior.sdFn(mid_internal);
  return prior.sd;
}

function computeAllPriorPosteriors(beta_internal, se, mid_internal) {
  const s = currentScale();
  return s.priors
    .filter(p => selectedPriors.has(p.id))
    .map(p => {
      const sd = resolvePriorSD(p, mid_internal);
      const posterior = computePosterior({ betaHat: beta_internal, se, priorSD: sd });
      return { id: p.id, label: p.label, sd, posterior, color: PRIOR_COLORS[p.id] };
    });
}

function buildMultiPriorTableData(priorPosteriors, direction, mid_internal) {
  const s = currentScale();
  return priorPosteriors.map(({ label, sd, posterior }) => {
    const { mean: postMean, sd: postSD } = posterior;
    const { pZero, pMID } = computeDirectionalProbs(direction, postMean, postSD, mid_internal);
    const criLow_user = s.toUserScale(postMean - Z_95 * postSD);
    const criHigh_user = s.toUserScale(postMean + Z_95 * postSD);
    const meanFormatted = s.formatUserValue(s.toUserScale(postMean));
    const criFormatted = '[' + s.formatUserValue(criLow_user) + ', ' + s.formatUserValue(criHigh_user) + ']';
    return [label, sd.toFixed(3), meanFormatted, criFormatted, pZero.toFixed(3), pMID.toFixed(3)];
  });
}

function renderMultiPriorTable(rows, priorPosteriors, dirLabels) {
  priorThPZeroEl.textContent = dirLabels.shortPZero;
  priorThPMIDEl.textContent = dirLabels.shortPMID + ' [MID = ' + currentScale().formatUserValue(parseFloat(midNum.value)) + ']';

  priorTableBodyEl.innerHTML = rows
    .map((row, i) => {
      const color = priorPosteriors[i].color;
      const swatch = `<span class="prior-swatch" style="background:${color}"></span>`;
      return `<tr>
        <td><span class="prior-color-cell">${swatch}${row[0]}</span></td>
        <td>${row[1]}</td>
        <td>${row[2]}</td>
        <td>${row[3]}</td>
        <td>${row[4]}</td>
        <td>${row[5]}</td>
      </tr>`;
    })
    .join('');
}

function renderPriorPlotLegend(priorPosteriors) {
  priorPlotLegendEl.innerHTML = priorPosteriors
    .map(p => `<span class="legend-item"><span class="legend-line" style="border-top-color:${p.color}; border-top-style: solid; border-top-width: 2px;"></span>${p.label}</span>`)
    .join('');
}

// ──────────────────────────────────────────────────────────────────────────
// EXTENDED FRAMEWORK SECTIONS (Compatibility / Bootstrap / Likelihood)
// ──────────────────────────────────────────────────────────────────────────
// Render helpers below are the single point where framework-license
// discipline lives: each section must use framework-appropriate phrasing
// (compatibility / bootstrap / likelihood) and AVOID importing language
// from sibling frameworks (probability / confidence / credible). See
// FRAMEWORKS_TABLE.md for what each framework licenses.

// Helper: format an internal-scale interval as a user-scale "[lo, hi]" string.
function fmtIntervalUser(intervalInternal, s) {
  const [lo, hi] = intervalInternal;
  return '[' + s.formatUserValue(s.toUserScale(lo)) + ', ' + s.formatUserValue(s.toUserScale(hi)) + ']';
}

function renderCompatibilityReadouts(outputs, s, midUserVal) {
  const userLabel = scale === 'rr' ? 'RR' : 'θ';
  const nullLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  const midLabel = `${userLabel} = ${s.formatUserValue(midUserVal)}`;
  const mostCompatUser = s.toUserScale(outputs.most_compatible_value);

  let html = '';
  html += '<dt class="readout-group-label">Most compatible value</dt><dd></dd>';
  html += `<dt>${userLabel}</dt><dd>${s.formatUserValue(mostCompatUser)}</dd>`;

  html += '<dt class="readout-group-label">Point-wise compatibility</dt><dd></dd>';
  html += `<dt>at ${nullLabel}</dt><dd>p = ${fmtP(outputs.compatibility_at_null)} &nbsp; (s ≈ ${fmtSValue(outputs.s_value_null)} against)</dd>`;
  html += `<dt>at MID (${midLabel})</dt><dd>p = ${fmtP(outputs.compatibility_at_mid)} &nbsp; (s ≈ ${fmtSValue(outputs.s_value_mid)} against)</dd>`;

  html += '<dt class="readout-group-label">Nested compatibility intervals</dt><dd></dd>';
  for (const level of [50, 80, 95, 99]) {
    html += `<dt>${level}%</dt><dd>${fmtIntervalUser(outputs.compatibility_intervals[level], s)}</dd>`;
  }

  compatReadoutsEl.innerHTML = html;
}

function renderBootstrapReadouts(outputs, s, midUserVal, direction) {
  const nSims = outputs.draws.length;
  const userLabel = scale === 'rr' ? 'RR' : 'θ';
  const nullLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  const midLabel = `${userLabel} = ${s.formatUserValue(midUserVal)}`;

  // Direction-aware proportion labels: "Below" for protective/positive,
  // "Above" for harmful/right. The numbers are computed as fraction-below
  // by the stats function; we flip via 1 − x in the harmful case.
  const useAbove = direction === 'right';
  const propNull = useAbove ? 1 - outputs.prop_below_null : outputs.prop_below_null;
  const propMid  = useAbove ? 1 - outputs.prop_below_mid  : outputs.prop_below_mid;
  const verbNull = useAbove ? 'above' : 'below';
  const verbMid  = useAbove ? 'above' : 'below';

  // Sanity-check the bootstrap SE matches the input. Display in user scale
  // for protective mode is awkward (SE on log scale doesn't map to "X% of RR")
  // so we show the raw internal-scale value with a small note.
  const seInput = parseFloat(seNum.value);

  let html = '';
  html += `<dt class="readout-group-label">Simulation summary (${nSims.toLocaleString()} draws from Normal(β̂, SE²))</dt><dd></dd>`;
  html += `<dt>Bootstrap SE</dt><dd>${outputs.bootstrap_se.toFixed(3)} <span style="color:var(--ink-faint);font-weight:400">(input SE: ${seInput.toFixed(3)})</span></dd>`;
  html += `<dt>95% percentile interval</dt><dd>${fmtIntervalUser(outputs.percentile_ci_95, s)}</dd>`;

  html += '<dt class="readout-group-label">Proportions of simulated draws</dt><dd></dd>';
  html += `<dt>${verbNull.charAt(0).toUpperCase() + verbNull.slice(1)} ${nullLabel}</dt><dd>${fmtPct(propNull)}</dd>`;
  html += `<dt>${verbMid.charAt(0).toUpperCase() + verbMid.slice(1)} MID (${midLabel})</dt><dd>${fmtPct(propMid)}</dd>`;
  html += `<dt>Within practical-equivalence region</dt><dd>${fmtPct(outputs.prop_in_rope)}</dd>`;
  html += `<dt>In opposite meaningful direction</dt><dd>${fmtPct(outputs.prop_meaningful_opposite)}</dd>`;

  bootstrapReadoutsEl.innerHTML = html;
}

function renderLikelihoodReadouts(outputs, s, midUserVal) {
  const userLabel = scale === 'rr' ? 'RR' : 'θ';
  const nullLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  const midLabel = `${userLabel} = ${s.formatUserValue(midUserVal)}`;
  const mleUser = s.toUserScale(outputs.mle);

  let html = '';
  html += '<dt class="readout-group-label">Maximum likelihood estimate</dt><dd></dd>';
  html += `<dt>MLE (${userLabel})</dt><dd>${s.formatUserValue(mleUser)}</dd>`;

  html += '<dt class="readout-group-label">Likelihood ratios</dt><dd></dd>';
  html += `<dt>LR(${nullLabel} vs MLE)</dt><dd>${fmtLR(outputs.lr_at_null)} &nbsp; <span style="color:var(--ink-faint);font-weight:400">(data favor MLE)</span></dd>`;
  html += `<dt>LR(MID = ${s.formatUserValue(midUserVal)} vs MLE)</dt><dd>${fmtLR(outputs.lr_at_mid)} &nbsp; <span style="color:var(--ink-faint);font-weight:400">(data favor MLE)</span></dd>`;

  html += '<dt class="readout-group-label">Support intervals</dt><dd></dd>';
  html += `<dt>1/8 support interval</dt><dd>${fmtIntervalUser(outputs.support_interval_8, s)}</dd>`;
  html += `<dt>1/32 support interval</dt><dd>${fmtIntervalUser(outputs.support_interval_32, s)}</dd>`;

  likelihoodReadoutsEl.innerHTML = html;
}

// Build the 8 "Alternative framings" rows for the table below the main plot.
// Rows 1–2: Confidence Distribution restatement of the Bayesian P(.) rows
// (numerically identical under flat prior, different vocabulary).
// Rows 3–8: Compatibility / Bootstrap / Likelihood at RR=1 and at MID.
// Bootstrap rows are direction-aware ("below" for protective intervention,
// "above" for harmful). Compatibility and likelihood rows are direction-
// invariant (two-sided p-values; z²-based LRs). This function is the single
// point where these rows' framework-license discipline lives.
function buildAlternativeFramingsRows({ pZero, pMID, confLabels, compatOutputs, bootOutputs, lhOutputs, midUserVal, s, direction }) {
  const userLabel = scale === 'rr' ? 'RR' : 'θ';
  const nullLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  const midSuffix = ` [${userLabel} = ${s.formatUserValue(midUserVal)}]`;
  const useAbove = direction === 'right';
  const propNull = useAbove ? 1 - bootOutputs.prop_below_null : bootOutputs.prop_below_null;
  const propMid  = useAbove ? 1 - bootOutputs.prop_below_mid  : bootOutputs.prop_below_mid;
  const verb = useAbove ? 'above' : 'below';

  return [
    { label: confLabels.cZero, value: fmt(pZero, 3) },
    { label: confLabels.cMID,  value: fmt(pMID, 3) },
    { label: `Compatibility at ${nullLabel}`,
      value: `p = ${fmtP(compatOutputs.compatibility_at_null)} (s ≈ ${fmtSValue(compatOutputs.s_value_null)})` },
    { label: `Compatibility at MID${midSuffix}`,
      value: `p = ${fmtP(compatOutputs.compatibility_at_mid)} (s ≈ ${fmtSValue(compatOutputs.s_value_mid)})` },
    { label: `Bootstrap: % of draws ${verb} ${nullLabel}`,
      value: fmtPct(propNull) },
    { label: `Bootstrap: % of draws ${verb} MID${midSuffix}`,
      value: fmtPct(propMid) },
    { label: `LR(${nullLabel} vs MLE)`,
      value: fmtLR(lhOutputs.lr_at_null) },
    { label: `LR(MID vs MLE)${midSuffix}`,
      value: fmtLR(lhOutputs.lr_at_mid) },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN UPDATE
// ──────────────────────────────────────────────────────────────────────────
function update() {
  const beta_internal = readBetaInternal();
  const mid_internal = readMIDInternal();
  const se = readSE();

  if (!Number.isFinite(beta_internal) || !Number.isFinite(se) || !Number.isFinite(mid_internal)) return;
  if (se <= 0) return;

  // Upper section uses flat prior always (the single-prior "core" view).
  const FLAT_SD = 100;
  const posterior = computePosterior({ betaHat: beta_internal, se, priorSD: FLAT_SD });
  const freq = computeFrequentist({ betaHat: beta_internal, se });
  const { mean: postMean, sd: postSD, isFlat } = posterior;

  const direction = deriveDirection();
  const dirLabels = deriveDirectionalLabels(direction);
  const confLabels = deriveConfidenceLabels(direction);
  const { pZero, pMID } = computeDirectionalProbs(direction, postMean, postSD, mid_internal);

  const midUserVal = parseFloat(midNum.value);
  if (Number.isFinite(midUserVal)) {
    const midSuffix = ` [MID = ${currentScale().formatUserValue(midUserVal)}]`;
    dirLabels.pMID = `${dirLabels.pMID}${midSuffix}`;
    confLabels.cMID = `${confLabels.cMID}${midSuffix}`;
  }

  const s = currentScale();
  let ciLow_user, ciHigh_user;
  if (inputMode === 'ci') {
    ciLow_user = parseFloat(ciLowNum.value);
    ciHigh_user = parseFloat(ciHighNum.value);
  } else {
    ciLow_user = s.toUserScale(freq.ciLow);
    ciHigh_user = s.toUserScale(freq.ciHigh);
  }

  // Extended-framework outputs are computed once and feed both (a) the
  // upper Study Estimate Table (as 6 additional rows: compat/boot/LR at
  // RR=1 and at MID) and (b) the per-framework readouts + plots below.
  const compatOutputs = compatibilityCurveOutputs(beta_internal, se, mid_internal);
  const bootOutputs = bootstrapOutputs(beta_internal, se, mid_internal, 10000);
  const lhOutputs = likelihoodOutputs(beta_internal, se, mid_internal);

  currentTableData = buildTableData({
    beta_user: s.toUserScale(beta_internal),
    se,
    freq,
    ciLow_user,
    ciHigh_user,
    labels: s.tableLabels,
    dirLabels,
    pZero,
    pMID,
    formatV: s.formatUserValue,
  });
  currentAltFramingsData = buildAlternativeFramingsRows({
    pZero, pMID, confLabels, compatOutputs, bootOutputs, lhOutputs, midUserVal, s, direction,
  });
  renderTable(currentTableData);
  renderAltFramingsTable(currentAltFramingsData);
  updateLegend(dirLabels);

  drawPlot(plotEl, {
    beta: beta_internal,
    se,
    mid: mid_internal,
    postMean,
    postSD,
    isFlat,
    tau: FLAT_SD,
    scale,
    direction,
    axisScale,
    showMid,
  });

  // Confidence distribution and confidence curve — direction-agnostic
  // visualizations of the same H(θ) function.
  drawConfidenceDistribution(confDistPlotEl, { betaHat: beta_internal, se, mid: mid_internal, scale, axisScale });
  drawConfidenceCurve(confCurvePlotEl, { betaHat: beta_internal, se, mid: mid_internal, scale, axisScale });

  // Extended-framework sections — always visible. Render helpers enforce
  // framework-specific language discipline (see FRAMEWORKS_TABLE.md).
  renderCompatibilityReadouts(compatOutputs, s, midUserVal);
  renderBootstrapReadouts(bootOutputs, s, midUserVal, direction);
  renderLikelihoodReadouts(lhOutputs, s, midUserVal);

  drawCompatibilityCurve(compatPlotEl, {
    betaHat: beta_internal, se, mid: mid_internal, scale, axisScale,
    compatibilityIntervals: compatOutputs.compatibility_intervals,
  });
  drawBootstrap(bootstrapPlotEl, {
    draws: bootOutputs.draws, mid: mid_internal, scale, axisScale,
  });
  drawLikelihood(likelihoodPlotEl, {
    betaHat: beta_internal, se, mid: mid_internal, scale, axisScale,
  });

  // Lower section: multi-prior sensitivity.
  const priorPosteriors = computeAllPriorPosteriors(beta_internal, se, mid_internal);
  currentMultiPriorData = buildMultiPriorTableData(priorPosteriors, direction, mid_internal);
  renderMultiPriorTable(currentMultiPriorData, priorPosteriors, dirLabels);
  renderPriorPlotLegend(priorPosteriors);

  drawMultiPlot(priorPlotEl, {
    posteriors: priorPosteriors.map(p => ({
      postMean: p.posterior.mean,
      postSD: p.posterior.sd,
      color: p.color,
    })),
    mid: mid_internal,
    scale,
    axisScale,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// EXPORT BUTTONS — UPPER SECTION
// ──────────────────────────────────────────────────────────────────────────
function upperHeadersAndRows() {
  const headers = ['Metric', 'Value'];
  const rows = currentTableData.map(r => [r.label, r.value]);
  return { headers, rows };
}

document.getElementById('btn-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  try {
    const { headers, rows } = upperHeadersAndRows();
    await copyTextToClipboard(tableToTSV(headers, rows));
    btn.textContent = 'Copied!';
  } catch (err) {
    btn.textContent = 'Copy failed';
    console.error(err);
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById('btn-csv').addEventListener('click', () => {
  const { headers, rows } = upperHeadersAndRows();
  const blob = new Blob([tableToCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob('study-estimate-table.csv', blob);
});

document.getElementById('btn-png').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    const { headers, rows } = upperHeadersAndRows();
    const blob = await renderReportPNG({
      title: REPORT_TITLE,
      headers,
      rows,
      plotSvgEl: plotEl,
    });
    downloadBlob('study-estimate-report.png', blob);
    btn.textContent = original;
  } catch (err) {
    console.error(err);
    btn.textContent = 'Render failed';
  } finally {
    btn.disabled = false;
    setTimeout(() => { if (btn.textContent !== original) btn.textContent = original; }, 1500);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// EXPORT BUTTONS — PRIOR SENSITIVITY SECTION
// ──────────────────────────────────────────────────────────────────────────
function priorHeadersAndRows() {
  const dirLabels = deriveDirectionalLabels(deriveDirection());
  const midSuffix = ' [MID=' + currentScale().formatUserValue(parseFloat(midNum.value)) + ']';
  const headers = ['Prior', 'Prior SD', 'Posterior', '95% CrI', dirLabels.shortPZero, dirLabels.shortPMID + midSuffix];
  return { headers, rows: currentMultiPriorData };
}

document.getElementById('btn-prior-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  try {
    const { headers, rows } = priorHeadersAndRows();
    await copyTextToClipboard(tableToTSV(headers, rows));
    btn.textContent = 'Copied!';
  } catch (err) {
    btn.textContent = 'Copy failed';
    console.error(err);
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById('btn-prior-csv').addEventListener('click', () => {
  const { headers, rows } = priorHeadersAndRows();
  const blob = new Blob([tableToCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob('prior-sensitivity.csv', blob);
});

document.getElementById('btn-prior-png').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    const { headers, rows } = priorHeadersAndRows();
    const blob = await renderReportPNG({
      title: PRIOR_REPORT_TITLE,
      headers,
      rows,
      plotSvgEl: priorPlotEl,
    });
    downloadBlob('prior-sensitivity-report.png', blob);
    btn.textContent = original;
  } catch (err) {
    console.error(err);
    btn.textContent = 'Render failed';
  } finally {
    btn.disabled = false;
    setTimeout(() => { if (btn.textContent !== original) btn.textContent = original; }, 1500);
  }
});

// Initialize: applyScale() sets all defaults from the SCALES config and
// triggers the first update.
applyScale('rr');
