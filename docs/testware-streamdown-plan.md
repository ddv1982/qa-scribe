# Streamdown for testcase generation

## Phased checklist

- [x] Phase 1 (R1, R2): investigate the existing path, observe a new behavioral regression fail, implement a safe Testware-only Streamdown preview, verify semantic/lifecycle coverage and the repository gate.
- [x] Phase 2 (R3): verify deterministic native streaming, completion, edit/save/reopen, cancellation, managed imagery and responsive themes, then run the maintained desktop suite and repository gate.
- [ ] Phase 3 (R4): prepare v0.8.5 from current main using the release script, verify local release checks and protected CI, checkpoint for separate merge authorization, then verify workflow-owned tagging and publication.

Re-read before each phase and check it only after its checks pass. Preserve all five pre-existing dirty plan documents. Use generic fixtures. The approved Flow plan is authoritative scope.

## Investigation and contract

The v0.8.4 dependency manifest contains react-markdown, not Streamdown. Chat uses `MarkdownContent`; testcase generation does not. `GenerationRecord` in `frontend/src/views/RichRecordView.tsx` renders `partialText` through a read-only Tiptap editor. Provider prompts in `crates/qa-scribe-core/src/generation/prompt.rs` require HTML fragments. Saved records use canonical HTML/JSON and remain editable through Tiptap.

Interpretation: Streamdown displays the transient `testware` generation preview. Retain the provider HTML contract, canonical saved records, existing editor, Chat renderer and other generation actions. Render normalized canonical HTML directly through Streamdown, rather than converting HTML to Markdown and back. Verify literal Markdown characters, headings, emphasis, nested and numbered lists, tasks and managed images. Progress/placeholder text remains literal. Block external image requests and unsafe navigation, and retain the existing attachment-preview command boundary/cache.

Current documentation fetched from https://streamdown.ai/docs/getting-started, https://streamdown.ai/docs/security and https://streamdown.ai/docs/configuration. Ref searches returned no results; Exa fetched the official pages. Streamdown supports raw HTML with rehype-raw, sanitization and hardening; custom plugin arrays replace defaults. Its image defaults are permissive and must be restricted. Use existing scoped application CSS without Tailwind or optional rendering engines. Pin the installed version and record actual bundle impact.

## Validation and release

Canonical gate: `bun run verify` (root manifest and `docs/releasing.md`). Native behavior must be observed separately in the built Tauri app; compilation is not behavioral proof. Record exact commands and results below. Keep regressions runnable in maintained E2E.

Remote baseline inspected: main `911696288092e1a404d40474e4ae3e0ded68df05`, latest published `v0.8.4`. Recheck before preparing v0.8.5. Follow `docs/releasing.md`: dedicated clean checkout for bump, frozen install, workflow checker, authenticated pinned Zizmor, repository gate and expected-tag metadata check. Commit only intended files, push release branch, open PR and require protected CI success. Separate merge authorization is required. The Release workflow creates the tag at that merge SHA and publishes only after platform and APT jobs succeed.

## Evidence

Phase 1: pinned `streamdown@2.7.0`. Failing-first `bun run --cwd frontend test src/content/TestwareGenerationPreview.test.tsx` produced 3 failures and 1 pass (validation `3ffcc90d-00a3-4909-b05a-331b6828228f`). Integration then exposed Streamdown's default `strong` span, which relies on Tailwind. Semantic component overrides preserve application typography and accessibility without Tailwind. The combined focused command passed 6 tests, frontend typecheck/lint/colors/54 contrast pairs and production build (`75711bc3-9ab2-4c47-bc5f-7a12146120f5`). This includes native-boundary managed-image resolution and late-result rejection on Session/job changes.

The first broad run exceeded its 200-second shell timeout while compiling the cold Rust dependency cache. No product failure was inferred. Retried `bun run verify` with a sufficient timeout passed (`cd218d09-4b21-4b16-a35e-4697589b7d3b`): 506 frontend tests, 154 release-script tests, package metadata tests, Rust checks/tests/build and smoke. Three existing authenticated-provider Rust tests remain intentionally ignored by the maintained suite.

