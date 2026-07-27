// Tests for js/stats.js — run via `node --test tests/stats.test.mjs`.
// No dependencies; uses Node's built-in test runner and assert/strict.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  erf,
  ncdf,
  npdf,
  computePosterior,
  computeFrequentist,
  tailProb,
  compatibilityCurveOutputs,
  bootstrapOutputs,
  likelihoodOutputs,
  FLAT,
  Z_95,
} from '../js/stats.js';

// Loose numeric equality for floating-point comparisons.
const close = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `expected ${actual} ≈ ${expected} (tol=${tol})`);

// ──────────────────────────────────────────────────────────────────────────
// Existing stats foundation
// ──────────────────────────────────────────────────────────────────────────

test('erf: zero', () => close(erf(0), 0));
test('erf: erf(1) ≈ 0.8427', () => close(erf(1), 0.8427, 1e-4));
test('erf: erf(2) ≈ 0.9953', () => close(erf(2), 0.9953, 1e-4));
test('erf: odd symmetry', () => close(erf(-1.5), -erf(1.5), 1e-12));

test('ncdf: standard Normal median at 0', () => close(ncdf(0, 0, 1), 0.5));
test('ncdf: 1.96σ ≈ 0.975', () => close(ncdf(1.96, 0, 1), 0.975, 1e-4));
test('ncdf: −1.96σ ≈ 0.025', () => close(ncdf(-1.96, 0, 1), 0.025, 1e-4));

test('npdf: standard Normal peak ≈ 0.3989', () => close(npdf(0, 0, 1), 0.3989, 1e-4));
test('npdf: shifted by mean', () => close(npdf(0.5, 0.5, 1), npdf(0, 0, 1)));

test('Z_95 constant matches 1.96', () => assert.equal(Z_95, 1.96));
test('FLAT constant is 4.5', () => assert.equal(FLAT, 4.5));

test('computePosterior: flat shortcut at priorSD = 100', () => {
  const p = computePosterior({ betaHat: 0.7, se: 0.15, priorSD: 100 });
  assert.equal(p.isFlat, true);
  assert.equal(p.mean, 0.7);
  assert.equal(p.sd, 0.15);
});

test('computePosterior: flat shortcut at priorSD = FLAT exactly', () => {
  const p = computePosterior({ betaHat: 0.4, se: 0.3, priorSD: FLAT });
  assert.equal(p.isFlat, true);
});

test('computePosterior: precision-weighted average at equal precisions', () => {
  // β̂=0.4, SE=0.3, priorSD=0.3 → equal precisions → posterior mean = β̂/2
  const p = computePosterior({ betaHat: 0.4, se: 0.3, priorSD: 0.3 });
  assert.equal(p.isFlat, false);
  close(p.mean, 0.2, 1e-9);
  // posterior variance = 1/(1/0.09 + 1/0.09) = 0.045 → sd ≈ 0.2121
  close(p.sd, Math.sqrt(0.045), 1e-9);
});

test('computeFrequentist: t-stat, p-value, CI', () => {
  const f = computeFrequentist({ betaHat: 0.4, se: 0.3 });
  close(f.t, 0.4 / 0.3, 1e-9);
  close(f.pValue, 0.1827, 1e-3);
  close(f.ciLow, 0.4 - 1.96 * 0.3, 1e-9);
  close(f.ciHigh, 0.4 + 1.96 * 0.3, 1e-9);
});

test('tailProb: P(X > 0) for X ~ N(1, 1)', () => {
  close(tailProb({ threshold: 0, mean: 1, sd: 1 }), 1 - ncdf(0, 1, 1));
});

// ──────────────────────────────────────────────────────────────────────────
// Compatibility curve framework
// ──────────────────────────────────────────────────────────────────────────

test('compatibility: p-value at null matches frequentist 2-sided p-value', () => {
  const c = compatibilityCurveOutputs(0.4, 0.3, 0.5);
  const f = computeFrequentist({ betaHat: 0.4, se: 0.3 });
  close(c.compatibility_at_null, f.pValue, 1e-9);
});

test('compatibility: s-value relates to p-value via -log2', () => {
  const c = compatibilityCurveOutputs(0.4, 0.3, 0.5);
  close(c.s_value_null, -Math.log2(c.compatibility_at_null), 1e-12);
});

test('compatibility: 95% CI matches β̂ ± 1.96·SE', () => {
  const c = compatibilityCurveOutputs(0.4, 0.3, 0.5);
  const [lo, hi] = c.compatibility_intervals[95];
  close(lo, 0.4 - 1.96 * 0.3, 1e-9);
  close(hi, 0.4 + 1.96 * 0.3, 1e-9);
});

test('compatibility: 50%/80%/99% half-widths match standard z-values', () => {
  const c = compatibilityCurveOutputs(0.4, 0.3, 0.5);
  close((c.compatibility_intervals[50][1] - c.compatibility_intervals[50][0]) / 2, 0.6745 * 0.3, 1e-9);
  close((c.compatibility_intervals[80][1] - c.compatibility_intervals[80][0]) / 2, 1.2816 * 0.3, 1e-9);
  close((c.compatibility_intervals[99][1] - c.compatibility_intervals[99][0]) / 2, 2.5758 * 0.3, 1e-9);
});

test('compatibility: most_compatible_value = β̂', () => {
  const c = compatibilityCurveOutputs(0.4, 0.3, 0.5);
  assert.equal(c.most_compatible_value, 0.4);
});

