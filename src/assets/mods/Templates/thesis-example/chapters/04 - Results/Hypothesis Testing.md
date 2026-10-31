---
title: Hypothesis Testing
pageSize: a4
columns: 1
theme: modern
---
# Hypothesis Testing

This section reports the results of inferential statistical procedures and formal tests of the hypotheses proposed in Chapter 2.

## Reporting Standards

Follow international scientific reporting standards (e.g., APA 7th / IEEE) for statistical significance:

1. **Test Statistic**: Report the test symbol, degrees of freedom, and exact numerical value (e.g., $t(148) = 4.82$, $F(2, 215) = 18.34$, $\chi^2(3) = 12.05$).
2. **Significance Level**: Report the exact $p$-value to three decimal places (e.g., $p = 0.003$ or $p < 0.001$). Avoid reporting merely $p < 0.05$ when exact numbers are accessible.
3. **Effect Size**: Always accompany statistical significance with an effect size metric (e.g., Cohen's $d$, partial $\eta^2$, Cramer's $V$, or $R^2$), demonstrating practical magnitude beyond mere sample-size power.
4. **Confidence Intervals**: Provide 95% confidence intervals ($95\%\ \text{CI}\ [LL, UL]$) for mean differences or parameter estimates.

## Decision Summary Table

Provide a consolidated summary table resolving each formal hypothesis:

| Hypothesis Statement | Applied Test | Observed Metric | p-value | Decision ($H_0$) | Conclusion |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **$H_1$**: Proposed causal relationship | Welch's t-test | $t = 3.91, d = 0.65$ | $p < 0.001$ | Rejected | Supported |
| **$H_2$**: Sub-dimension correlation | Pearson's $r$ | $r = 0.58, R^2 = 0.34$ | $p = 0.002$ | Rejected | Supported |
