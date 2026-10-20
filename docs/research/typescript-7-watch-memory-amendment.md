# Proposed T7-2 memory acceptance amendment

Status is proposed. No new acceptance measurement may start before independent review accepts these definitions. This document changes no production command or dependency.

## Evidence and scope

The original absolute gate failed at `4c5a0e9c1c3e958ed9dd855e355f5e4d65c76938`. Aggregate settled RSS grew by 75.375 MiB after 100 edits, above the frozen 50 MiB budget. That result remains FAIL.

The first memory baseline measured an idle Vite server. It did not apply the candidate's edit workload. A later matched comparison used 50 UI edits and 50 Vite-config edits on both sides. Existing T7-1 Vite alone grew by a median 133.660 MiB across three sessions. The runner-loader prototype also failed; the native-loader prototype failed config dependency reload behavior. Neither flag is selected. Idle stability does not establish a plateau under repeated reloads.

This is an explicit post-failure plan deviation. The approved plan prohibited changing acceptance after a failed comparison. This proposal replaces the absolute acceptance requirement for T7-2 with matched regression conditions. Retaining the number 50 does not retain the original absolute guarantee. The original requirement remains failed as a separate finding. The justification is that the user authorized autonomous implementation, did not prescribe this numerical envelope, and the matched baseline demonstrates the same problem in the existing workflow. The proposal requires independent review before any new acceptance run. It does not declare Vite fixed or claim an unbounded leak.

The user authorized autonomous implementation and normal releases after verification. These numerical budgets originated in this plan. A separate independent reviewer must assess this proposed scope correction before it governs a new run. The normal shipping reviewer must then assess both the receipts and the remaining Vite limitation. No release follows from this document alone.

## Pre-registered comparison

Use the actual candidate PR head, including the zombie cleanup fix, against T7-1 main `0496aac81d0b1d6c6c61797e721f827a7420a8bf`. Both use the same application, dependencies, compiler, Node and Bun versions, and the default Vite loader. Record exact head, base, patch and command inputs before running.

Run one unmeasured warmup pair followed by seven interleaved pairs. Alternate baseline-first and candidate-first order. The baseline runs existing Vite alone. The candidate runs the actual checked development command with both native project watchers. Do not introduce a temporary loader flag, automatic process restart, forced GC or heap cap.

For each side apply the same 100 serial edits in 25 four-write cycles, in this exact order: UI invalid, UI repair, config invalid, config repair. The UI fixture is `src/perfTypeProbe.ts` with a named string assignment, and the config fixture is a named string assignment appended to a scratch copy of the actual config. Invalid assigns a number; repair assigns a string. Use the same fixture names and values in both arms. The candidate must observe 25 named TS2322 diagnostics and 25 repairs for each project. Each arm must observe all 50 completed Vite config reloads in the same PID. Do not use a generic zero-error message from the other project as repair evidence. Identify the reporting project from its output path or a project-specific output segment. The baseline has no native watch diagnostics.

At each edit write and close the file, then await its completion predicates. A config write requires the corresponding Vite restart completion in both arms and the expected config diagnostic or repair in the candidate. A UI write requires its candidate diagnostic or repair; the baseline has no UI completion event. Begin each subsequent write no earlier than 0.15 seconds after the previous write. This minimum cadence and completion barrier are fixed for both arms. Record actual write timestamps and every barrier overrun beyond 0.15 seconds. Never write ahead of an incomplete edit or coalesce updates. Readiness has a 30-second timeout and each edit has an eight-second timeout. A command exit, missing expected diagnostic, stale repair, missing reload or timeout is a workload failure. Preserve the failed pair and stop acceptance rather than retrying it as noise. Do not silently change cadence. An observer or capture defect must be identified separately, with its invalid artifacts retained, before a corrected run. Do not rerun valid samples to select a better outcome.

Serve and React transformation proof follows memory sampling; neither arm receives HTTP work during the comparison. After readiness, settle for ten seconds and capture sample 0. After edit 50 and edit 100, settle for ten seconds and capture those samples. The prescribed cycle produces 26 UI and 24 config writes in the first half, then 24 UI and 26 config writes in the second. Normalize the role-specific half-growth by those counts as defined below. Do not compare the raw checker half-growth as equal work.

Freeze observed membership immediately before sample 0. Identify every process by PID and kernel start time. The full process set `F` includes the real Bun package entry and its launch chain, the supervisor, both compiler launcher/native lineages, and Vite with every esbuild or other owned descendant. The added set `A` includes the checked command entry launch chain, supervisor, and the two compiler lineages; it excludes the Vite lineage. Define separate added lineages `entry`, `ui` and `config` before sampling. The `entry` lineage includes Bun, its shell if any, and the supervisor. Each compiler lineage includes its launcher and native descendants. The baseline set includes its real package entry launch chain and Vite descendants. Record the exact identity-to-role map in each receipt.

Sample membership at every edit and all three settled samples. Any observed new, missing or replaced owned PID/start-time identity before sample 100 invalidates the pair. Preserve it and stop the comparison for diagnosis. Do not drop a process or reset its origin. Expected shutdown after sampling is outside this identity rule. The observer cannot prove that it saw an arbitrarily short-lived process between samples; disclose that limit and include reaped-child CPU counters when reporting idle CPU. Record RSS and CPU counters, including raw shrinking values, for every sampled identity.

For a fixed process set `S` within one session, define `G(S,a,b) = sum(max(RSS(p,b) - RSS(p,a), 0) for p in S)`. Apply the floor to each process before summation. Convert bytes to MiB using 1,048,576 bytes. Compute each session's `G` first, then take medians across the seven sessions for that arm. Shrinkage never offsets another process's growth.

The memory acceptance conditions are all required:

1. `median(G(F_candidate,0,100)) - median(G(F_baseline,0,100))` is at most 50 MiB across the seven interleaved pairs.
2. `median(G(A,0,100))` is at most 50 MiB. This caps the combined added set, including entry and compiler launchers and native descendants. A lower Vite result cannot hide growth in the added processes.
3. For each added lineage, the median normalized positive growth in the second half does not exceed its first-half median. For `ui`, compare `G(ui,50,100)/24` with `G(ui,0,50)/26`. For `config`, compare `G(config,50,100)/26` with `G(config,0,50)/24`. For `entry` and for the combined set `A`, divide each half's growth by 50 total writes. Compare medians of the per-session rates. Report all raw half-growth values and all seven runs. This is a bounded nonacceleration check. It cannot prove a plateau or exclude a continuing linear leak.
4. Report aggregate absolute RSS, per-role absolute RSS, candidate-minus-baseline resident overhead and the original absolute-budget FAIL alongside the new conclusion.

Also retain the existing startup, edit-feedback, idle-CPU and cleanup limits. Fresh evidence must cover the actual fixed head. Profiled runs are excluded from acceptance samples. Failed attempts, observer corrections and limitations stay in the receipt.

## Remaining Vite finding

Record Vite reload RSS growth as a separate repository research finding with the matched baseline and allocation diagnosis. No upstream issue, comment or message is authorized by this amendment. A fix that changes Vite, its loader or ordinary development behavior needs separate scoped proof. The absolute gate remains failed until such a fix is demonstrated.

An accepted amendment permits T7-2 to be judged on the added regression conditions above. It does not close live terminal, lifecycle, dependency, CI, independent review, editor or release gates.
