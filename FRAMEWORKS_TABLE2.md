# Five Inferential Frameworks: Summary Table

Under Gaussian likelihood with regular conditions (moderate-to-large samples, no boundary parameters, no informative stopping rules), the following five frameworks produce numerically equivalent outputs but interpret them differently. This table summarizes what each framework licenses you to say.

Running example throughout: a study of a protective intervention with RR̂ = 0.43, 95% CI [0.22, 0.84], SE on log scale = 0.341, two-sided p = 0.014, MID = 0.82.

---

## Summary table

| Framework | Plain-language summary | What it produces | What you can correctly say |
| --- | --- | --- | --- |
| **Bayesian (flat prior)** | We treat the true effect as unknown but having a probability distribution. The data update that distribution. The result is a probability distribution over possible true effects, centered on our estimate. From this distribution, we can read off the probability that the true effect falls in any range. | **Probability statements about θ**

A posterior distribution over θ representing degrees of belief about the parameter, given the data and the prior. Under flat prior, posterior = Normal(β̂, SE²). | "There is a 99.3% posterior probability that the true RR is below 1."  |
| **Confidence distribution** | For every possible true effect value, we ask what confidence level the procedure would assign. The result is a distribution describing the procedure's behavior, not a probability about the parameter itself.

 The confidence distribution turns confidence intervals into a continuous summary: it shows what confidence level corresponds to every possible range of values. The numbers describe how often the procedure would correctly capture the true effect, not what we believe about that effect. | **Frequency statements about the inference procedure**

A summary of how the inference procedure behaves: for any value you pick, it tells you the confidence level at which the procedure would rule that value out as an upper bound. The output looks like a distribution but describes the procedure's track record across repeated samples — not a probability about the true parameter. | Confidence that RR < 1 is 99.3%." This describes how reliable the procedure is at ruling out RR ≥ 1 — across repeated applications, the procedure would correctly conclude RR < 1 at the 99.3% confidence level. The number is about the procedure's track record, not the probability of any specific value. |
| **Compatibility curve** | For every candidate value of the true effect, we ask how compatible that specific value is with the observed data (using a p-value or related measure). The result is a curve showing compatibility at every point in the parameter space. It tells us which values are well-supported and which are inconsistent, but it doesn't aggregate into a single probability over ranges. | **Compatibility at each θ value**

A function p(θ₀) showing the two-sided p-value testing each candidate value θ₀. Compatibility at each point in parameter space; no cumulative interpretation. | "The compatibility of RR = 1 with the data is p = 0.014 (s ≈ 6.2 bits against this null)."  / "RR = 0.43 is the value most compatible with the data." |
| **Bootstrap** | We resample the original data many times (with replacement) and recompute the estimate from each resample. The collection of resampled estimates shows how the estimate might vary from sample to sample. From this collection we can compute summaries: standard error, percentile intervals, and the proportion of resampled estimates beyond any threshold. | **Resampling-based sampling distribution**

The empirical distribution of β̂* across many resamples (with replacement) of the original data. Approximates the sampling distribution of the estimator. | "Across 10,000 bootstrap resamples, 99.3% had estimates below 1." |
| **Likelihood inference** | We compute the likelihood function: how well each possible true value explains the observed data. The value that best explains the data is the maximum likelihood estimate; nearby values are nearly as well supported; distant values are progressively less supported. We can directly compare how much better one value is supported than another, using likelihood ratios. | **Relative support across θ values**

The likelihood function L(θ | data) plotted over the parameter space. Relative support for each value of θ, with the MLE being the value with maximum support. | "The data most strongly support RR = 0.43 (the MLE)." / "Values of RR outside [0.22, 0.84] are at least 8 times less supported than the MLE (1/8 support interval)." / "The data support RR = 0.43 over RR = 1 by a likelihood ratio of approximately 21:1." |
---

## Numerical equivalence across frameworks (running example)

For the example study (RR̂ = 0.43, SE_log = 0.341, MID = 0.82), all five frameworks produce these matching outputs:

| Quantity | Value | Bayesian framing | CD framing | Compatibility framing | Bootstrap framing | Likelihood framing |
|---|---|---|---|---|---|---|
| Point estimate | 0.43 | Posterior median/mean | MLE / CD median | Peak of compatibility curve | Bootstrap mean | MLE |
| 95% interval (RR scale) | [0.22, 0.84] | 95% credible interval | 95% confidence interval | 95% compatibility interval | 95% bootstrap percentile interval | ~1/14 support interval (approximate) |
| Test against RR = 1 | p = 0.014 | P(RR < 1) = 0.993 | Confidence(RR < 1) = 0.993 | Compatibility(RR = 1) = 0.014 | 99.3% of bootstrap draws < 1 | LR(RR=1 vs MLE) ≈ 1/21 |
| Test against RR = MID = 0.82 | p ≈ 0.059 | P(RR < 0.82) = 0.971 | Confidence(RR < 0.82) = 0.971 | Compatibility(RR = 0.82) = 0.059 | 97.1% of bootstrap draws < 0.82 | LR(RR=0.82 vs MLE) ≈ 1/6 |

The numbers in each row are the same value, presented in the vocabulary of each framework. The frameworks disagree about what kind of statement they license, not about the underlying arithmetic.

---
