# Audit ledger

<!-- audit-ledger/v1 -->

## Summary

- Total findings: 22
- Actionable findings: 17
- Remediation items: 17
- Dispositions: confirmed=13, hardening=4, measure_first=0, deferred=0, refuted=5
- Severities: critical=0, high=1, medium=13, low=3, informational=5
- Action priorities: fix_now=0, next=14, backlog=3, none=5
- Proof states: reproduced=2, source_proven=18, invariant_only=1, external_assumption=0, unverified=1

## Findings

### AUD-001 — Recovered Summary completion can be overwritten by stale frontend state

If startup hydrates the pre-Summary Note before a recovered backend job commits its generated Note, reconciliation polls only job status and does not reload or version-check the Note\. A later edit autosaves the stale visible body through an unconditional Entry update and can overwrite the generated Summary\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `distributed` — Packaged single-WebView desktop app when the WebView reloads while a Summary job remains active\.
- Trigger: Start a Summary, reload the WebView, let startup hydrate the old Note before backend completion, then edit the still-visible old Note after the job reports completed\.
- Guards and recovery: `partial` — Summary persistence checks the prepared database body and frontend write versions reject stale frontend responses, but generationActions\.ts:94-113 only restores terminal status; sessionActions\.ts:242-265 later saves the visible body without a backend revision precondition\.
- Disposition: `confirmed`
- Impact: `major` — The UI can misrepresent successful generation and a later user edit can replace the generated Summary with stale pre-generation content\.
- Severity: `high`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A current reconciliation path that reloads or revision-checks the active Note before edits can autosave would falsify the finding\.
- Sources:
  - `frontend/src/app/generationActions.ts:73-113 — reconcileActiveJobs / pollJobToTerminal`
  - `frontend/src/app/sessionActions.ts:242-265 — saveBody`
  - `frontend/src/app/useAppStartup.ts:68-85 — boot`
  - `src-tauri/src/commands/ai/job_runner.rs:198-212 — run_ai_action_job`

### AUD-002 — Session and output-library navigation lack latest-intent ordering

Session opens and cross-Session library loads have no shared request epoch or cancellation\. Rapid navigation can apply an older open or list response after a newer user choice\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — Normal desktop navigation through Session and cross-Session library views\.
- Trigger: Activate two records in different older Sessions before the first reopen resolves, or leave and re-enter a library while its earlier list request remains unresolved\.
- Guards and recovery: `partial` — Most controls disable after busy state renders and record hydration has local versions, but reopen occurs before openSession owns busy state and neither openSession nor useOutputLibraries rejects stale completions\.
- Disposition: `confirmed`
- Impact: `moderate` — The app can show a different Session or stale library contents until another navigation or reload\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A single-flight or epoch-based coordinator covering reopen, Session open, library load, and operation-scoped busy release would falsify the finding\.
- Sources:
  - `frontend/src/app/sessionActions.ts:89-121 — openSession`
  - `frontend/src/app/useAppController.ts:257-263 — openLibraryRecord`
  - `frontend/src/app/useOutputLibraries.ts:21-55 — loadDraftLibrary / loadFindingLibrary`

### AUD-003 — Provider discovery requests can overwrite newer observations

Fast startup status, automatic Settings discovery, preflight refresh, and manual refresh write the same provider state without request identity, so an older completion can replace newer deep discovery\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — Desktop startup, Settings, and generation preflight all invoke provider observation paths\.
- Trigger: Start deep or manual discovery while the post-boot fast request is unresolved, then resolve the newer request first and the older request last\.
- Guards and recovery: `partial` — Automatic discovery suppresses some duplicate requests, but startup and deep paths do not share an epoch and setters do not compare request generation or depth\.
- Disposition: `confirmed`
- Impact: `moderate` — Fresh provider catalog/default evidence can regress to older or shallower state, misleading readiness and configuration UI\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A request coordinator that prevents fast or older results from replacing newer deep observations would falsify the finding\.
- Sources:
  - `frontend/src/app/useAppStartup.ts:31-39 — provider startup refresh`
  - `frontend/src/app/useSettingsDiscovery.ts:15-37 — useSettingsDiscovery`
  - `frontend/src/hooks/useSettingsController.ts:82-114 — provider status loaders`

### AUD-004 — Blank Session titles bypass dirty-state protection

