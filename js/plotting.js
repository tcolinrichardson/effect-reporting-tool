import { npdf, ncdf } from './stats.js';

const fmtNeg = n => n < 0 ? '−' + Math.abs(n).toFixed(2) : n.toFixed(2);

// Evidence Action brand palette for the multi-prior overlay plot.
export const PRIOR_COLORS = {
  flat:     '#20253a', // ea-ink
  gelman:   '#5e93fb', // ea-stratosphere
  weak:     '#5dd9b3', // ea-green
  moderate: '#feca90', // ea-tangerine
};

// ──────────────────────────────────────────────────────────────────────────
// SHARED AXIS HELPERS
// ──────────────────────────────────────────────────────────────────────────

// Tick-step heuristic. Log axis is symmetric around 0 so coarser steps work;
// RR axis can span wider ranges (e.g., 0.3 to 4) so adapts to range size.
function chooseTickStep(xRange, useRRAxis) {
  if (useRRAxis) {
    return xRange > 4 ? 1 : xRange > 2 ? 0.5 : 0.25;
  }
  return xRange > 2.5 ? 0.5 : 0.25;
}

// Tick label formatter. Three conditions:
//   - useRRAxis: x is already in RR units, just format directly.
//   - scale === 'rr' (log axis): x is in log units, back-transform via exp.
//   - else (linear scale): x is the value directly.
function tickLabelFor(x, scale, useRRAxis) {
  if (useRRAxis) return x.toFixed(2);
  if (scale === 'rr') return Math.exp(x).toFixed(2);
  return Math.abs(x) < 0.001 ? '0' : fmtNeg(x);
}

// Shared SVG fragment: x-axis baseline + tick lines + tick labels.
// Used by all four plot functions to keep axis rendering identical.
function drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis) {
  let svg = '<line x1="' + M.left + '" y1="' + (M.top + IH) + '" x2="' + (M.left + IW) + '" y2="' + (M.top + IH) + '" stroke="#D4D1C7" stroke-width="0.5"/>';
  const xRange = xMax - xMin;
  const tickStep = chooseTickStep(xRange, useRRAxis);
  const tickStart = Math.ceil(xMin / tickStep) * tickStep;
  for (let x = tickStart; x <= xMax + 0.001; x += tickStep) {
    const xp = xS(x);
    svg += '<line x1="' + xp + '" y1="' + (M.top + IH) + '" x2="' + xp + '" y2="' + (M.top + IH + 4) + '" stroke="#D4D1C7" stroke-width="0.5"/>';
    svg += '<text x="' + xp + '" y="' + (M.top + IH + 18) + '" font-size="11" font-family="JetBrains Mono, monospace" fill="#6B6B7B" text-anchor="middle">' + tickLabelFor(x, scale, useRRAxis) + '</text>';
  }
  return svg;
}

// Vertical reference line + top-of-chart label. Shared by zero / MID / β̂ markers.
function refVertical(M, IH, xS, xPos, color, label) {
  const xp = xS(xPos);
  let svg = '<line x1="' + xp + '" y1="' + M.top + '" x2="' + xp + '" y2="' + (M.top + IH) + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="3,3"/>';
  svg += '<text x="' + xp + '" y="' + (M.top - 10) + '" font-size="12" font-family="T-Star Pro, sans-serif" font-weight="500" fill="' + color + '" text-anchor="middle">' + label + '</text>';
  return svg;
}

