# Bayesian Effect Reporting Tool

## Project goal

Build a web-based tool that takes effect-estimate inputs (β̂, SE, MID, prior choice) and outputs a complete Bayesian + frequentist evidence summary, designed for non-technical Evidence Action staff to use when communicating study results to internal stakeholders, funders (GiveWell, Open Phil), and program partners.

The tool replaces the standard "p-value verdict" reporting pattern with a layered evidence summary that distinguishes (a) the direction question from (b) the substantive question, and shows how conclusions depend on prior assumptions.

## Target user

Non-technical program staff at Evidence Action who:
- Understand effect sizes and confidence intervals at a conceptual level
- Are not statisticians, but interpret study results regularly
- Communicate results to funders and program partners
- Need to avoid the "p < 0.05 = it works" / "p > 0.05 = it doesn't work" framing

The tool should require no statistical sophistication to operate, but should produce outputs that hold up under sophisticated scrutiny (e.g., from GiveWell reviewers).

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework needed for MVP)
- **Math:** Pure JS — all computations are closed-form under Normal likelihood + Normal prior conjugacy
- **Visualization:** Inline SVG (already prototyped in `posterior_explorer.html`)
- **Deployment:** Netlify (matches existing internal tools pattern)
- **No backend, no R, no WebR, no MCMC** for MVP — keep the deploy footprint trivial

If complex priors or non-Gaussian likelihoods are needed later, can extend with WebR; not needed for the framework as specified.

## Mathematical specification

### Inputs

- `beta_hat`: point estimate (on log-RR scale for RR work, or on whatever scale matches the model)
- `se`: standard error of `beta_hat`
- `mid`: minimum important difference (on same scale as `beta_hat`)
- `priors`: list of priors to evaluate, each specified as `{name, mean, sd}`
- `scale`: "linear" (for SDs, raw differences) or "log_rr" (for log risk ratios)

### Default prior set

For RR-based work (log scale):
- **Flat:** improper, equivalent to σ = ∞ (numerically: σ = 100)
- **Gelman default:** Normal(0, 2.5)
- **Weakly informative:** Normal(0, 1.0)
- **Moderately skeptical:** Normal(0, 0.30)
- **Strongly skeptical (Spiegelhalter):** Normal(0, |MID|/1.645)

For raw-scale work (effect sizes in SD units):
- Same structure with different default SDs (typically 10× smaller than log scales)

### Outputs to compute per prior

Under Normal likelihood `β̂ ~ Normal(θ, SE²)` and Normal prior `θ ~ Normal(μ_prior, σ_prior²)`:

- **Posterior variance:** `1 / (1/σ_prior² + 1/SE²)`
- **Posterior mean:** `posterior_var * (β̂/SE² + μ_prior/σ_prior²)`
- **Posterior SD:** `sqrt(posterior_var)`
- **P(θ > 0 | D):** `1 - Φ((0 - posterior_mean) / posterior_sd)`
- **P(θ > MID | D):** `1 - Φ((MID - posterior_mean) / posterior_sd)`
- **P(θ < -MID | D):** `Φ((-MID - posterior_mean) / posterior_sd)`
- **P(|θ| < MID | D):** `1 - P(θ > MID) - P(θ < -MID)` — practical-equivalence region
- **95% credible interval:** `posterior_mean ± 1.96 * posterior_sd`

These three probabilities (`P(θ > MID)`, `P(|θ| < MID)`, `P(θ < -MID)`) sum to 1 and give the ROPE decomposition.

### Frequentist outputs (independent of prior)

- **t-statistic:** `β̂ / SE`
- **Two-sided p-value:** `2 * (1 - Φ(|t|))`
- **95% CI:** `β̂ ± 1.96 * SE`

### RR-scale conversions (when scale = "log_rr")

After computing on log scale, also output on RR scale:
- RR point estimate: `exp(β̂)`
- RR 95% CI: `[exp(ci_low), exp(ci_high)]`
- All threshold probabilities labeled as "P(RR > MID_rr)" where `MID_rr = exp(MID_log)`

## UI specification

### Input section

- Mode toggle: "Difference of means / continuous outcome" vs. "Risk ratio / binary outcome"
- For continuous: input β̂, SE, MID (all in same units)
- For RR mode: input either (a) log(RR̂) and SE_log directly, or (b) raw 2×2 table (events_treatment, n_treatment, events_control, n_control) with auto-computation of log(RR̂) and SE
- MID input with helper text on how to set it (cost-effectiveness threshold, prior literature, etc.)
- Prior selector: checkbox list of which priors to include, plus "custom" option with σ slider

### Output section

