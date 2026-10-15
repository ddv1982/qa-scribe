# Generation preflight laptop layout

## Phased checklist

- [x] Phase 1 (R1, R2, R3, R6): reproduce the native overlap/reachability defect before repair, implement explicit header/body/footer and compact readable metadata/options, verify focused behavior/native evidence and `bun run verify`, obtain independent review.
- [x] Phase 2 (R2, R3, R4, R6): inspect light/dark native screenshots at 1366×768, 1280×720 and 640×720 logical viewport sizes; verify notices/long content, keyboard/scroll reachability and generation/cancellation; run maintained desktop suite and repository gate, obtain independent review.
- [ ] Phase 3 (R5, R6): confirm next version and refreshed main, prepare a release with the repository bump script and full checks, push reviewed PR and verify protected CI; checkpoint for separate merge authorization, then verify exact merge/tag/Release publication and final independent review.

Re-read before each phase. Check only after its checks and review pass. Approved Flow plan is authoritative. Existing typography and product semantics stay intact; use existing design tokens and deterministic native fixtures. No client-specific examples.

## Scope and design

The screenshot shows overlapping execution-summary text and Test design, oversized metadata rows and technique cards, and cut-off options. The current Testware grid declares four rows but optional notices add children, while only options scroll. Replace this fragile mapping with an explicit header, one scrollable body (metadata, notices, options), and an action footer outside that body. Compact repeated metadata and technique choices while retaining readable fonts, full descriptions, provenance, warnings and every preference control.

Canonical whole-repository gate: `bun run verify` (docs/ci.md and docs/releasing.md). Native WDIO screenshots and geometry supplement it. Capture a genuine failing native assertion before repair; do not confuse harness setup failures with the defect. Assert actual logical width and height, not only physical window requests. Inspect pixels as well as geometry.

Release is tentatively v0.8.6, subject to remote state. Follow docs/releasing.md: dedicated checkout based on current main, scripted version bump, exact staged diff, protected CI, separate merge authorization, workflow-owned tag and actual publication verification.

## Preserved existing work

Do not edit, stage or revert these pre-existing dirty files:

- docs/chat-permission-v0.8.3-plan.md
- docs/chat-tool-authorization-plan.md
- docs/chat-tools-plan.md
- docs/markdown-formatting-plan.md
- docs/session-chat-plan.md
- docs/testware-streamdown-plan.md

## Evidence

Phase 1 baseline: native validation `7b5a6a69-013e-481a-b891-16caa2ba6198` ran `QA_SCRIBE_E2E_SCENARIO=generation-cancellation QA_SCRIBE_E2E_ARTIFACTS=artifacts/generation-preflight/before xvfb-run -a bun run e2e` against original product code (local HEAD `15cac4a`, only native regression integration added). It completed with exit 1 on the meaningful assertion: “Execution summary bounds and text must end before Test design/options: summary bottom=415, painted bottom=438, Test design top=411, options top=411”. Actual logical viewport was 1280×720. Before screenshot and geometry are under `artifacts/generation-preflight/before/critical-workflows/generation-cancellation/`.

After repair: `38a90ac0-f01e-417b-92b0-82ee9a61a307` passed the same maintained native scenario with `QA_SCRIBE_E2E_ARTIFACTS=artifacts/generation-preflight/after`, checking all six theme/viewport combinations plus initial checkpoint and actual generation/edit/save/reopen/cancellation. Screenshots and `generation-preflight-geometry.json` live under that invocation's `critical-workflows/generation-cancellation/`. Canonical `bun run verify` passed as `c2a97b49-2026-4c26-9f8e-e7339951e97a`. Component coverage includes exact preference payloads, warnings/advisories, long metadata/provenance/timestamp, provider/busy blocking, Configure AI/cancel and other actions.

Intermediate failures retained: initial component test `1a2b0746-00ec-43ef-89d6-e49a1d1df845` used word-boundary selectors against concatenated accessible button text in JSDOM, fixed to actual public names. Native `0bc23bcf-f450-4371-968f-7125a30811bb` passed layout matrix then timed out waiting for Note autosave during existing Streamdown reopen setup; screenshot already showed Note saved. Unchanged rerun `38a90ac0` passed the complete scenario. No timeout relaxation or assertion removal.

Phase 1 independently passed at revision 14 (assignment `review:76437ed0-1487-4099-98e3-fb9fe35aa880`), no findings. Final current gate `00bda2e0-3c3f-49e2-881f-9a9608ad9fa1` passed; a prior transient Rust cancellation-fixture `Text file busy (os error 26)` was retained in `47dc9d40` and passed unchanged on rerun, without Rust changes. Phase 2 will add actual keyboard navigation and explicit horizontal/body/header/footer assertions before full maintained suite verification. Long metadata and simultaneous notice state semantics are currently component-proven, not native screenshot-proven.

The original failing `before` artifact directory was preserved at `artifacts/generation-preflight/original-failure/` before rerunning the declared observe command against repaired current source (Flow requires current-source typed observations). The original assertion and validation ID above refer to that preserved run. Subsequent contents under `before` are post-repair verification, not failing-before evidence.

### Phase 2 coverage and prerequisite

The maintained native scenario now asserts a positive body height, bounded horizontal widths, header/body/footer separation and invariant header/footer bounds through scrolling. It captures initial and bottom states at all six size/theme combinations, including a valid 150-character Session title edited and saved through real UI. Long model/provenance and simultaneous warnings/advisories are covered via component props, not fabricated native DOM.