// xMin/xMax computation depends on whether we're on the log axis or the RR
// axis. Log axis: cover ±4·SE around the mean plus 0 and MID. RR axis: cover
// exp(±4·SE around the mean) plus RR=1 and exp(MID).
function computeBounds(centerInternal, spreadInternal, mid, useRRAxis) {
  if (useRRAxis) {
    let xMin = Math.max(0.01, Math.exp(centerInternal - 4 * spreadInternal));
    let xMax = Math.exp(centerInternal + 4 * spreadInternal);
    const midRR = Math.exp(mid);
    xMin = Math.min(xMin, midRR * 0.85, 0.85);
    xMax = Math.max(xMax, midRR * 1.15, 1.15);
    return { xMin, xMax };
  }
  const xMin = Math.min(centerInternal - 4 * spreadInternal, -0.4, -mid * 0.4);
  const xMax = Math.max(centerInternal + 4 * spreadInternal, mid * 1.4, 0.4);
  return { xMin, xMax };
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN POSTERIOR PLOT
// ──────────────────────────────────────────────────────────────────────────
export function drawPlot(svgEl, { beta, se, mid, postMean, postSD, isFlat, tau, scale = 'linear', direction = 'right', axisScale = 'log', showMid = true }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 24, bottom: 36, left: 30 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  const { xMin, xMax } = computeBounds(postMean, postSD, mid, useRRAxis);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;

  // Density on the chosen axis. The 1/rr factor in the RR-axis branch is the
  // Jacobian from the change-of-variables y = exp(x).
  const densityFn = useRRAxis
    ? rr => npdf(Math.log(rr), postMean, postSD) / rr
    : x  => npdf(x, postMean, postSD);

  // Sample the curve uniformly along the chosen axis.
  const N = 280;
  const post = [];
  for (let i = 0; i <= N; i++) {
    const x = xMin + xRange * i / N;
    post.push({ x, y: densityFn(x) });
  }
  const yMaxRaw = post.reduce((m, p) => Math.max(m, p.y), 0);
  const yMax = yMaxRaw * 1.18;
  const yS = y => M.top + IH - (y / yMax) * IH;

  function shadedRegion(threshold, color, leftward) {
    if (leftward) {
      if (threshold <= xMin) return '';
      const cutX = Math.min(threshold, xMax);
      const pts = post.filter(p => p.x <= cutX);
      if (pts.length === 0) return '';
      const yAtCut = densityFn(cutX);
      const baseY = yS(0);
      let d = 'M ' + xS(pts[0].x) + ' ' + baseY;
      pts.forEach(p => { d += ' L ' + xS(p.x) + ' ' + yS(p.y); });
      d += ' L ' + xS(cutX) + ' ' + yS(yAtCut);
      d += ' L ' + xS(cutX) + ' ' + baseY + ' Z';
      return '<path d="' + d + '" fill="' + color + '"/>';
    }
    if (threshold >= xMax) return '';
    const cutX = Math.max(threshold, xMin);
    const pts = post.filter(p => p.x >= cutX);
    if (pts.length === 0) return '';
    const yAtCut = densityFn(cutX);
    const baseY = yS(0);
    let d = 'M ' + xS(cutX) + ' ' + baseY;
    d += ' L ' + xS(cutX) + ' ' + yS(yAtCut);
    pts.forEach(p => { d += ' L ' + xS(p.x) + ' ' + yS(p.y); });
    d += ' L ' + xS(pts[pts.length - 1].x) + ' ' + baseY + ' Z';
    return '<path d="' + d + '" fill="' + color + '"/>';
  }

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Reference positions in axis coords
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const refBeta = useRRAxis ? Math.exp(beta) : beta;

  const leftward = direction === 'left';
  if (showMid) {
    svg += shadedRegion(refZero, '#9fdfe6', leftward);
    svg += shadedRegion(refMid,  '#05545a', leftward);
  } else {
    svg += shadedRegion(refZero, '#05545a', leftward);
  }

  // Optional prior overlay (when not flat). Prior on log scale is Normal(0, τ²);
  // on RR axis it's log-normal centered at 1, with peak at exp(-τ²).
  if (!isFlat) {
    const priorDensityFn = useRRAxis
      ? rr => npdf(Math.log(rr), 0, tau) / rr
      : x  => npdf(x, 0, tau);
    const priorPeakAt = useRRAxis ? Math.exp(-tau * tau) : 0;
    const priorMaxY = priorDensityFn(priorPeakAt);
    const priorScale = (yMax * 0.45) / priorMaxY;
    let pd = '';
    for (let i = 0; i <= N; i++) {
      const x = xMin + xRange * i / N;
      pd += (i === 0 ? 'M' : 'L') + ' ' + xS(x) + ' ' + yS(priorDensityFn(x) * priorScale) + ' ';
    }
    svg += '<path d="' + pd + '" stroke="#9A9AA8" fill="none" stroke-width="1" stroke-dasharray="4,3"/>';
  }

  // Posterior curve
  let pd = '';
  post.forEach((p, i) => { pd += (i === 0 ? 'M' : 'L') + ' ' + xS(p.x) + ' ' + yS(p.y) + ' '; });
  svg += '<path d="' + pd + '" stroke="#20253a" fill="none" stroke-width="1.5"/>'; // ea-ink posterior

  // Reference verticals: zero (null), MID, β̂
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  if (showMid) svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  // β̂ marker (drawn last so it sits on top)
  const betaUserVal = scale === 'rr' ? Math.exp(beta) : beta;
  const betaLabel = scale === 'rr'
    ? 'RR = ' + betaUserVal.toFixed(2)
    : 'β̂ = ' + fmtNeg(betaUserVal);
  svg += refVertical(M, IH, xS, refBeta, '#5c5161', betaLabel);

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// MULTI-PRIOR OVERLAY PLOT
// ──────────────────────────────────────────────────────────────────────────
export function drawMultiPlot(svgEl, { posteriors, mid, scale = 'linear', axisScale = 'log' }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 24, bottom: 36, left: 30 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  if (posteriors.length === 0) {
    svgEl.innerHTML =
      '<text x="' + (W / 2) + '" y="' + (H / 2) + '" font-family="T-Star Pro, sans-serif" font-style="normal" font-size="14" fill="#9A9AA8" text-anchor="middle">No priors selected</text>';
    return;
  }

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');

  // Bounds = union over all selected posteriors.
  let xMin, xMax;
  if (useRRAxis) {
    const midRR = Math.exp(mid);
    xMin = Math.min(0.85, midRR * 0.85);
    xMax = Math.max(1.15, midRR * 1.15);
    for (const p of posteriors) {
      xMin = Math.min(xMin, Math.max(0.01, Math.exp(p.postMean - 4 * p.postSD)));
      xMax = Math.max(xMax, Math.exp(p.postMean + 4 * p.postSD));
    }
  } else {
    xMin = Math.min(-0.4, -mid * 0.4);
    xMax = Math.max(0.4, mid * 1.4);
    for (const p of posteriors) {
      xMin = Math.min(xMin, p.postMean - 4 * p.postSD);
      xMax = Math.max(xMax, p.postMean + 4 * p.postSD);
    }
  }
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;

  const densityForPost = (p, x) => useRRAxis
    ? npdf(Math.log(x), p.postMean, p.postSD) / x
    : npdf(x, p.postMean, p.postSD);

  // Sample all curves first, compute global y-max across them.
  const N = 280;
  const allSamples = posteriors.map(p => {
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const x = xMin + xRange * i / N;
      samples.push({ x, y: densityForPost(p, x) });
    }
    return { p, samples };
  });
  const yMaxRaw = allSamples.reduce((m, { samples }) =>
    Math.max(m, samples.reduce((mm, s) => Math.max(mm, s.y), 0)), 0);
  const yMax = yMaxRaw * 1.18;
  const yS = y => M.top + IH - (y / yMax) * IH;

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Draw each prior's curve
  for (const { p, samples } of allSamples) {
    let pd = '';
    samples.forEach((s, i) => { pd += (i === 0 ? 'M' : 'L') + ' ' + xS(s.x) + ' ' + yS(s.y) + ' '; });
    svg += '<path d="' + pd + '" stroke="' + p.color + '" fill="none" stroke-width="1.5"/>';
  }

  // Reference verticals (no β̂ marker — multi-prior view doesn't have a single β̂)
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// COMPATIBILITY CURVE (with nested CI bands)
// ──────────────────────────────────────────────────────────────────────────
// Same c(θ) = 2·min(H(θ), 1−H(θ)) curve as drawConfidenceCurve, but with
// nested compatibility-interval bands rendered at the bottom of the chart
// — visualizing the 50/80/95/99% intervals stacked so the reader sees how
// CI width depends on the chosen level. Framework-license note: this is
// a compatibility view, not a CD view — point-wise compatibility, not
// cumulative confidence.
export function drawCompatibilityCurve(svgEl, { betaHat, se, mid, scale = 'linear', axisScale = 'log', compatibilityIntervals = {} }) {
  const W = 720, H = 360; // slightly taller to fit the CI band rail at bottom
  const M = { top: 32, right: 90, bottom: 64, left: 44 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  const { xMin, xMax } = computeBounds(betaHat, se, mid, useRRAxis);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;
  const yS = y => M.top + IH - y * IH;

  const ccFn = useRRAxis
    ? rr => { const h = ncdf(Math.log(rr), betaHat, se); return 2 * Math.min(h, 1 - h); }
    : x  => { const h = ncdf(x, betaHat, se);            return 2 * Math.min(h, 1 - h); };

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Y axis ticks
  [0, 0.25, 0.5, 0.75, 1].forEach(y => {
    const yp = yS(y);
    svg += '<line x1="' + (M.left - 4) + '" y1="' + yp + '" x2="' + M.left + '" y2="' + yp + '" stroke="#D4D1C7" stroke-width="0.5"/>';
    svg += '<text x="' + (M.left - 7) + '" y="' + (yp + 4) + '" font-size="10" font-family="JetBrains Mono, monospace" fill="#6B6B7B" text-anchor="end">' + y.toFixed(2) + '</text>';
  });
  const yTitleX = M.left - 32, yTitleY = M.top + IH / 2;
  svg += '<text x="' + yTitleX + '" y="' + yTitleY + '" font-size="11" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="middle" transform="rotate(-90 ' + yTitleX + ' ' + yTitleY + ')">compatibility</text>';

  // Horizontal references at p = 0.05 and p = 0.50
  const hRefs = [
    { y: 0.05, label: 'p = 0.05' },
    { y: 0.5,  label: 'p = 0.50' },
  ];
  for (const r of hRefs) {
    const yp = yS(r.y);
    svg += '<line x1="' + M.left + '" y1="' + yp + '" x2="' + (M.left + IW) + '" y2="' + yp + '" stroke="#9A9AA8" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg += '<text x="' + (M.left + IW + 4) + '" y="' + (yp + 3) + '" font-size="10" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="start">' + r.label + '</text>';
  }

  // Curve
  const N = 280;
  let pd = '';
  for (let i = 0; i <= N; i++) {
    const x = xMin + xRange * i / N;
    pd += (i === 0 ? 'M' : 'L') + ' ' + xS(x) + ' ' + yS(ccFn(x)) + ' ';
  }
  svg += '<path d="' + pd + '" stroke="#20253a" fill="none" stroke-width="1.5"/>';

  // Vertical refs at 0/RR=1 and MID
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  // Nested compatibility-interval bands at bottom of chart.
  // Stack four short horizontal bars, narrowest (50%) on top, widest (99%) on bottom.
  // The visual point: "the 95% CI is this long; the 50% CI is much shorter."
  const bandRailY = M.top + IH + 24;  // below the x-axis tick labels
  const bandRowH = 7;
  const bandLevels = [50, 80, 95, 99]; // narrowest first → widest last (visually stacked downward)
  const bandColors = { 50: '#5c5161', 80: '#5e93fb', 95: '#05545a', 99: '#e600a0' };
  bandLevels.forEach((level, idx) => {
    const interval = compatibilityIntervals[level];
    if (!interval) return;
    const [lo, hi] = useRRAxis
      ? [Math.exp(interval[0]), Math.exp(interval[1])]
      : interval;
    const bandY = bandRailY + idx * bandRowH;
    const x1 = xS(Math.max(lo, xMin));
    const x2 = xS(Math.min(hi, xMax));
    svg += '<line x1="' + x1 + '" y1="' + bandY + '" x2="' + x2 + '" y2="' + bandY + '" stroke="' + bandColors[level] + '" stroke-width="3" stroke-linecap="butt"/>';
    svg += '<text x="' + (M.left + IW + 4) + '" y="' + (bandY + 3) + '" font-size="9" font-family="T-Star Pro, sans-serif" fill="' + bandColors[level] + '" text-anchor="start">' + level + '% CI</text>';
  });

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// BOOTSTRAP HISTOGRAM
// ──────────────────────────────────────────────────────────────────────────
// Histogram of parametric-simulation draws. The bins are visibly rectangular
// (not a smoothed density) so the reader sees this as "resamples" not as a
// continuous distribution.
export function drawBootstrap(svgEl, { draws, mid, scale = 'linear', axisScale = 'log' }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 24, bottom: 36, left: 30 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  if (!draws || draws.length === 0) {
    svgEl.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" font-family="T-Star Pro, sans-serif" font-size="14" fill="#9A9AA8" text-anchor="middle">No draws</text>';
    return;
  }

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  // Transform draws to user axis if needed (draws are stored on internal/log scale)
  const drawsForAxis = useRRAxis ? draws.map(d => Math.exp(d)) : draws;

  // Bounds: empirical 2nd/98th percentile of the visible draws plus reference points.
  // Avoids extreme tails dominating the visible range.
  const sorted = [...drawsForAxis].sort((a, b) => a - b);
  const p02 = sorted[Math.floor(0.02 * sorted.length)];
  const p98 = sorted[Math.floor(0.98 * sorted.length)];
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  let xMin = Math.min(p02, refZero * 0.9, refMid * 0.9);
  let xMax = Math.max(p98, refZero * 1.1, refMid * 1.1);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;

  // Bin draws
  const NBINS = 40;
  const binWidth = xRange / NBINS;
  const counts = new Array(NBINS).fill(0);
  for (const d of drawsForAxis) {
    if (d < xMin || d > xMax) continue;
    const idx = Math.min(NBINS - 1, Math.max(0, Math.floor((d - xMin) / binWidth)));
    counts[idx]++;
  }
  const maxCount = counts.reduce((a, b) => Math.max(a, b), 1);
  const yS = c => M.top + IH - (c / maxCount) * IH;

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Histogram bars
  for (let i = 0; i < NBINS; i++) {
    if (counts[i] === 0) continue;
    const x0 = xS(xMin + i * binWidth);
    const x1 = xS(xMin + (i + 1) * binWidth);
    const y0 = yS(counts[i]);
    const y1 = M.top + IH;
    svg += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0 - 0.5) + '" height="' + (y1 - y0) + '" fill="#20253a" opacity="0.78"/>';
  }

  // Vertical references at 0/RR=1 and MID
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// LIKELIHOOD CURVE
// ──────────────────────────────────────────────────────────────────────────
// L(θ) ∝ exp(-(θ-β̂)²/(2·SE²)), normalized so peak = 1. Horizontal references
// at L/L_max = 1/8 and 1/32 — curve crossings give the support intervals.
export function drawLikelihood(svgEl, { betaHat, se, mid, scale = 'linear', axisScale = 'log' }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 80, bottom: 36, left: 44 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  const { xMin, xMax } = computeBounds(betaHat, se, mid, useRRAxis);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;
  const yS = y => M.top + IH - y * IH;

  // Normalized likelihood: L(θ)/L(β̂) = exp(-(θ-β̂)²/(2·SE²))
  // On RR axis: evaluate at θ = log(rr); the likelihood is not a density,
  // so no Jacobian — just evaluate the function at the displayed rr.
  const lhFn = useRRAxis
    ? rr => { const z = (Math.log(rr) - betaHat) / se; return Math.exp(-(z * z) / 2); }
    : x  => { const z = (x - betaHat) / se;            return Math.exp(-(z * z) / 2); };

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Y axis ticks at 0, 0.25, 0.5, 0.75, 1
  [0, 0.25, 0.5, 0.75, 1].forEach(y => {
    const yp = yS(y);
    svg += '<line x1="' + (M.left - 4) + '" y1="' + yp + '" x2="' + M.left + '" y2="' + yp + '" stroke="#D4D1C7" stroke-width="0.5"/>';
    svg += '<text x="' + (M.left - 7) + '" y="' + (yp + 4) + '" font-size="10" font-family="JetBrains Mono, monospace" fill="#6B6B7B" text-anchor="end">' + y.toFixed(2) + '</text>';
  });
  const yTitleX = M.left - 32, yTitleY = M.top + IH / 2;
  svg += '<text x="' + yTitleX + '" y="' + yTitleY + '" font-size="11" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="middle" transform="rotate(-90 ' + yTitleX + ' ' + yTitleY + ')">L / L_max</text>';

  // Horizontal references at L/L_max = 1/8 and 1/32 (Royall's evidential levels)
  const hRefs = [
    { y: 1 / 8,  label: '1/8' },
    { y: 1 / 32, label: '1/32' },
  ];
  for (const r of hRefs) {
    const yp = yS(r.y);
    svg += '<line x1="' + M.left + '" y1="' + yp + '" x2="' + (M.left + IW) + '" y2="' + yp + '" stroke="#9A9AA8" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg += '<text x="' + (M.left + IW + 4) + '" y="' + (yp + 3) + '" font-size="10" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="start">' + r.label + '</text>';
  }

  // Likelihood curve
  const N = 280;
  let pd = '';
  for (let i = 0; i <= N; i++) {
    const x = xMin + xRange * i / N;
    pd += (i === 0 ? 'M' : 'L') + ' ' + xS(x) + ' ' + yS(lhFn(x)) + ' ';
  }
  svg += '<path d="' + pd + '" stroke="#20253a" fill="none" stroke-width="1.5"/>';

  // Vertical references at 0/RR=1 and MID
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// CONFIDENCE DISTRIBUTION (CDF)
// ──────────────────────────────────────────────────────────────────────────
// H(x) = Φ((x − β̂)/SE) on log axis; H(rr) = Φ((log(rr) − β̂)/SE) on RR axis.
export function drawConfidenceDistribution(svgEl, { betaHat, se, mid, scale = 'linear', axisScale = 'log' }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 60, bottom: 36, left: 44 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  const { xMin, xMax } = computeBounds(betaHat, se, mid, useRRAxis);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;
  const yS = y => M.top + IH - y * IH;

  const cdfFn = useRRAxis
    ? rr => ncdf(Math.log(rr), betaHat, se)
    : x  => ncdf(x, betaHat, se);

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Y axis ticks at 0, 0.25, 0.5, 0.75, 1
  [0, 0.25, 0.5, 0.75, 1].forEach(y => {
    const yp = yS(y);
    svg += '<line x1="' + (M.left - 4) + '" y1="' + yp + '" x2="' + M.left + '" y2="' + yp + '" stroke="#D4D1C7" stroke-width="0.5"/>';
    svg += '<text x="' + (M.left - 7) + '" y="' + (yp + 4) + '" font-size="10" font-family="JetBrains Mono, monospace" fill="#6B6B7B" text-anchor="end">' + y.toFixed(2) + '</text>';
  });
  // Y-axis title
  const yTitleX = M.left - 32;
  const yTitleY = M.top + IH / 2;
  svg += '<text x="' + yTitleX + '" y="' + yTitleY + '" font-size="11" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="middle" transform="rotate(-90 ' + yTitleX + ' ' + yTitleY + ')">H(θ)</text>';

  // Horizontal reference lines
  const hRefs = [
    { y: 0.025, label: '2.5%' },
    { y: 0.5,   label: 'median' },
    { y: 0.975, label: '97.5%' },
  ];
  for (const r of hRefs) {
    const yp = yS(r.y);
    svg += '<line x1="' + M.left + '" y1="' + yp + '" x2="' + (M.left + IW) + '" y2="' + yp + '" stroke="#9A9AA8" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg += '<text x="' + (M.left + IW + 4) + '" y="' + (yp + 3) + '" font-size="10" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="start">' + r.label + '</text>';
  }

  // CD curve
  const N = 280;
  let pd = '';
  for (let i = 0; i <= N; i++) {
    const x = xMin + xRange * i / N;
    pd += (i === 0 ? 'M' : 'L') + ' ' + xS(x) + ' ' + yS(cdfFn(x)) + ' ';
  }
  svg += '<path d="' + pd + '" stroke="#20253a" fill="none" stroke-width="1.5"/>';

  // Reference verticals
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  svgEl.innerHTML = svg;
}

// ──────────────────────────────────────────────────────────────────────────
// CONFIDENCE CURVE (p-value function)
// ──────────────────────────────────────────────────────────────────────────
// c(x) = 2·min(H(x), 1−H(x)). Same evaluation, peaked at H = 0.5 (i.e. at β̂).
export function drawConfidenceCurve(svgEl, { betaHat, se, mid, scale = 'linear', axisScale = 'log' }) {
  const W = 720, H = 340;
  const M = { top: 32, right: 90, bottom: 36, left: 44 };
  const IW = W - M.left - M.right;
  const IH = H - M.top - M.bottom;

  const useRRAxis = (scale === 'rr' && axisScale === 'rr');
  const { xMin, xMax } = computeBounds(betaHat, se, mid, useRRAxis);
  const xRange = xMax - xMin;
  const xS = x => M.left + (x - xMin) / xRange * IW;
  const yS = y => M.top + IH - y * IH;

  const ccFn = useRRAxis
    ? rr => { const h = ncdf(Math.log(rr), betaHat, se); return 2 * Math.min(h, 1 - h); }
    : x  => { const h = ncdf(x, betaHat, se);            return 2 * Math.min(h, 1 - h); };

  let svg = drawXAxis(M, IW, IH, xS, xMin, xMax, scale, useRRAxis);

  // Y axis ticks
  [0, 0.25, 0.5, 0.75, 1].forEach(y => {
    const yp = yS(y);
    svg += '<line x1="' + (M.left - 4) + '" y1="' + yp + '" x2="' + M.left + '" y2="' + yp + '" stroke="#D4D1C7" stroke-width="0.5"/>';
    svg += '<text x="' + (M.left - 7) + '" y="' + (yp + 4) + '" font-size="10" font-family="JetBrains Mono, monospace" fill="#6B6B7B" text-anchor="end">' + y.toFixed(2) + '</text>';
  });
  // Y-axis title
  const yTitleX = M.left - 32;
  const yTitleY = M.top + IH / 2;
  svg += '<text x="' + yTitleX + '" y="' + yTitleY + '" font-size="11" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="middle" transform="rotate(-90 ' + yTitleX + ' ' + yTitleY + ')">c(θ)</text>';

  // Horizontal reference lines at c = 0.05 (95% CI) and c = 0.50 (50% CI)
  const hRefs = [
    { y: 0.05, label: '5% (95% CI)' },
    { y: 0.5,  label: '50% (50% CI)' },
  ];
  for (const r of hRefs) {
    const yp = yS(r.y);
    svg += '<line x1="' + M.left + '" y1="' + yp + '" x2="' + (M.left + IW) + '" y2="' + yp + '" stroke="#9A9AA8" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg += '<text x="' + (M.left + IW + 4) + '" y="' + (yp + 3) + '" font-size="10" font-family="T-Star Pro, sans-serif" fill="#6B6B7B" text-anchor="start">' + r.label + '</text>';
  }

  // CC curve
  const N = 280;
  let pd = '';
  for (let i = 0; i <= N; i++) {
    const x = xMin + xRange * i / N;
    pd += (i === 0 ? 'M' : 'L') + ' ' + xS(x) + ' ' + yS(ccFn(x)) + ' ';
  }
  svg += '<path d="' + pd + '" stroke="#20253a" fill="none" stroke-width="1.5"/>';

  // Reference verticals
  const refZero = useRRAxis ? 1 : 0;
  const refMid  = useRRAxis ? Math.exp(mid) : mid;
  const zeroLabel = scale === 'rr' ? 'RR = 1' : 'θ = 0';
  svg += refVertical(M, IH, xS, refZero, '#20253a', zeroLabel);
  svg += refVertical(M, IH, xS, refMid, '#e600a0', 'MID');

  svgEl.innerHTML = svg;
}
