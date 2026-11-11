# Testware presentation parity

## Phased checklist

- [x] Phase 1 (R1-R3): record renderer and contract findings, preserve dirty-file hashes, observe a native parity check fail, unify supported document presentation and remove demonstrated conflicting CSS, then pass focused/native checks and `bun run verify` with independent review.
- [x] Phase 2 (R2-R4): verify live, saved, editable and reopened Testware at 1280/640 in light/dark themes, real persistence/editing, security and cancellation; inspect screenshots and pass maintained native E2E and `bun run verify` with independent review.
- [ ] Phase 3 (R5): prepare the next stable release through the scripted clean-checkout bump and protected PR checks, merge normally after success, and verify workflow-owned tag, successful Release run and published assets with independent review.

Re-read before each phase. Tick only after real checks and review. Record deviations before edits. The approved Flow plan is authoritative scope.

## Investigation and interpretation

Chat uses `react-markdown` plus `remark-gfm` in `MarkdownContent.tsx`, not Streamdown. Only transient Testware uses Streamdown, with normalized HTML supplied as one block. Completed and editable records use Tiptap. Chat's 13px document text and the rich editor's 15px font, differing task/image rules and wrapper-dependent margins create lifecycle differences despite some shared CSS.

This release aligns currently supported headings, emphasis, paragraphs, nested/numbered lists, checklists, safe links and managed Evidence images. Generated HTML and canonical Tiptap JSON remain authoritative. Tables, code blocks, blockquotes and other new editor/schema features require a separate content-contract change. No provider, prompt or storage migration is planned.

Cleanup is limited to demonstrated duplicate/conflicting presentation rules and obsolete adapters found at these renderer seams. Existing HTML/JSON sanitization, native image loading/cache, literal Markdown/entity handling and lifecycle guards remain required behavior.

Official Streamdown documentation fetched through Exa: https://streamdown.ai/docs/getting-started, https://streamdown.ai/docs/configuration, https://streamdown.ai/docs/security. Default styling expects Tailwind; custom components can preserve application semantics. Replacing default rehype plugins loses their default protections, and default image permissions are permissive. Retain the application's existing safe renderer boundaries. Ref lookup returned no results.

## Baseline and release process

Initial HEAD `e88690e`, branch `release/v0.8.7`; remote main observed `aa6fd4c662353eeff6148c46c0cc036df2c26909`, latest published release `v0.8.7`. Reconcile with current protected main before implementation. Candidate version is `0.8.8`, subject to remote recheck.

Preserve the seven initially modified documents: `chat-permission-v0.8.3-plan.md`, `chat-tool-authorization-plan.md`, `chat-tools-plan.md`, `generation-preflight-layout-plan.md`, `markdown-formatting-plan.md`, `session-chat-plan.md`, `testware-streamdown-plan.md`, all under `docs/`. Record initial hashes before edits and exclude them from commits.

Canonical gate: `bun run verify`, selected from README, root manifest and `docs/releasing.md`. Native focused command: `QA_SCRIBE_E2E_SCENARIO=generation-cancellation xvfb-run -a bun run e2e`. Full native suite: `xvfb-run -a bun run e2e`. Actual screenshots and persisted native values establish behavior, not compilation alone.

Publication follows `docs/releasing.md`: clean scripted bump, frozen dependencies, workflow checker, authenticated pinned Zizmor, broad gate, expected-tag metadata, explicitly reviewed commits/PR diff, protected hosted CI success and normal merge. The user authorized publication after success. CI owns routine tag creation at the exact merge SHA. Verify the actual Release run and non-draft assets before claiming publication.

## Evidence ledger

Phase 1 baseline: native validation `b9e03e81-ffab-46d6-a4ed-3d05b083f18e` failed the new checkbox/label geometry assertion. Actual live boxes: checkbox x326–338/y581–617, label x326–1226/y617–637. First heading margin was 24px. Screenshot `artifacts/e2e/critical-workflows/generation-cancellation/testware-streamdown-light-1280.png` visibly confirmed separate-line checkboxes and surplus heading space. Shared CSS will handle both canonical label-wrapped and sanitized direct-input task markup, remove the input's inherited 36px field height and consolidate task/image rules from editor.css. Record text alone adopts Chat's 13px scale; Note keeps its existing 15px scale.

Initial unrelated document SHA-256 values (same order as the preservation list above):

