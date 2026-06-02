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