The title input accepts blank text, but autosave, forced save, navigation, and close predicates all require a truthy trimmed title\. A cleared title is silently discarded while the UI can still report Autosaved\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — Normal Session title editing in the packaged desktop app\.
- Trigger: Clear the active Session title, wait past autosave, then navigate or close without changing another field\.
- Guards and recovery: `ineffective` — Every title dirty/save predicate requires a nonempty trimmed title, so no backend validation, save error, or close guard runs for blank local state\.
- Disposition: `confirmed`
- Impact: `moderate` — The user receives false persistence feedback and loses the attempted edit, although the previous valid title remains stored\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A frontend invalid/dirty state that blocks or explicitly discards navigation and close for blank titles would falsify the finding\.
- Sources:
  - `frontend/src/app/sessionActions.ts:76-87 — hasPendingSessionEdits / saveNoteNow`
  - `frontend/src/app/sessionActions.ts:268-285 — saveNoteNow`
  - `frontend/src/app/useAppController.ts:395-405 — title autosave effect`
  - `frontend/src/app/usePendingChangeProtection.ts:42-48 — hasPendingChanges`

### AUD-005 — Managed attachment previews are re-read on editor updates

Editor synchronization schedules hydration for every managed image, and hydration invokes the Tauri preview command even for already-resolved IDs\. Typing in image-bearing records can repeatedly read and base64-transfer the same files\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — Rich Note, Testware, and Finding editing in the desktop WebView\.
- Trigger: Open a rich record with managed images and type repeatedly\.
- Guards and recovery: `partial` — Same-turn work is coalesced and stale DOM application is rejected, but resolved and in-flight preview reads are not cached across transactions\.
- Disposition: `confirmed`
- Impact: `moderate` — Image-heavy records incur avoidable file reads, allocation, and large IPC responses on the typing path\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A resolved/in-flight cache or proof that hydration does not run on editor updates would falsify the finding\.
- Sources:
  - `frontend/src/editor/editorHtml.ts:25-45 — hydrateManagedAttachmentPreviews`
  - `frontend/src/editor/RichTextEditor.tsx:236-265 — value and update effects`
  - `frontend/src/editor/RichTextEditor.tsx:376-383 — queueManagedPreviewHydration`
  - `src-tauri/src/commands/files.rs:59-68 — get_attachment_preview_data_url`

### AUD-006 — Generation cancellation is not authoritative across readiness and persistence

Per-job cancellation does not reach provider readiness, and after provider execution returns there is no cancellation check before final persistence\. Relevant running and terminal JobStore transitions also do not enforce cancellation-state preconditions\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — User cancellation of an active AI action in the desktop app\.
- Trigger: Cancel during deep readiness, or cancel after provider output is classified but before finish\_ai\_action\_generation persists its result\.
- Guards and recovery: `partial` — Streaming checks JobControl and kills registered process trees, but readiness uses separate cancellation, job\_runner\.rs:182-200 has no final control check, and jobs\.rs terminal transitions can replace Cancelling\.
- Disposition: `confirmed`
- Impact: `moderate` — Cancellation can stall for bounded readiness time or still produce a persistent Draft, Finding, or Note and report Completed\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Cancellation-aware readiness, a final persistence guard, and state-conditional JobStore transitions would falsify the finding\.
- Sources:
  - `src-tauri/src/commands/ai/job_runner.rs:96-212 — run_ai_action_job`
  - `src-tauri/src/commands/ai/provider_execution.rs:26-50 — execute_provider_generation_streaming`
  - `src-tauri/src/jobs.rs:275-367 — mark_running / complete / cancel`

### AUD-007 — Neutral provider directory creation fails open

If creation of the fresh private provider directory fails, discovery and generation silently run in the shared process temporary directory despite the accepted neutral-discovery invariant\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `distributed` — All local provider inspection and generation subprocesses use this working-directory abstraction\.
- Trigger: Make UUID directory creation fail while the shared temporary root remains available, then run discovery or generation\.
- Guards and recovery: `ineffective` — provider\_command\.rs:57-67 unconditionally returns env::temp\_dir with owned=false and callers receive no error or degraded-scope signal\.
- Disposition: `confirmed`
- Impact: `moderate` — Provider behavior can inherit files or configuration from a shared non-owned directory, weakening privacy and reproducibility\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A fail-closed path or fallback that still guarantees a newly owned private directory would falsify the finding\.
- Sources:
  - `docs/adr/0010-session-workspace-and-cli-discovery.md:54-57`
  - `src-tauri/src/commands/ai/streaming_exec.rs:109-125 — ProcessProviderExecutor::execute`
  - `src-tauri/src/commands/providers/probe.rs:105-130 — SystemProbeRunner::run`
  - `src-tauri/src/provider_command.rs:43-67 — NeutralProviderCwd::new`