Production Vite output after integration: application 245.30 kB (65.38 gzip), editor 442.33 kB (135.59 gzip), vendor 819.90 kB (259.22 gzip), icons 14.79 kB (5.37 gzip), CSS 66.20 kB (10.98 gzip). Streamdown adds dependency/bundle cost; the existing >500 kB chunk advisory remains visible. No optional engines or Tailwind were installed. Native layout/performance and full lifecycle verification belong to Phase 2 and are not inferred from these unit/build results.

### Review recovery: testware-streamdown-preview.R12-01 and R12-02

The original failing-before record is present in Flow detail (run `run:555eaad3-c07d-4746-9cad-ef5978439f22`, revision 4), but was omitted from the first review's current-source validation projection. Its host-owned metadata, retrieved unchanged from that detail:

```json
{"id":"3ffcc90d-00a3-4909-b05a-331b6828228f","command":"bun run --cwd frontend test src/content/TestwareGenerationPreview.test.tsx","sourceDigest":"sha256:44d1325175adf2bf52debfbadd528f86bc31b7fc6e950e03945ede23e6562aa9","exitCode":1,"outputDigest":"sha256:aeef04e03d56b4c11e1193b177346427e024a89e64a6d9d182e79f984af4b0fa","outputComplete":true,"recordedRevision":4,"hostPlatform":"linux"}
```

Observed output from the pre-implementation test itself:

```text
Test Files  1 failed (1)
Tests  3 failed | 1 passed (4)
FAIL uses Streamdown for live Testware while preserving canonical HTML semantics and literal text
FAIL updates incomplete HTML, keeps progress literal, and retains cancellation controls
FAIL keeps scripts, unsafe links and remote images inert without losing safe links or escaped tags
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Generated content"
error: script "test" exited with code 1
```

This was an application render/assertion failure, not an import or build failure: the original DOM output contained the Tiptap read-only textbox, parsed `<strong>Starting</strong>` progress, and an actual `img` with `src="https://example.test/tracker"`. The non-Testware baseline case passed. Current tests pair the renderer/region assertion with content, list/task, literal-text and security assertions; merely adding a marker does not satisfy them.

R12-02 repair: parse the raw stream into an inert template, replace remote images before existing normalization, and use a literal wrapper to avoid legacy escaped-text promotion. Canonical output is also parsed inertly before managed-image tokens are introduced. Native request observation remains a Phase 2 check, not a claim based on final DOM alone.

### Phase 2 native evidence and bounded prerequisite

The maintained `generation-cancellation` scenario now observes a held provider chunk through Streamdown before allowing completion. The fixture pads the first event beyond the Rust reader buffer, writes a partial marker, and waits for an explicit release file. The native test verifies headings/emphasis, literal Markdown and escaped tags, nested and start-7 ordered lists, checked/unchecked disabled tasks, decoded managed imagery, no injected script execution, and zero requests reaching a loopback HTTP observer. It changes theme through Settings and checks actual 1280/640 logical WebView widths, bounded content and imagery, and four screenshots. The scale calibration handles the embedded driver's physical units on this 2x WebKitGTK display. Early failing viewport checks were test-harness failures, not product fixes.

Completion creates exactly one Testware Draft. The test edits with the real WebView editing command, saves through the UI, switches Sessions and reopens the original, verifies persisted HTML/JSON and attachment identity, then cancels a second held generation and confirms no active jobs and unchanged saved records. It uses the existing paste handler to put managed Evidence in the source Note; importing an unattached image alone was correctly rejected as generation Evidence. Generated titles derive from the Session, so saved-record selectors use their stable accessible suffix.

