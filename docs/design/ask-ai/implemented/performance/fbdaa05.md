# Ask AI performance at fbdaa05

All explicit budgets pass in every one of five interleaved baseline/head pairs. Guarded Save is slower on the near-limit Finding workload, within its budget. This is not a general speedup claim.

The baseline is `1c34f3e`; head is `fbdaa05`. Both use a production Vite build and optimized native E2E executable on the same macOS arm64 host, with Node 24 and identical dependency versions. Baseline binary SHA-256 is `c068f8b316e4c4a7551e32fdaa44fff03c502d26165220a0fb87e6040493db78`. Head is `3f59c4ca3744bdf6a91a47143e60c71cfc159cbba65a38c457008be0bc8ff015`.

Two qualification runs and two profile runs passed and are excluded from comparison. The ten reported runs all completed the requested scope with zero observer or runner failures. No compiler, reviewer, other test suite or other native application run overlapped the measurements. Initial load averages were 2.12/3.24/3.09 across ten logical CPUs. Per-run load samples and all numeric observations are in [the receipt](fbdaa05-summary.json).

## Repeated observations

Each cell is the median of five per-run p95 values, followed by that p95 range. Units are milliseconds, except the header gap in CSS pixels. These are not pooled percentiles.

| Path | Baseline median [range] | Head median [range] | Budget |
| --- | --- | --- | --- |
| Notes visible reveal | 36 [35–38] | 22 [22–23] | Each head pair ≤ 1.2 × baseline + 50 ms |
| Manual edit | 32 [31–33] | 36 [33–48] | Observed, no separate threshold |
| Record Save | 85 [84–88] | 113 [107–121] | Each head pair ≤ 1.2 × baseline + 50 ms |
| Ask AI opening | Not applicable | 37 [36–40] | ≤ 250 ms |
| Proposal review | Not applicable | 20 [20–21] | Observed, no separate threshold |
| Proposal Apply | Not applicable | 78 [77–85] | ≤ 100 ms |
| Scrolling frame interval | 12 [12–12] | 12 [12–12] | ≤ max(20 ms, 1.2 × baseline) |
| Maximum pinned-header gap | 32 [32–32] | 0 [0–0] | ≤ 1 CSS pixel |

Save ranges do not overlap. Manual-edit variation does not establish a stable improvement. The first measured Notes opening is separately 518 ms [516–522] before and 518 ms [516–521] after. It does not improve. Its readiness includes the first persisted mode change and the existing 500 ms Chat autosave. The seeded primary Chat revision starts at zero and is one after all twenty toggles in both profiled databases. Later rapid toggles can return to the already-saved mode. This probe measures visible opening/reveal, not cold parsing, Session startup, or total work reduction.

## Work and clock boundaries

Every shared run uses the identical fixture: 100 completed messages, four 2×2 PNGs of 77 bytes each, and an 89,982-byte HTML Finding with a 98,110-byte rich document. It performs twenty Notes reveals, 120 measured scrolling frame intervals over 2,400 pixels, twenty literal edits, and twenty verified persisted Saves. All four managed images remain after every Save.

Head also performs twenty Ask AI openings and twenty real proposal review/Apply cases in a separate forty-message companion Session. Every Apply produces the expected dirty editor and durable stage while leaving record storage unchanged. Undo and Discard clear each unsaved stage. These are short realistic proposals without images, not 100 KB proposals or large-image decoding measurements.

Canonical database checks show zero AI Runs and 100 messages for baseline, zero AI Runs and 140 messages for head. Provider execution-file lists remain empty. No real model or Jira operation occurs. Readiness checks require the exact record, title, message endpoints, image count, and proposal outcome; a rejected or absent operation cannot produce an accepted timing.

The clock starts at the captured DOM click/input event and ends at the second ready animation frame inside the WebView. It excludes WebDriver round trips, provider latency, preparation and scroll positioning. It measures paint opportunities, not physical screen paint or OS input. The production startup gate is separate.

## Profile and limiter

Separate Save profiles are excluded from reported timing. Across twenty head Saves, they record 59 serial digest awaits: two on the first Save and three on each of nineteen later Saves. Median awaited-digest elapsed time is 38 ms within a median 89.5 ms Save-to-DOM-ready span. Baseline records no added guard digests and a median DOM-ready span of 44.5 ms. This identifies additional awaited guard work; it is not an exact decomposition of the reported p95 difference or a SHA-256 CPU-throughput measurement.

The observer then waits for two ready animation frames. The recorded scroll cadence is 12 ms at p95, so frame scheduling also bounds these small UI timings. The first Notes mode-save readiness has a separate 500 ms debounce. No causal claim is made about cold parsing or total startup, and no tuning decision is based on a general throughput claim.

## Reproduction and retained evidence

The maintained [native probe](../../../../../e2e/specs/native-ui-performance.benchmark.mjs), [observer](../../../../../e2e/specs/ui-performance-observer.mjs), and two `generate_ui_perf_*` core examples reproduce the workload. Build baseline and head in separate checkouts with the production frontend, optimized Rust, feature `e2e`, and their own native E2E config. The wrapper uses a private ordinary copy at `target/debug/qa-scribe-tauri`. Generate a fresh isolated fixture for each run; seed the companion only for head. Set the actual source SHA, `release-production-e2e`, the explicit side and released native lane as documented by the probe. Qualify both sides, profile separately, then alternate five baseline/head pairs. Stop on a failure rather than collecting around it.

Raw native receipts, screenshots, persisted-data proofs and runner logs remain locally under `artifacts/ask-ai/performance/pair-r5-{1..5}-{baseline,head}`. Excluded runs use `r5-qualification-*` and `profile-save-r5-*`. The committed JSON retains all duration, frame and header-gap samples, per-run receipt hashes, fixtures, audit counts and paired budget results. Runtime source equivalence and hosted CI remain separate shipping gates.