### AUD-008 — Provider temp cleanup test races parallel tests

A cleanup test snapshots all same-process probe directories while other tests create directories with the same prefix outside its local mutex\. The full Tauri suite failed once and the isolated test passed\.

- Proof state: `reproduced`
- Reachability: `normal_path`
- Deployment: `not_deployed` — Rust validation and CI only; production cleanup behavior was not implicated\.
- Trigger: Run qa-scribe-tauri tests in parallel with the global-snapshot cleanup test overlapping another same-prefix ProbeOutputFiles test\.
- Guards and recovery: `ineffective` — The mutex in providers/tests/mod\.rs is not shared by probe/command\.rs tests; isolated rerun passing after full-suite failure confirms an inter-test observation race\.
- Disposition: `confirmed`
- Impact: `moderate` — Required CI or release validation can fail nondeterministically and normalize reruns\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Path-specific assertions or one shared lock across every same-prefix test would falsify the finding\.
- Sources:
  - `src-tauri/src/commands/providers/probe/command.rs:92-109 — ProbeOutputFiles::new`
  - `src-tauri/src/commands/providers/probe/command.rs:206-235 — probe_output_directory_and_files_are_private`
  - `src-tauri/src/commands/providers/tests/mod.rs:23-38 — provider_probe_cleans_temp_files_when_spawn_fails`
  - `src-tauri/src/commands/providers/tests/mod.rs:108-126 — provider_probe_temp_files`

### AUD-009 — Structured protocol output can fall back to raw JSON

A zero-exit structured provider run with no recognized assistant event falls back to complete raw stdout\. Nonempty protocol JSON survives content validation and can be persisted, including Summary when the selected Note has not changed\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `distributed` — Local structured Claude/Codex provider execution; current documented formats are recognized, so the trigger is malformed or future/unsupported protocol drift\.
- Trigger: A structured provider exits zero after emitting only malformed or unsupported nonempty event records\.
- Guards and recovery: `partial` — Line and total output are bounded, malformed events produce progress, and Summary checks the prepared Note body; executor\.rs:111-117 still falls back to raw stdout and workflow validation rejects only sanitized-empty content\.
- Disposition: `confirmed`
- Impact: `moderate` — The app can create apparently successful records containing protocol envelopes; an unchanged Note can be replaced by that content during Summary\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Rejecting successful structured runs with no parsed assistant text, while retaining raw fallback only for plain text, would falsify the finding\.
- Sources:
  - `crates/qa-scribe-core/src/ai/executor.rs:106-117 — ProviderGenerationOutput::response_text`
  - `crates/qa-scribe-core/src/ai/stream/mod.rs:73-90 — push_json_line`
  - `crates/qa-scribe-core/src/generation/workflow.rs:223-264 — finish_successful_generation`
  - `src-tauri/src/commands/ai/streaming_exec.rs:178-225 — StreamingProcessExecutor::execute`

### AUD-010 — Preserve evidence off still restores source images

The user-visible preserveEvidence preference reaches prompt text and metadata, but Testware completion restores omitted managed and external source images unconditionally\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `distributed` — The option is exposed in the desktop generation preflight and consumed by core generation\.
- Trigger: Uncheck Preserve evidence, generate Testware from a Note with an image, and have the provider omit that image\.
- Guards and recovery: `ineffective` — workflow\.rs:293-297 calls preserve\_managed\_attachment\_images regardless of the preference value\.
- Disposition: `confirmed`
- Impact: `moderate` — Generated Testware contradicts an explicit user choice and can retain screenshots or external Evidence intended for omission\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A documented advisory-only contract or conditional restoration keyed to preserveEvidence would falsify the finding\.
- Sources:
  - `crates/qa-scribe-core/src/generation/preferences.rs:41-52 — TestwareGenerationPreferences`
  - `crates/qa-scribe-core/src/generation/preferences.rs:197-235 — testware_preferences_prompt`
  - `crates/qa-scribe-core/src/generation/workflow.rs:287-319 — finish_testware_generation`
  - `frontend/src/workflows/generationPreflight.tsx:183-190`

### AUD-011 — Rich-record patch logic is duplicated across persistence paths