For each selected prior, show a card with:
- Posterior mean and 95% credible interval
- ROPE decomposition as three percentages with a stacked bar visualization
- Plain-language summary (auto-generated, see below)

One large visualization at the top:
- Overlaid posterior densities for all selected priors
- Vertical reference lines at 0, +MID, -MID
- Shaded regions showing meaningful-positive / null / meaningful-negative

A frequentist summary card (always shown, independent of prior):
- β̂, SE, p-value, 95% CI
- Brief note: "Equivalent to Bayesian analysis under a flat prior."

### Plain-language summary template

For each prior, auto-generate a 2-line summary:
- Line 1: "Best estimate: [point estimate] (95% CI: [low, high])"
- Line 2: "Under [prior name], there is a [P_meaningful_pos]% probability of a meaningful positive effect, [P_null]% probability the effect is practically null, and [P_meaningful_neg]% probability of a meaningful negative effect."

For non-technical readers, the second line is the headline.

### Export

- "Copy summary" button → plain text suitable for pasting into Slack / email / report
- "Download report" → standalone HTML file with all outputs and visualizations baked in (for sharing with funders)
- "Share link" → URL with parameters encoded so the recipient sees the same analysis

## Design principles

1. **Don't dichotomize.** Never display the word "significant" or "non-significant." Never show a binary verdict. The whole point is to escape that framing.

2. **Show sensitivity prominently.** Multiple priors aren't a footnote — they're the main display. The contrast between flat and skeptical priors is the key insight.

3. **Plain language first, math second.** The default view shows interpretation; technical details (formulas, credible intervals as numbers) are in a collapsible "details" panel.

4. **Match Evidence Action's communication norms.** Outputs should look like something that fits naturally in a report to GiveWell — restrained, professional, not aggressively styled.

5. **Visualization is the substantive output, not decoration.** The posterior plot with shaded ROPE regions communicates more than any number. Make it the focal point.

## File structure

```
/
├── index.html              # main app entry
├── css/styles.css          # styling
├── js/
│   ├── stats.js            # all statistical computations (pure functions, well-tested)
│   ├── plotting.js         # SVG posterior density rendering
│   ├── ui.js               # form handling, output rendering
│   ├── summary.js          # plain-language summary generation
│   └── export.js           # copy/download/share-link functions
├── examples/
│   ├── deworming.json      # pre-populated example
│   ├── immunization.json   # pre-populated example
│   └── ...
├── tests/
│   └── stats.test.js       # unit tests for the math
└── README.md
```

## MVP scope (ship first)

1. Continuous-outcome mode only (RR mode in v2)
2. Flat + moderately skeptical priors only (full prior list in v2)
3. P(θ > 0), P(θ > MID), CI, posterior plot
4. Plain-language summary (one prior at a time)
5. Copy-summary export only (download/share in v2)

This gets the core framework in front of users fastest. Everything else is iteration.

## Out of scope (don't build)

- MCMC / non-Gaussian likelihoods (use closed-form only)
- Hierarchical / multi-study models (separate tool if needed later)
- Meta-analysis integration (separate tool)
- User accounts, persistence, saved analyses (URL params handle sharing)
- Mobile-first design (desktop-first; mobile is acceptable but not optimized)

## Background context

This tool implements the reporting framework developed in a long discussion with Claude (Opus 4.7) on May 26, 2026. Key reference points:

- The framework is grounded in the gap between "probability of any positive effect" (P(θ > 0)) and "probability of meaningful effect" (P(θ > MID)).
- Flat-prior Bayesian analysis is mathematically equivalent to single-study frequentist analysis. The skeptical prior is what does the replication-crisis-aware work.
- For RR-based work, all priors live on the log(RR) scale, not the RR scale (asymmetric).
- The MDE / minimum detectable effect framework is redundant with the CI plus posterior visualization; don't include it in the output.
- The ROPE decomposition (meaningful positive / null / meaningful negative summing to 1) is more informative than P(θ > MID) alone.

## Open questions to resolve during build

1. How should "MID" be set when stakeholders disagree? Allow multiple MIDs side-by-side?
2. Should the tool support uploading a CSV of multiple analyses to batch-report?
3. How prominently to surface "this is one study; external evidence matters"? A footer disclaimer, or something more substantial?
4. Should the prior choice be locked once selected, or always editable? (Editable makes prior-shopping easy; locked is paternalistic.)

## Starting point

`posterior_explorer.html` (in working directory) contains a working single-prior posterior visualizer with controls for β̂, SE, MID, and prior SD. Use this as the foundation for the visualization layer. The math functions (erf, ncdf, npdf) are tested and correct. The styling (Crimson Pro + IBM Plex Sans, warm off-white background, restrained type) is the target aesthetic for the rest of the app.
