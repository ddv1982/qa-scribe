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
| [Bounded layout review](layout-round-two.md) | Fail at 1e8210c | Original clipping and permission defects close. A longer catalog leaves the short-window popup hidden. |
| [Combined source and native review, round three](source-native-round-three.md) | Fail at 7ee2097 | Long-catalog and Saved Proposal recovery close. A public navigation/save race leaves a stale proposal association. |
| [Saved Proposal recovery overlay](saved-proposal-overlay.md) | Pass with notes for the exact overlay on 37f1e43 | Actual service tests preserve stale-base conflicts and read-only conversation history. This bounded verdict does not approve the whole feature. |
| [Combined source and native review, round four](source-native-round-four.md) | Pass with notes at 3374819 | The public association-retirement race closes. A subsequently reported Session-ownership objection requires separate investigation. |
| [Combined source and native review, round five](source-native-round-five.md) | Pass with notes at fbdaa05 | Session-owned publication closes the new objection. Current-head hosted CI, supported OS input, performance and release remain separate gates. |

The [implementation run](../../implementation.md) records current acceptance and limits. These historical reports are not a release verdict.

Erratum for the round-two helper description. Its statement that the observer rejects provider or Jira invocations is not runtime prevention proof. Tauri's invoke property is non-writable, so that attempted override did not install. The current harness verifies actual SQLite AI Run/message counts and zero fixture executions instead. The final performance report and decision trail supersede the historical interception claim; the original review report is unchanged.