Rich body merge, validation, SQL update, and readback mechanics are repeated across Entry, conditional Entry, generated Summary, Draft, and Finding paths\. Transaction boundaries are intentionally distinct, but patch resolution and column mapping must change together\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `deployed` — Normal record editing and AI Summary persistence in the local Rust core\.
- Trigger: Change rich-body patch semantics, validation, or format defaults and update only some repeated paths\.
- Guards and recovery: `partial` — Shared validators, row mappers, and transactions limit drift, but no shared typed patch resolver exists and the conditional Entry update has no production caller\.
- Disposition: `hardening`
- Impact: `minor` — No current mismatch was proven, but future storage/editor changes carry synchronized-change and regression risk\.
- Severity: `low`
- Action priority: `backlog`
- Confidence: `high`
- Falsifier: One shared patch resolver used by each transaction wrapper, plus removal or coverage of the unused conditional API, would falsify the smell\.
- Sources:
  - `crates/qa-scribe-core/src/services/session_service/drafts.rs:82-122 — update_draft`
  - `crates/qa-scribe-core/src/services/session_service/entries.rs:83-178 — update_entry / update_entry_if_body_matches`
  - `crates/qa-scribe-core/src/services/session_service/findings.rs:76-117 — update_finding`
  - `crates/qa-scribe-core/src/services/session_service/generation.rs:220-285 — complete_ai_run_with_generated_note_update`

### AUD-012 — HTML sanitizer is not quote-aware when locating tag ends

The Rust sanitizer and projection scanner use the first raw greater-than character as a tag terminator\. A valid greater-than inside a quoted attribute can split and corrupt the tag, though allowlisting still blocks a demonstrated script-execution path\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `deployed` — All generated Draft, Finding, and Summary HTML passes through these scanners\.
- Trigger: Return valid allowed-tag HTML with an unescaped greater-than inside a quoted attribute, such as img alt="A \> B"\.
- Guards and recovery: `partial` — Allowed tags and safe URL schemes are rebuilt and active attributes are dropped, but outer scanners use find('\>') without quote state\.
- Disposition: `hardening`
- Impact: `minor` — Generated content and attributes can be silently corrupted; no security bypass was demonstrated\.
- Severity: `low`
- Action priority: `backlog`
- Confidence: `high`
- Falsifier: A quote-aware tokenizer/parser and regression tests for quoted delimiters would falsify the finding\.
- Sources:
  - `crates/qa-scribe-core/src/generation/html_projection.rs:25-63 — HtmlPromptProjector::project`
  - `crates/qa-scribe-core/src/generation/response.rs:170-209 — sanitize_editor_html_fragment`
  - `crates/qa-scribe-core/src/generation/response.rs:265-350 — sanitize_opening_editor_tag`

### AUD-013 — Final release packages are not installed or executed

The final deb, rpm, AppImage, and DMG receive varying metadata, signature, or existence checks but are not installed or executed\. The generated APT setup deb is also not installed and its installed keyring/source files are not verified\.

- Proof state: `invariant_only`
- Reachability: `failure_path`
- Deployment: `distributed` — These are the package formats and repository bootstrap delivered to users\.
- Trigger: Introduce a package-only dependency, loader, permission, payload, or setup-file defect that preserves currently checked metadata and signatures\.
- Guards and recovery: `partial` — Source-build E2E, metadata extraction, codesign/notarization, Gatekeeper, checksums, and mocked installer flow provide substantial coverage, but no final-format install/execute check exists\.
- Disposition: `hardening`
- Impact: `major` — A release can distribute an installer that cannot install or launch, requiring asset replacement or a corrective release\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Format-appropriate disposable install and smoke checks for each required package, including setup-file verification, would falsify the gap\.
- Sources:
  - `.github/workflows/ci.yml:209-235`
  - `.github/workflows/release.yml:301-346`
  - `.github/workflows/release.yml:478-499`
  - `scripts/check-apt-installer.mjs:143-268 — validateAptInstallStaging`
  - `scripts/validate_linux_package_metadata.py:317-427 — validate_package`

### AUD-014 — Required E2E cases share state and cancellation uses fixed timing

