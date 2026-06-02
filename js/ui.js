import { computePosterior, computeFrequentist, ncdf, tailProb, Z_95 } from './stats.js';
import {
  drawPlot,
  drawMultiPlot,
  drawConfidenceDistribution,
  drawConfidenceCurve,
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

const betaSlider = document.getElementById('beta');
const betaNum = document.getElementById('beta-num');
const seSlider = document.getElementById('se');
const seNum = document.getElementById('se-num');
const midSlider = document.getElementById('mid');
const midNum = document.getElementById('mid-num');

const ciLowNum = document.getElementById('ci-low-num');
const ciHighNum = document.getElementById('ci-high-num');
const seRow = document.getElementById('se-row');
const ciRow = document.getElementById('ci-row');
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

// ──────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────
let scale = 'rr';
let axisScale = 'log';               // 'log' | 'rr' — only relevant in RR mode
let inputMode = 'se';
let currentTableData = [];           // [{label, value}, …] for upper section
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
    seRow.hidden = true;
    ciRow.hidden = false;
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
    seRow.hidden = false;
    ciRow.hidden = true;
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
function buildTableData({ beta_user, se, freq, ciLow_user, ciHigh_user, labels, dirLabels, pZero, pMID, confLabels, formatV }) {
  return [
    { label: labels.pointEstimate, value: formatV(beta_user) },
    { label: labels.standardError, value: se.toFixed(3) },
    { label: labels.pValue,        value: fmtP(freq.pValue) },
    { label: labels.ci,            value: '[' + formatV(ciLow_user) + ', ' + formatV(ciHigh_user) + ']' },
    { label: dirLabels.pZero,      value: fmt(pZero, 3) },
    { label: dirLabels.pMID,       value: fmt(pMID, 3) },
    // Same numbers, frequentist labeling — see "Note on equivalence" in Details.
    { label: confLabels.cZero,     value: fmt(pZero, 3) },
    { label: confLabels.cMID,      value: fmt(pMID, 3) },
  ];
}

function renderTable(rows) {
  tableBodyEl.innerHTML = rows
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
    confLabels,
    formatV: s.formatUserValue,
  });
  renderTable(currentTableData);
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
  });

  // Confidence distribution and confidence curve — direction-agnostic
  // visualizations of the same H(θ) function. Args mirror the main plot
  // but drop direction (the CD/CC shapes are symmetric around β̂ and don't
  // depend on which tail is "the desired direction").
  drawConfidenceDistribution(confDistPlotEl, { betaHat: beta_internal, se, mid: mid_internal, scale, axisScale });
  drawConfidenceCurve(confCurvePlotEl, { betaHat: beta_internal, se, mid: mid_internal, scale, axisScale });

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