Embedded WebDriver keys did not produce default PageDown scrolling (`180a6781`); actual keyboard acceptance therefore uses existing Linux/X11 `xdotool`, opt-in via `QA_SCRIBE_E2E_NATIVE_KEYS=1` and `GDK_BACKEND=x11`. This invokes OS XTEST events in the isolated Xvfb display, requires one matching test-app window and verifies its identity/focus. The portable maintained suite still performs every layout/reachability check and Configure AI navigation, and explicitly records native keyboard coverage as not-requested. No CI dependency or gate change.

Real X11 command: `GDK_BACKEND=x11 QA_SCRIBE_E2E_NATIVE_KEYS=1 QA_SCRIBE_E2E_SCENARIO=generation-cancellation QA_SCRIBE_E2E_ARTIFACTS=artifacts/generation-preflight/native-keys xvfb-run -a bun run e2e`. Initial setup failures were package resolution (`4fea5758`), title above the 160-character limit and explicit navigation-save guard (`44f7e38f`, `dca1c86b`), and test-window identity including the native `(dev)` suffix (`cfa637ad`, `b4dbc104`, `60b84a45`, `54347f1f`). These are harness failures, not product overlap regressions.

Actual OS-keyboard `f4bd08a2-5e8d-48ac-af1c-24df1b1cdaa2` verified PageDown/PageUp and interior controls but found Tab from the last Generate button moved focus to BODY. Canonical `e69508d3-4844-42fd-9b60-073c24d45e6b` then failed both new focus-boundary regressions, 517 passing and 2 failing frontend tests. Bounded amendment `preflight-native-focus-wrap-prerequisite` adds only GenerationPreflight boundary wrapping, preserving native interior Tab and Escape behavior. Passing verification and phase 2 independent review remain pending.

After the boundary repair, actual X11 keyboard acceptance passed as `68260f08-58cf-490c-b558-26eca33b8caa` (59.1 seconds for the maintained scenario): PageDown/PageUp, complete 19-control Tab and Shift+Tab loops, focus rings, guidance reached/edited, output Gherkin/depth Thorough, Rules technique and all Include toggles changed without losing preferences, Escape restored exact trigger, Configure AI reached Settings, and Streamdown generation/save/reopen/cancellation completed. Evidence: `artifacts/generation-preflight/native-keys/critical-workflows/generation-cancellation/`. Selects use real OS keys because embedded select commands changed DOM without React events (`153e0fea`). Visibility hit-tests use the visible clipped portion, including WebKit's caret-line reveal on reverse Tab, while separate reachability checks scroll and test full controls. Intermediate center-only textarea and tiny-checkbox assertions (`307b8149`, `e2c15efc`, `8093062c`) were harness assumptions, not removed acceptance obligations. Complete portable suite and current canonical gate are next.

Portable whole native suite `xvfb-run -a bun run e2e` passed as `9b5100cb-6fd1-4c57-b6b3-3987b0766a8c`: all nine maintained isolated invocations, including expanded preflight matrix and original deterministic generation/cancellation. The manager inspected the native light 1366×768 long-title screenshot, dark narrow bottom/guidance screenshot and actual keyboard focus-ring screenshot. All essential text remains readable, options are scroll-reachable and actions remain bounded. `git diff --check` is clean; no tracked deletion, rename, type or executable-mode changes. Phase 2 final canonical gate and independent review pending.

Phase 2 accepted at revision 35, assignment `review:63d016bd-66fe-43f1-a130-a760fb993053`, no findings. Final current-source `bun run verify` passed as `411781aa-761d-49d9-8a04-b637f8ac839b`, including all 519 frontend tests and full Rust/build/smoke checks. Release preparation is next; publication remains subject to the green-PR merge checkpoint.

### Phase 3 release candidate and opening-context repair

Refreshed protected main is `fa309ca`, published latest v0.8.5. Release branch `release/v0.8.6` starts there. UI commit `26185d4` and scripted metadata/changelog commit `dfd7c3a` contain only approved changes. Bump ran in dedicated detached `/tmp/opencode/qa-scribe-release-v0.8.6`; expected TODO-placeholder failure was repaired with real changelog notes, metadata check passed and primary branch fast-forwarded. Local release checks `a186040e` passed frozen install, workflow checks, authenticated pinned Zizmor and exact v0.8.6 metadata; `507abedd` passed canonical gate. PR: https://github.com/ddv1982/qa-scribe/pull/37.

PR thread `PRRT_kwDOS4n2jc6s_qKH` correctly identified that first-technique autofocus can hide context/notices and capture-time scroll resets masked initial native state. New opening-focus regression failed canonical `a7b8e6df-e857-4266-b0a7-c521801f4199`, 519 tests passing/1 failing. Amendment `preflight-release-initial-context-prerequisite` focuses the noninteractive dialog heading and initializes body scroll at zero in the product. Native capture resets are removed entirely: opening assertions now inspect real heading focus and zero scroll before any reachability scrolling. Actual keyboard flow Tabs from heading to first choice before all existing paging/19-control loop assertions. Verification and exact PR-thread resolution pending.

Repair's v0.8.6 native actual-keyboard run passed as `fb5c8808-106f-4945-9576-26f3db515a4e` (73.1 seconds): all real opening assertions, all six logical size/theme combinations, context at top, keyboard preferences/focus loops/Escape, Settings navigation and generation/edit/save/reopen/cancellation. Current artifacts: `artifacts/generation-preflight/release-native/critical-workflows/generation-cancellation/`. The helper no longer writes any body scroll position. Final canonical gate, push, fresh CI and merge authorization pending.