```text
442b7c042f4c2f3cedf749ff4dd612407b6f5740dc0ce8b788e62835fdfd0e28
ebcc04f2f1c80dc6141965b1b2f4feda6ef07a80dd58f7376521537d5ac17f8f
8719dc0af49a1191220e0810309fb3357fdc329a0f8aae1757927af2fdc18855
2414d5be74f5886432e1efad3d84640b079d30d356acd013e568d2ec2593d3f5
a1c5ac281d2509a0835c4fde244b4eb148519ebdebb0fe0401bf732e511c45ec
5f93481d20faea87a4d83c2c68b0b733ebfd8bcbdc32ebc0ed79b8e0ba0bf9b4
8ff835b8b9784703769c0740d38018dba225a9c1ae3a15aaf5793466d3d8d62c
```

Remote main and the local baseline differ only in release-history documentation, not application source. Integrate only this task's reviewed commits into the clean release branch from remote main.

Phase 1 passing native check `ab20d92b-3cfb-4a2a-bead-6414b19da8c9`: real held stream, both themes at 1280/640, semantic content, aligned checkboxes, managed image decoding, edit/save/reopen and cancellation all passed. Inspected light desktop screenshot shows checkboxes beside text and the first heading at the document's normal inset. Focused `bun run frontend:test && bun run frontend:check` passed (`1b6aa2e6-f26a-47c4-bb0f-67295163a230`): 520 tests, typecheck, lint, CSS colors and 54 contrast pairs. Full lifecycle visual matrix and multiline/long-content coverage remain Phase 2 work.

Review repair `testware-presentation.R10-01`: the first passing run overwrote the original baseline path. Reproduced the exact failing native assertion in detached worktree `/tmp/opencode/qa-scribe-parity-baseline` at original commit `e88690e4d234ccebef158d9ab40a8e37b0b0c422`, adding only the same eight E2E measurement/assertion lines (no production changes). Validation `8485964f-9b2d-41a5-a2f6-edeb3200a979` failed as expected in that baseline checkout. Retained screenshot and JSON are separately located at `/tmp/opencode/qa-scribe-parity-baseline/artifacts/e2e/critical-workflows/generation-cancellation/testware-streamdown-light-1280.png` and `testware-streamdown-evidence.json`. Inspected both: separate-line checkbox geometry and 24px heading margin exactly reproduce the first failure. These are historical baseline evidence, not passing current-source evidence. Do not run corrected tests in that checkout or overwrite those artifacts. Passing current-source evidence remains under the primary checkout's `artifacts/e2e/` directory.

User-authorized third attempt: copied the retained baseline screenshot, measured JSON and `wdio-run.log` byte-for-byte into the reviewer-accessible workspace directory `artifacts/testware-parity-baseline/`. Readback SHA-256 values are respectively `1b455bc26335e98cebee28f4c73955b2cb76861aa75888824c22d78200101020`, `71358d0b443e3206857078cd02be3d192352a15f2b6c9d6af6c7b96881e7a9cc`, and `378ce995154ebb61b2c20a16c029fe5de9569afbdd8919a9ec86fddcf0214e98`. This directory is distinct from passing current evidence and will not be overwritten by E2E runs.

The reproduced baseline used exact command `QA_SCRIBE_E2E_SCENARIO=generation-cancellation xvfb-run -a bun run e2e` in the detached original-source checkout named above. Its failure output is `Checkbox must sit beside its label, not on a separate line`; retained JSON shows checkbox x326–338/y581–617 versus label x326–1226/y617–637 and heading margin 24px. Host-owned observation metadata from Flow detail, unchanged:

```json
{"id":"8485964f-9b2d-41a5-a2f6-edeb3200a979","command":"QA_SCRIBE_E2E_SCENARIO=generation-cancellation xvfb-run -a bun run e2e","sourceDigest":"sha256:3937760de8a5b2bc172199346d1cf5f0410692ef46cb8a0e1439ab7b16ea94d5","exitCode":1,"outputDigest":"sha256:416c85577a956b9c5e9e6c07eca5f0ba59d697bf9ff20d1a26f24bbcc287e956","outputComplete":true,"recordedRevision":13,"hostPlatform":"linux"}
```

The host digest identifies its primary-workspace snapshot, not the explicit baseline command workdir. The original-source commit, unchanged production CSS and copied E2E output bind the historical reproduction; no current-source passing claim is made for it.

Phase 1 accepted at revision 24, review `review:d547267c-cd2f-4f84-ab5a-d166cea7ead6`, with prior finding resolved. Final checks: frontend `4dbfc951-38bc-4437-afc0-f04609db7198`, native `cdc4bbf6-9711-4b5c-8abc-51de69ae7a16`, broad `9d4a188b-913d-4a68-8e0a-caa6db70fa13` all passed.

