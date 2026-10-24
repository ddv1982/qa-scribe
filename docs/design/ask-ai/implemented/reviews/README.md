# Independent Ask AI review evidence

Reports describe the exact source revisions they reviewed. A passing focused review does not replace whole-feature, native, performance, or CI acceptance. Initial failures remain here so later corrections can be checked against the original objections.

| Review | Verdict at reviewed revision | Follow-up |
| --- | --- | --- |
| [Record header and editor history](s1-round-two.md) | Pass with notes | Native layout repeated after shared chat integration. |
| [Shared context](context.md) | Pass with notes | Later integrated source and native checks cover the combined flow. |
| [Initial refinement](refinement-initial.md) | Fail | Stale overwrite and lost readable fallback required correction. |
| [Refinement write guard](refinement-guard-round-two.md) | Pass for bounded P1 | Whole-feature review independently confirmed that correction. |
| [Initial whole-feature source](source-initial.md) | Fail | Successful compensation retained an obsolete editor base. Closed by the corrected-head round-two review. |
| [Second-family source review](source-second-family-initial.md) | Fail at the same historical head | Independently reproduces the compensation finding. It does not review later fixes or remeasure the parent's verification counts. |
| [Initial whole-feature native](native-initial.md) | Fail | Narrow composer overflow required correction. Closed by the corrected-head round-two review. |
| [Corrected source and native review](source-native-round-two.md) | Pass with notes at 20bbeaf | Both P2s close. Earlier closures hold. All 38 maintained native cases and eight additional cases pass. Performance and hosted CI remain separate gates. |

The [implementation run](../../implementation.md) records current acceptance and limits. These historical reports are not a release verdict.