Native completion also exposed a genuine prerequisite: `sanitize_generated_rich_html` dropped `ol start`. Canonical `bun run verify` failed the new `generated_ordered_lists_preserve_safe_starts_without_other_attributes` regression (`c8df4bd3-6aa6-4ea4-a58c-2733bc87b139`, exit 101): actual `<ol><li>Case</li></ol>`, expected `<ol start="7"><li>Case</li></ol>`. Amendment `testware-streamdown-ordered-start-prerequisite` authorizes only safe-integer start preservation, invalid/overflow rejection and stripping other attributes. A tiny concrete `response/lists.rs` helper keeps the existing response module at its enforced 500-line limit; there is no schema, migration or prompt change.

After repair, focused Rust/native command `cargo test -p qa-scribe-core generated_ordered_lists_preserve_safe_starts_without_other_attributes && QA_SCRIBE_E2E_SCENARIO=generation-cancellation xvfb-run -a bun run e2e` passed (`38dde709-b521-4cd5-8d83-df8ea0930314`). Full `xvfb-run -a bun run e2e` passed all nine maintained isolated invocations (`d08b24b0-fb9e-4c77-abc2-a19c1af2e54d`). Evidence: `artifacts/e2e/latest-run.json` and `artifacts/e2e/critical-workflows/generation-cancellation/{wdio-execution.json,wdio-run.log,testware-streamdown-evidence.json,testware-streamdown-{light,dark}-{1280,640}.png}`. Inspected light desktop/dark narrow screenshots show readable hierarchical content and bounded layouts. Checkboxes currently occupy a separate line above their labels in the Streamdown preview, a nonblocking density difference from the saved editor.

The zero-request observation covers this actual native CSP environment, not an assertion about arbitrary browser CSP configurations. The canonical saved editor retains its existing remote-image policy, independently of the transient preview's alt-text fallback. No authenticated-provider, app-restart persistence, or clipboard payload readback is claimed.

Phase 2 independent review passed at Flow revision 31 (`review:1353d763-d7c2-46d5-b68f-c9c6543684b3`). Final source-bound native evidence `5d230ee7-caa0-4a85-8f30-b1ec5694e4cf` is retained separately under `artifacts/testware-streamdown/critical-workflows/generation-cancellation`; broad `b47b9bda-b929-4bdb-b1d6-5ea11db3b179` passed after the prerequisite repair. Advisory `testware-streamdown-native.R30-01` records the nonblocking task density difference. Phase 1 independent retry passed at revision 18 with both R12 findings repaired.

### Phase 3 release preparation

Created `release/v0.8.5` from current protected main `9116962`. Implementation commit `a3342abba38780eef22e265ad0852de1ca8482c7` includes only the 15 reviewed implementation/test/checklist files. The dedicated clean detached checkout `/tmp/opencode/qa-scribe-release-v0.8.5` ran scripted dry-run and real bump. The expected placeholder verification failed until release notes were filled; explicit metadata then passed. Release commit `0292fb8be2c0d8d4b0e5c892b76c750f4b82a452` contains only seven scripted metadata/changelog files and was fast-forwarded into the primary release branch.

Frozen install, pinned workflow checker, authenticated `zizmor==1.30.1` (no findings), and expected-tag v0.8.5 metadata checks passed (`b8c846e2-9611-4233-90fe-6de6bd0922e3`). The release broad gate twice failed the existing `commands::providers::probe::lifecycle_tests::successful_probe_cleans_its_owned_private_scope` with `Text file busy (os error 26)` launching a just-written temporary shell fixture (`8cd4c7bd-5199-412b-b3fa-d0736365dae7`, `e527b4ad-f08b-4c14-bf3f-4bd513fb3be2`, exit 101). The exact isolated case passed between failures (`5d3329e0-1e1d-487f-9c27-1a8f211ab373`). Amendment `testware-streamdown-release-fixture-prerequisite` changes only the test helper to read that fixture through `/bin/sh`, avoiding kernel execution of the newly written file. All lifecycle/cleanup/cancellation/no-spawn assertions and production provider execution remain unchanged. Required broad validation must pass after this compatibility repair before pushing.