All four critical E2E cases share one app-data directory and application instance\. The cancellation case races a provider fixture that begins output after 350 ms and completes after 1050 ms rather than waiting for a deterministic test signal\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `not_deployed` — Required Linux CI/release gate and observational macOS gate\.
- Trigger: Run on a loaded runner or let an earlier case fail with persistent state before the cancellation case executes\.
- Guards and recovery: `partial` — The suite is isolated from user data, uses one instance, and has explicit UI waits, but it lacks per-case reset and the fixture has fixed timers with no hold/release handshake\.
- Disposition: `confirmed`
- Impact: `moderate` — The gate can flake or become order-dependent, weakening confidence and encouraging reruns\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Fresh app state per case plus a cancellation fixture that blocks until explicit release or process termination would falsify the finding\.
- Sources:
  - `docs/quality-scenarios.md:19-29`
  - `e2e/fixtures/bin/codex:22-49`
  - `e2e/specs/critical-workflows.e2e.mjs:65-153`
  - `e2e/wdio.conf.mjs:9-23`
  - `scripts/run-e2e.mjs:9-46`

### AUD-015 — Code-size policy omits maintained YAML workflows

The enforced maintained-file extensions omit yml and yaml, so the 785-line release workflow is invisible to threshold, watch-range, and dated exception checks despite documentation naming it as an operational watch item\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `not_deployed` — Repository maintainability policy executed in CI and release validation\.
- Trigger: Grow or modify a YAML workflow beyond policy thresholds and run code-size:check\.
- Guards and recovery: `partial` — Python and other source extensions are scanned with dated exceptions, but SOURCE\_EXTENSIONS excludes YAML entirely\.
- Disposition: `confirmed`
- Impact: `minor` — A major release-control surface can accumulate mixed responsibilities while the automated policy reports success\.
- Severity: `low`
- Action priority: `backlog`
- Confidence: `high`
- Falsifier: Scanning YAML with fixture coverage and a current split or reviewed exclusion for release\.yml would falsify the finding\.
- Sources:
  - `.github/workflows/release.yml:1-785`
  - `docs/code-size-guidelines.md:55-63`
  - `scripts/check-code-size.mjs:7-35`
  - `scripts/code-size-policy.json:5-20`

### AUD-016 — Version bump writes can leave a partial repository state

The version bump builds a complete plan in memory but overwrites seven files sequentially\. A later write failure leaves earlier files updated, and the next preflight refuses to continue because versions disagree\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `not_deployed` — Maintainer release-preparation command whose outputs feed package and release metadata\.
- Trigger: Make a later target unwritable or exhaust storage after one or more earlier writeFile calls succeed\.
- Guards and recovery: `partial` — All files are read and transformed before writes and preflight catches prior drift, but the write loop has no staging, rollback, or resumable recovery\.
- Disposition: `confirmed`
- Impact: `moderate` — Release metadata can be left inconsistent and require manual source-control recovery before the tool can run again\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: A tested staging/rollback or explicit resumable transaction that restores consistency on write failure would falsify the finding\.
- Sources:
  - `scripts/bump-version.mjs:61-92 — main`
  - `scripts/bump-version.mjs:121-149 — preflightConsistencyCheck`
  - `scripts/bump-version.test.mjs:189-212`

### AUD-017 — Authoritative cargo-audit tooling is unpinned

The shared CI/release action installs the latest available cargo-audit on every run, while other release-critical tools are pinned\. Unchanged source can therefore gain new tool behavior independently of advisory database updates\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `not_deployed` — Authoritative CI and tag validation environment\.
- Trigger: A new cargo-audit version is published and a subsequent validation run installs it\.
- Guards and recovery: `partial` — The audit runs locked and reconciles advisories strictly, but neither --locked nor the exception registry constrains the cargo-audit executable version\.
- Disposition: `hardening`
- Impact: `moderate` — The required gate can change or break without a repository change, reducing validation reproducibility\.
- Severity: `medium`
- Action priority: `next`
- Confidence: `high`
- Falsifier: Pinning and deliberately updating cargo-audit through reviewed tooling would falsify the finding\.
- Sources:
  - `.github/actions/validate-build/action.yml:89-99`
  - `docs/ci.md:28-44`
  - `scripts/check-rust-audit.mjs:91-116 — run`
  - `scripts/tool-versions.json:1-3`

### AUD-R01 — Current schema initialization and migrations are retry-safe for deployed paths

