# Vite configuration reload memory finding

Status is open. This behavior was measured in the existing T7-1 Vite-only workflow and the optional checked workflow. No Vite fix or loader change is claimed. These are development-server measurements, not desktop application memory measurements.

The original T7-2 run at `4c5a0e9c1c3e958ed9dd855e355f5e4d65c76938` failed its absolute 50 MiB memory-growth condition. Its aggregate growth was 75.375 MiB after 100 edits. That failure remains recorded in the [watch evidence](typescript-7-watch-evidence.json).

Three matched existing Vite-only sessions at `0496aac81d0b1d6c6c61797e721f827a7420a8bf` also exceeded that threshold. Their median aggregate growth was 133.660 MiB. The sessions used 50 UI and 50 config writes with the same dependencies and default Vite 7.3.7 loader. The runner-loader experiment did not resolve growth. The native-loader experiment left imported config changes stale. This agrees with the documented native-loader limitation in [Vite 7 configuration guidance](https://v7.vite.dev/config/).

## Bounded allocation diagnosis

A separate instrumented control pair used Node 24.22.0 and Bun 1.3.5. Each control performed 100 mixed edits, followed by 300 config reloads in the same Vite PID. Inspector allocation sampling and runtime heap/GC counters were separate from acceptance measurements. No forced GC, heap cap, heap snapshot or periodic process restart was used.

| Vite process RSS growth | Existing Vite only | Checked workflow |
| --- | ---: | ---: |
| Initial 100 mixed edits | 111.48 MiB | 113.40 MiB |
| Additional 300 warmed config reloads | 15.71 MiB | 3.15 MiB |

These single-session instrumented controls do not establish a comparative performance improvement. Used heap oscillated through normal collection. Each profile recorded 55 major GC events, while estimated current allocation samples increased across the reload batches. Their weight rose from 64.91 to 109.87 MiB in the existing control and from 66.79 to 118.66 MiB in the checked control. Sampling stacks are not object-retainer graphs.

The larger allocation contributions mapped to shared server/environment creation, dependency metadata parsing and watcher/glob paths. Direct timestamp-config stack attribution was about 1.6 to 1.7 MiB. This weakens the assumption that the temporary config loader alone explains the result. It does not rule out indirect module-cache retention.

Transient esbuild RSS also rose substantially and then fell without PID replacement. A sum of RSS deltas can hide one process's growth behind another process's shrinkage. The [reviewed acceptance amendment](typescript-7-watch-memory-amendment.md) therefore accounts for positive growth per process and reports absolute resident overhead separately.

All owned groups stopped and scratch ports were freed. The checked control returned 130. Instrumented Vite-only shutdown produced esbuild EPIPE/callback errors after SIGINT and returned 1; those errors remain in its diagnostic receipt.

## Limits and follow-up

The evidence supports a mixture of RSS that rose during initial work and then mostly levelled off, and persistent reload-associated allocation state. It proves neither a pure allocator plateau nor an unbounded leak. No conclusion covers arbitrary session lengths or all host platforms.

Keep the default loader for this migration. Further work should isolate retained objects in the shared server restart path before proposing an upstream fix or dependency change. This document creates no upstream issue or message. It remains a separate pre-existing finding for the final shipping reviewer.

Raw receipts are local task artifacts under `/tmp/qa-scribe-ts7/T7-2/perf/allocation-diagnosis/`, including `decision.json`, `summary.json`, `allocation-trend.json`, the runnable collector and their checksum index. They are not committed. Their checksums are recorded with the watch evidence for review provenance.