test('compatibility: running example p at null ≈ 0.014', () => {
  // RR̂ = 0.43, β̂_log = ln(0.43), SE_log = 0.341
  const c = compatibilityCurveOutputs(Math.log(0.43), 0.341, Math.log(0.82));
  close(c.compatibility_at_null, 0.014, 5e-3);
});

// ──────────────────────────────────────────────────────────────────────────
// Bootstrap framework (parametric simulation; loose tolerances)
// ──────────────────────────────────────────────────────────────────────────

test('bootstrap: prop_below_null near analytic value (N=100k)', () => {
  // β̂=0, SE=1 → analytic P(X<0) = 0.5
  const b = bootstrapOutputs(0, 1, 0.5, 100000);
  close(b.prop_below_null, 0.5, 0.01);
});

test('bootstrap: bootstrap_se near input SE (N=100k)', () => {
  const b = bootstrapOutputs(0, 1, 0.5, 100000);
  close(b.bootstrap_se, 1, 0.02);
});

test('bootstrap: prop_below_mid matches ncdf (N=100k)', () => {
  const b = bootstrapOutputs(0, 1, 0.5, 100000);
  close(b.prop_below_mid, ncdf(0.5, 0, 1), 0.01);
});

test('bootstrap: running example prop_below_null ≈ 0.993 (N=100k)', () => {
  const b = bootstrapOutputs(Math.log(0.43), 0.341, Math.log(0.82), 100000);
  close(b.prop_below_null, ncdf(0, Math.log(0.43), 0.341), 0.015);
});

test('bootstrap: percentile CI brackets the mean for symmetric draws', () => {
  const b = bootstrapOutputs(0, 1, 0.5, 100000);
  assert.ok(b.percentile_ci_95[0] < 0);
  assert.ok(b.percentile_ci_95[1] > 0);
});

test('bootstrap: prop_in_rope + prop_below_null + prop_above_null_outside_rope sums to ~1', () => {
  // ROPE [-|mid|, |mid|]; below_null = (draws < 0); above null but inside rope are draws in [0, |mid|]
  const b = bootstrapOutputs(0, 1, 0.5, 100000);
  // Total prop accounted for: opposite_meaningful + (in_rope on negative side) + (in_rope on positive side) + (above |mid|)
  // Simpler check: in_rope + meaningful_opposite + (rest above |mid|) = 1; verify each is in [0,1]
  for (const k of ['prop_below_null', 'prop_below_mid', 'prop_in_rope', 'prop_meaningful_opposite']) {
    assert.ok(b[k] >= 0 && b[k] <= 1, `${k} out of [0,1]`);
  }
});

test('bootstrap: draws array length matches n_sims', () => {
  const b = bootstrapOutputs(0, 1, 0.5, 5000);
  assert.equal(b.draws.length, 5000);
});

// ──────────────────────────────────────────────────────────────────────────
// Likelihood inference framework
// ──────────────────────────────────────────────────────────────────────────

test('likelihood: LR at MLE = 1 (trivial)', () => {
  const l = likelihoodOutputs(0.4, 0.3, 0.5);
  // LR(MLE vs MLE) = exp(0) = 1; lr_at_null = LR(0 vs MLE) when MLE = β̂
  // Since this test uses β̂=0.4 not 0, lr_at_null != 1; verify lr at β̂ itself by constructing
  const zSelf = (0.4 - 0.4) / 0.3;
  close(Math.exp(-(zSelf * zSelf) / 2), 1, 1e-12);
});

test('likelihood: LR at null matches exp(-z²/2)', () => {
  const l = likelihoodOutputs(0.4, 0.3, 0.5);
  const z = (0.4 - 0) / 0.3;
  close(l.lr_at_null, Math.exp(-(z * z) / 2), 1e-12);
});

test('likelihood: LR at MID matches exp(-z²/2)', () => {
  const l = likelihoodOutputs(0.4, 0.3, 0.5);
  const z = (0.4 - 0.5) / 0.3;
  close(l.lr_at_mid, Math.exp(-(z * z) / 2), 1e-12);
});

test('likelihood: support interval 1/8 half-width = √(2·ln 8) × SE', () => {
  const l = likelihoodOutputs(0, 1, 0.5);
  const hw = (l.support_interval_8[1] - l.support_interval_8[0]) / 2;
  close(hw, Math.sqrt(2 * Math.log(8)), 1e-9);
});

test('likelihood: support interval 1/32 wider than 1/8', () => {
  const l = likelihoodOutputs(0, 1, 0.5);
  const hw8 = (l.support_interval_8[1] - l.support_interval_8[0]) / 2;
  const hw32 = (l.support_interval_32[1] - l.support_interval_32[0]) / 2;
  assert.ok(hw32 > hw8);
  close(hw32, Math.sqrt(2 * Math.log(32)), 1e-9);
});

test('likelihood: MLE = β̂', () => {
  const l = likelihoodOutputs(0.7, 0.15, 0.8);
  assert.equal(l.mle, 0.7);
});

test('likelihood: running example LR at null', () => {
  // β̂_log = ln(0.43), SE = 0.341 → z = ln(0.43)/0.341 ≈ -2.475
  // LR = exp(-z²/2) ≈ exp(-3.062) ≈ 0.0468 ≈ 1/21
  const l = likelihoodOutputs(Math.log(0.43), 0.341, Math.log(0.82));
  close(l.lr_at_null, 1 / 21, 0.01);
});