The audit did not find an application path that stamps the current schema version before all feature-detecting helpers and foreign-key checks succeed\. Current-version drift requires out-of-band local mutation, while interrupted older migrations retain the old version and retry\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `deployed` — SQLite initialization on desktop startup\.
- Trigger: Interrupt an older migration or externally corrupt a database while retaining its current user\_version\.
- Guards and recovery: `effective` — Destructive helpers use immediate transactions, helpers detect existing features, foreign keys are checked, and user\_version is written last; newer versions are rejected\.
- Disposition: `refuted`
- Impact: `none` — No reachable app-controlled incomplete-current schema or non-retryable migration was demonstrated\.
- Severity: `informational`
- Action priority: `none`
- Confidence: `high`
- Falsifier: A migration step that is neither transactional nor idempotent, or a path that stamps current before checks complete, would reopen the candidate\.
- Sources:
  - `crates/qa-scribe-core/src/storage/mod.rs:72-144 — initialize / migrate`
  - `crates/qa-scribe-core/src/storage/mod.rs:252-326 — migration helpers`
  - `crates/qa-scribe-core/tests/session_storage/migrations/integrity.rs:1-37`

### AUD-R02 — useStableCapability has no demonstrated reachable stale-context failure

The Proxy-backed capability pattern is unusual, but critical mutable state uses refs and write versions, and no concrete UI or native event was shown to invoke a stale context after commit but before its passive effect update\.

- Proof state: `unverified`
- Reachability: `unknown`
- Deployment: `distributed` — Shared frontend action-factory mechanism\.
- Trigger: Hypothetical action invocation after a render commits but before the context ref passive effect runs\.
- Guards and recovery: `partial` — Proxy reads occur at invocation time, critical state has refs and write versions, and lifecycle tests cover several stale async paths; no concrete trigger was established\.
- Disposition: `refuted`
- Impact: `none` — No evidenced product impact; unusual implementation alone is not an actionable smell\.
- Severity: `informational`
- Action priority: `none`
- Confidence: `medium`
- Falsifier: A reproducible handler or native event reading previous context in the post-commit window would reopen the candidate\.
- Sources:
  - `frontend/src/app/useAppController.lifecycle.test.ts:12-76`
  - `frontend/src/app/useSessionWorkspace.ts:18-34 — workspace refs`
  - `frontend/src/app/useStableCapability.ts:8-26 — useStableCapability`

### AUD-R03 — Tauri command and capability surfaces are aligned for the current trust model

Build registration, Specta handler and bindings, default permission, generated permissions, and the main-window capability agree\. The single bundled-code WebView model does not justify splitting the current command capability without a new principal boundary\.

- Proof state: `reproduced`
- Reachability: `normal_path`
- Deployment: `distributed` — Production main WebView capability in the packaged desktop app\.
- Trigger: Run the repository command-surface checker and assess authorization against the current single-principal threat model\.
- Guards and recovery: `effective` — The checker reported 33 aligned commands; the capability targets main, withGlobalTauri is false, and no arbitrary WebView path or executable command was found\.
- Disposition: `refuted`
- Impact: `none` — No command drift or missing current principal boundary was found\.
- Severity: `informational`
- Action priority: `none`
- Confidence: `high`
- Falsifier: A mismatched command representation, remote/multi-principal content, broader production permission, or arbitrary path/process command would reopen the candidate\.
- Sources:
  - `docs/tauri-threat-model.md:5-23`
  - `frontend/src/bindings.ts:5-48 — commands`
  - `src-tauri/build.rs:8-47 — COMMANDS`
  - `src-tauri/capabilities/default.json:1-7`
  - `src-tauri/permissions/default.toml:3-39`
  - `src-tauri/src/specta_bindings.rs:39-85 — builder`

### AUD-R04 — E2E promotion markers enforce platform-specific first-attempt history

The promotion checker separates Linux and macOS names, derives markers from the actual E2E step outcome, deduplicates run IDs, rejects failures and attempts other than one, and paginates through unrelated artifacts\.

- Proof state: `source_proven`
- Reachability: `normal_path`
- Deployment: `not_deployed` — CI evidence used for platform promotion decisions\.
- Trigger: Audit artifact history containing unrelated items, mixed platforms, failures, and reruns\.
- Guards and recovery: `effective` — Outcome-derived names, platform prefixes, pagination, newest-by-run deduplication, and runAttempt checks implement the documented metric\.
- Disposition: `refuted`
- Impact: `none` — The proposed marker-integrity bypass was not present\.
- Severity: `informational`
- Action priority: `none`
- Confidence: `high`
- Falsifier: A path that uploads matching passed names after failed E2E or counts duplicate runs/attempts would reopen the candidate\.
- Sources:
  - `.github/actions/run-built-app-e2e/action.yml:29-86`
  - `scripts/check-e2e-reliability.mjs:21-74 — assessReliability / listArtifacts`
  - `scripts/check-e2e-reliability.test.mjs:15-92`

