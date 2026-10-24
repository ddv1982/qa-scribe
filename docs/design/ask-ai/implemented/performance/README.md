# Ask AI UI performance acceptance

All proposed budgets pass. Save is slower on the near-limit Finding workload, within its budget. The repeated Notes reveal is faster; the first measured reveal and scrolling show no meaningful improvement. This is not a general speedup claim.

Five baseline/head pairs ran in alternating order with fresh isolated data. Baseline source is `1c34f3e`; application head is `20bbeaf`. Both use optimized Rust, production Vite assets, the opt-in native E2E feature and the same dependency versions. Node 24 rebuilding produced identical baseline frontend bytes. The host has ten logical CPUs. No compiler, other native test, or review workload ran during comparison. Per-run load readings and hashes are retained in the raw receipts.

The table reports the median of five per-run p95 values. Parentheses contain the range across those five runs, in milliseconds.

| Interaction | Baseline | Head |
| --- | --- | --- |
| Notes visible reveal | 36 (36–37) | 23 (23–27) |
| Literal edit | 32 (31–33) | 37 (35–38) |
| Record Save | 86 (86–87) | 118 (114–121) |
| Ask AI opening | Unavailable | 38 (37–39) |
| Proposal review | Unavailable | 21 (19–22) |
| Apply to editor | Unavailable | 79 (78–89) |

Scroll p95 frame intervals remain 12 ms on both sides in every run. The pinned header gap changes from 32 to zero CSS pixels. First measured Notes reveals range from 516–523 ms before and 520–525 ms after. Those first interactions are retained separately; they do not establish cold parsing or total startup cost.

Every pair passes Notes and Save p95 within 1.2 times its paired baseline plus 50 ms. Ask AI remains below 250 ms; Apply remains below 100 ms. Scroll remains below the larger of 20 ms and 1.2 times baseline, with head gap below one pixel. There are zero failed or incomplete reported runs. [summary.json](summary.json) contains every per-run value and budget result.

The common workload has one hundred messages, four synthetic images and an 89,982-byte rich Finding. Each run performs twenty Notes reveals, twenty literal edits and twenty verified Saves. Head additionally opens Ask AI twenty times and reviews/applies twenty short refinements in a separate forty-message companion Session. Each application produces the actual dirty editor and durable stage, leaves storage unchanged, and clears through Undo and Discard. Every run verifies zero AI Runs, the expected message count and zero provider fixture executions.

The clock is captured inside the WebView from DOM event to a second ready animation frame. This measures a paint opportunity, not physical display paint, native input latency, provider latency, or WebDriver round trips. The sample ceiling is partly the animation-frame schedule encoded in `ui-performance-observer.mjs`. A separate WebContent sample shows the main thread mostly waiting in the run loop, with rendering/style/layout timer work. Recorded task CPU counters show the load generator was not saturated after startup.

The excluded Save diagnostic recorded no frontend guard digests before and three per Save after. Head median digest waiting was 39.5 ms within an 87 ms event-to-DOM interval; baseline event-to-DOM was 45.5 ms. This supports the new guard hash awaits as the dominant additional waiting in that diagnostic. Instrumented durations are not included in the comparison table and do not quantify the exact contribution to the uninstrumented 32 ms difference. No IPC duration is claimed.

Qualification caught an invalid initial SQL fixture above the existing Finding body cap. That failed run was excluded. The corrected fixture validates the real cap and reserves room for edits. A separate diagnostic also established that Tauri defines `invoke` as non-writable. The attempted observer override was ineffective. The harness now checks actual SQLite execution state and provider fixture files; it makes no interception or blocking claim. The final audited series followed successful qualification with those assertions. Earlier exploratory and profiled timings are excluded.

Each `pair-final-*` directory contains raw timings, geometry, actual stored-work proofs, binary/source identifiers and completed runner receipts. The maintained reproducer is `e2e/specs/native-ui-performance.benchmark.mjs`, with the two `generate_ui_perf_*` examples. Build each source with the production frontend and optimized E2E binary in its own checkout. Use a private ordinary copy at `target/debug/qa-scribe-tauri`, as required by the existing wrapper. Generate a fresh common fixture for each invocation and the companion only for head. Set `QA_SCRIBE_E2E_SKIP_BUILD=1`, an explicit temporary root and artifacts directory, `QA_SCRIBE_E2E_SPEC=native-ui-performance.benchmark.mjs`, the actual `QA_SCRIBE_E2E_BENCHMARK_REVISION`, `QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE=release-production-e2e`, `QA_SCRIBE_UI_PERF_SIDE=baseline` or `head`, and `QA_SCRIBE_UI_PERF_LANE_RELEASED=1`. Do not run against installed user data or alongside another native lane.
