# Effect Reporting Tool

A web-based tool that takes effect-estimate inputs (β̂, SE, MID, prior choice) and outputs a layered Bayesian + frequentist evidence summary. Designed for program staff who interpret study results and communicate them to internal stakeholders, funders (GiveWell, Open Phil), and program partners — without requiring statistical sophistication to operate.

The tool replaces the standard "p-value verdict" reporting pattern with an evidence summary that distinguishes (a) the direction question from (b) the substantive question, and shows how conclusions depend on prior assumptions.

## What it does

- **Study estimate table.** Point estimate, SE, p-value, 95% CI, P(θ > 0 | D), P(θ > MID | D), plus the same numbers framed as confidence-distribution statements.
- **Posterior plot.** Shaded regions show probability of any effect and probability of meaningful effect (defined by MID). Vertical line at β̂ marks the point estimate.
- **Multi-prior sensitivity.** Checkbox-selected priors (Flat, Gelman default, Weakly informative, Moderately skeptical) — see how skepticism changes the headline probabilities.
- **Confidence distribution + curve.** Frequentist visualization of the same H(θ) function. Crossings at H = 0.025 and H = 0.975 give the 95% CI bounds; the confidence curve gives all CI levels simultaneously.
- **Risk-ratio mode.** Inputs as RR, internal math on log(RR), with a toggle for log-axis (Normal) vs RR-axis (log-normal) visualization.
- **Exports.** Copy table as TSV, download CSV, download PNG report card. Separate exports for the upper estimate table and the multi-prior sensitivity panel.

## Tech stack

Vanilla HTML/CSS/JS. No build step, no dependencies. All math is closed-form (Normal likelihood + Normal prior conjugacy). Deploys as static files.

- `index.html` — entry point
- `css/styles.css` — styling (variables-driven, EA brand-aware)
- `js/stats.js` — pure math (Abramowitz & Stegun erf, posterior, frequentist quantities)
- `js/plotting.js` — SVG rendering for all four plots
- `js/ui.js` — input handling, table population, plot orchestration
- `js/export.js` — clipboard, CSV, PNG report-card composition

## Local development

Serve over HTTP (ES modules don't work via `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

Or `npx serve .` if you have Node.

## Branding

The hosted version uses Evidence Action's brand system (T-Star TW + T-Star Pro fonts, EA color palette, EA logo). The brand assets are licensed and excluded from this public repo; running the code locally falls back to Google-hosted Roboto Condensed + JetBrains Mono. Functionality is unchanged.

EA staff: drop your `css/ea-fonts.css` (the `@font-face` declarations) and the `<img src="data:image/png;base64,...">` for the logo into the header to restore full branding.

## Framework reference

See `CLAUDE.md` for the full mathematical specification, default prior set, design principles, and open questions.

## License

TBD.