Phase 2 interpretation: extend the maintained generated-content workflow's matrix to saved, editing and reopened records without synthetic DOM styling. Edit long checklist text and a safe long link through the actual WebView editor, persist it, and measure its reopened wrapping; existing standalone checklist coverage also exercises long Note/Record rows and toggles. Use a larger real managed image to verify responsive scaling. Keep the separate pre-fix evidence directory untouched.

Phase 2 focused native `b37ad91b-59ed-4929-89b4-f404f751706d` passed. The workflow retains 16 layouts in `artifacts/e2e/critical-workflows/generation-cancellation/testware-streamdown-evidence.json`, screenshots named `testware-{live,saved,editing,reopened}-{light,dark}-{1280,640}.png`. All states assert Chat reading scale, no initial heading margin, compact inline tasks, bounded 960px managed Evidence and no horizontal overflow. Saved and reopened reading/theme/resize matrices compare native Draft values before/after for no mutation. Actual WebView editing inserts wrapped checklist text and a safe long URL, then save/reopen retains content, task state, ordered start and attachment identity. The held second generation cancels without saved-record changes, injected script execution or requests reaching the hostile-image observer. Manager inspected saved light desktop, editing dark narrow and reopened dark narrow screenshots: hierarchical content, aligned checks, wrapped long text/link and scaled image remain readable and bounded. Live still uses the original deterministic short task fixture; the existing standalone checklist scenario covers long native Note/Record rows and persisted toggles. No authenticated-provider or arbitrary-browser-CSP claim is added.

Full maintained native suite passed `3ddadf7d-def4-47b4-8700-8e9f068e7dbd` (nine isolated invocations). Supplemental checklist run first failed `8eaa0f71-3f56-4427-a62a-a45b8ff0194d`: its stale ordinary-paragraph oracle expected 12px on the final document paragraph, contrary to the unchanged shared last-child rule. Corrected the test to distinguish the outer document boundary from nested list paragraphs. Subsequent failures exposed WebKit/WebDriver collapsing the Record text selection while scrolling the offscreen toolbar into view; diagnostic readback showed the intended selected text was empty before the click. The fixture now scrolls the editor-specific toolbar first, establishes the real selection without scrolling, allows ProseMirror to observe it, and asserts the selection still covers the first row immediately before formatting. No production command changed and no spacing, geometry, wrapping or persistence assertion was removed. Exact supplemental command passed `147db9a6-ab1b-4b17-b181-c9eb26a682bf`, including actual Note/Record wrapped rows, compact geometry, checkbox toggles and saved reopening at desktop/narrow widths. Final current-source full/supplemental/broad observations follow this ledger edit.

The first selection repair was timing-sensitive on its next run. Native Select All was also unsuitable because it includes the editor's appended empty paragraph. Final fixture repair keeps selection establishment and actual toolbar DOM activation within one WebView command, waits for focus/controlled-content settling, and requires both intended row texts to remain selected. Only establishing this precondition is bounded/polled for up to one second; the production formatting action executes once, with all two-row/style/geometry assertions still required afterward. Supplemental run `8e840200-5ac4-4b8b-89a9-5a75d4867a24` passed this final preparation path. No test exclusion, acceptance skip or production editing change was introduced.

Review repair `testware-lifecycle.R40-01`: initial matrix omitted live multiline tasks and safe links before editing. Expanded the real held-provider fixture in `e2e/fixtures/bin/codex` (an existing approved plan target) to accept escaped long task/link values from this scenario's private control JSON; other invocations retain their previous output. All 16 lifecycle captures now require a genuinely multiline task and the same safe long link, rather than only checking reopened content. The stricter native assertion failed before the fixture change (`80ec2b50-bed4-42a5-8f84-ba9926b51358`: `Long checklist text must actually wrap in every lifecycle state`). This is evidence completion within R2/R4, with no application renderer/provider behavior change or new format. Actual edit/save still appends reviewed text and verifies identity/cancellation unchanged.

Phase 2 accepted at revision 49, review `review:e7a397b2-d40a-4039-aa2a-a9aded0ae7c9`, no remaining findings. Final-source validations: focused native `9032bc46-c8d5-4641-b1ab-e65e6b0aecfc`, supplemental checklist `03bf8fac-2f46-44f8-8d59-2d1b90f262e3`, full native `df1ffce4-dc0e-4a2f-80be-4c41de4b8fde`, broad `2aebdb74-776e-48ae-8ff8-f4b591ed585b`, all passed. Inspected live dark narrow/light desktop and editing light narrow captures with multiline task and safe link present from the start. Prior incomplete fixture interpretation above is superseded by this repair.
