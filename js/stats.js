// Statistical primitives and higher-level functions for the Bayesian effect reporting tool.
// Pure functions only — no DOM access. Importable from browser modules and (later) Node tests.

export const FLAT = 4.5;
// Normal-distribution quantile for two-sided 95% intervals.
// CI half-width = Z_95 × SE; SE = (CI high − CI low) / (2 × Z_95).
export const Z_95 = 1.96;

// Abramowitz & Stegun 7.1.26 — accurate to ~1.5e-7, sufficient for 3-decimal probabilities.
export function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export const ncdf = (x, mu, sd) => 0.5 * (1 + erf((x - mu) / (sd * Math.sqrt(2))));
export const npdf = (x, mu, sd) => Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) / (sd * Math.sqrt(2 * Math.PI));

// Normal × Normal conjugate posterior with prior mean = 0.
// When priorSD ≥ FLAT, take the flat-prior shortcut: posterior collapses to the likelihood.
export function computePosterior({ betaHat, se, priorSD }) {
  const isFlat = priorSD >= FLAT;
  if (isFlat) {
    return { mean: betaHat, sd: se, isFlat: true };
  }
  const tSq = priorSD * priorSD;
  const sSq = se * se;
  const variance = 1 / (1 / tSq + 1 / sSq);
  const mean = variance * (betaHat / sSq);
  return { mean, sd: Math.sqrt(variance), isFlat: false };
}

export function computeFrequentist({ betaHat, se }) {
  const t = betaHat / se;
  const pValue = 2 * (1 - ncdf(Math.abs(t), 0, 1));
  const ciLow = betaHat - Z_95 * se;
  const ciHigh = betaHat + Z_95 * se;
  const mde = 2.8 * se;
  return { t, pValue, ciLow, ciHigh, mde };
}

export const tailProb = ({ threshold, mean, sd }) => 1 - ncdf(threshold, mean, sd);

// ──────────────────────────────────────────────────────────────────────────
// FIVE-FRAMEWORK OUTPUTS (Compatibility / Bootstrap / Likelihood)
// ──────────────────────────────────────────────────────────────────────────
// All three are evaluated on the analysis scale (log for RR mode); the
// rendering layer handles back-transformation for display. See
// FRAMEWORKS_TABLE.md for the constraint on what each framework licenses.

// Standard one-tailed Normal quantiles for two-sided CI half-widths.
// E.g., for a 95% CI, half-width = Z_LEVELS[95] × SE.
const Z_LEVELS = { 50: 0.6745, 80: 1.2816, 95: 1.96, 99: 2.5758 };

// Compatibility curve framework. Reports point-wise p-values at reference
// values plus nested compatibility intervals at standard levels.
// Does NOT compute cumulative probabilities — that's a different framework.
export function compatibilityCurveOutputs(betaHat, se, mid) {
  const pAt = threshold => 2 * (1 - ncdf(Math.abs(betaHat - threshold) / se, 0, 1));
  const compatibility_at_null = pAt(0);
  const compatibility_at_mid = pAt(mid);
  const compatibility_intervals = {};
  for (const [level, z] of Object.entries(Z_LEVELS)) {
    compatibility_intervals[level] = [betaHat - z * se, betaHat + z * se];
  }
  return {
    most_compatible_value: betaHat,
    compatibility_at_null,
    compatibility_at_mid,
    s_value_null: -Math.log2(compatibility_at_null),
    s_value_mid:  -Math.log2(compatibility_at_mid),
    compatibility_intervals,
  };
}

// Bootstrap framework. Under Gaussian likelihood this is parametric
// simulation from Normal(β̂, SE²) — numerically equivalent to nonparametric
// bootstrap on the original data, but we don't have the original data
// (we take β̂ and SE as inputs). The rendering layer is responsible for
// honestly labeling this as simulation from the asymptotic distribution.
//
// Box-Muller pairs are generated inline so we have no external RNG dep;
// Math.random() is unseeded so tests use loose tolerances.
export function bootstrapOutputs(betaHat, se, mid, n_sims = 10000) {
  const draws = new Array(n_sims);
  for (let i = 0; i < n_sims; i += 2) {
    const u1 = Math.random() || 1e-12; // guard against log(0)
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    draws[i] = betaHat + se * r * Math.cos(theta);
    if (i + 1 < n_sims) {
      draws[i + 1] = betaHat + se * r * Math.sin(theta);
    }
  }

  const absMid = Math.abs(mid);
  let belowNull = 0, belowMid = 0, inRope = 0, oppositeMeaningful = 0;
  let sum = 0;
  for (const d of draws) {
    sum += d;
    if (d < 0) belowNull++;
    if (d < mid) belowMid++;
    if (d > -absMid && d < absMid) inRope++;
    if (d < -absMid) oppositeMeaningful++;
  }
  const mean = sum / n_sims;
  let sqDev = 0;
  for (const d of draws) sqDev += (d - mean) * (d - mean);
  const bootstrap_se = Math.sqrt(sqDev / n_sims);

  // 95% percentile CI from sorted draws
  const sorted = [...draws].sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * n_sims);
  const hiIdx = Math.floor(0.975 * n_sims);

  return {
    draws,
    prop_below_null: belowNull / n_sims,
    prop_below_mid:  belowMid  / n_sims,
    prop_in_rope:    inRope    / n_sims,
    prop_meaningful_opposite: oppositeMeaningful / n_sims,
    bootstrap_se,
    percentile_ci_95: [sorted[loIdx], sorted[hiIdx]],
  };
}

// Likelihood inference framework. Reports likelihood ratios at reference
// values and support intervals (values where LR > 1/k). Under Gaussian
// likelihood the LR at θ₀ relative to MLE is exp(-z²/2) where z=(β̂-θ₀)/SE.
// Support-interval half-widths follow from inverting: LR > 1/k ⇔
// |z| < √(2·ln k), so half-width = √(2·ln k) × SE.
export function likelihoodOutputs(betaHat, se, mid) {
  const lrAt = threshold => {
    const z = (betaHat - threshold) / se;
    return Math.exp(-(z * z) / 2);
  };
  const halfWidth = k => Math.sqrt(2 * Math.log(k)) * se;
  const hw8  = halfWidth(8);
  const hw32 = halfWidth(32);
  return {
    mle: betaHat,
    lr_at_null: lrAt(0),
    lr_at_mid:  lrAt(mid),
    support_interval_8:  [betaHat - hw8,  betaHat + hw8],
    support_interval_32: [betaHat - hw32, betaHat + hw32],
  };
}