### AUD-R05 — Failed APT staging cannot partially deploy to Pages

Although APT output is built incrementally, it is confined to a fresh runner staging directory\. Artifact upload and Pages deployment require preceding signing, setup, validation, release-asset publication, and monotonic checks to succeed\.

- Proof state: `source_proven`
- Reachability: `failure_path`
- Deployment: `not_deployed` — Release runner staging before live Pages deployment\.
- Trigger: Fail signing, setup-package construction, installer validation, or artifact upload after staging writes begin\.
- Guards and recovery: `effective` — set -e staging, downstream job dependencies, and monotonic checks prevent the partial runner tree from becoming the live repository\.
- Disposition: `refuted`
- Impact: `none` — A staging failure leaves ephemeral files only and cannot update Pages\.
- Severity: `informational`
- Action priority: `none`
- Confidence: `high`
- Falsifier: In-place live writes or deploy behavior after failed staging would reopen the candidate\.
- Sources:
  - `.github/workflows/release.yml:429-570`
  - `.github/workflows/release.yml:735-770`
  - `scripts/build_apt_repository.py:473-523 — build_repository`
  - `scripts/check-apt-monotonic.mjs:80-106 — checkMonotonic`

## Remediation

### AUD-001 — Recovered Summary completion can be overwritten by stale frontend state

Reconcile recovered completion by action type, reload or revision-check the active Note, preserve dirty local edits, and make Note saves conflict-aware\.

### AUD-002 — Session and output-library navigation lack latest-intent ordering

Introduce latest-intent request ordering for Session and library navigation without adding a global state framework\.

### AUD-003 — Provider discovery requests can overwrite newer observations

Centralize provider observation ownership and apply monotonic request/depth ordering while retaining independent catalog and default lifecycles\.

### AUD-004 — Blank Session titles bypass dirty-state protection

Treat every title difference as pending, validate required text explicitly, and never label an invalid title as autosaved\.

### AUD-005 — Managed attachment previews are re-read on editor updates

Cache previews by attachment identity, deduplicate in-flight reads, and hydrate only nodes whose identity or resolved source changed\.

### AUD-006 — Generation cancellation is not authoritative across readiness and persistence

Pass per-job cancellation through readiness, check before persistence, and enforce legal state transitions with deterministic race tests\.

### AUD-007 — Neutral provider directory creation fails open

Return an actionable error or create another guaranteed-private directory; never execute providers in the shared temp root\.

### AUD-008 — Provider temp cleanup test races parallel tests

Assert cleanup for the exact temporary path created by the test, avoiding process-global before/after snapshots\.

### AUD-009 — Structured protocol output can fall back to raw JSON

Make output format explicit in response\_text and fail structured runs without recognized assistant content using an actionable compatibility error\.

### AUD-010 — Preserve evidence off still restores source images

Define the preference contract explicitly and skip deterministic restoration when false while still sanitizing provider-returned images\.

### AUD-011 — Rich-record patch logic is duplicated across persistence paths

Extract only shared rich-body resolution and column mapping; retain distinct transaction orchestration and stale-write guards\.

### AUD-012 — HTML sanitizer is not quote-aware when locating tag ends

Replace first-delimiter scanning with a quote-aware tokenizer or maintained HTML fragment parser, preserving the current allowlist\.

### AUD-013 — Final release packages are not installed or executed

Add post-build package smoke jobs: install deb/rpm in disposable environments, execute AppImage, mount/copy/launch the DMG app, and install/verify the actual setup deb\.

### AUD-014 — Required E2E cases share state and cancellation uses fixed timing

Split or reset cases into isolated app sessions and make the cancellation fixture deterministic rather than time-raced\.

### AUD-015 — Code-size policy omits maintained YAML workflows

Add yml/yaml to maintained-file scanning and apply the existing dated exception model to the release workflow\.

### AUD-016 — Version bump writes can leave a partial repository state

Stage all outputs, replace atomically where possible, and roll back already-replaced files on failure; inject write failures in tests\.

### AUD-017 — Authoritative cargo-audit tooling is unpinned

Add cargo-audit to the reviewed tool-version source and install that exact version in shared validation\.
