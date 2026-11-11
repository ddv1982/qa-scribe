# Independent PR84 layout review, round two

Verdict **FAIL** at head `1e8210ce7c869e1e6d3648ede869574f40ff0497` against base `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9`.

Stable base-to-head patch ID `be175b5c241e68e226f4321d232f8aa36bb01ad5`.

One new P2 is independently reproduced in the actual native application. The two original model-menu and permission-layout reproductions pass. No new P0 or P1 was established in this review. A newly supplied Sentry objection remains with the parent's separate source investigator.

## P2. A longer catalog can leave the short-window model menu invisibly open

At an actual `640×488` CSS viewport, the ordinary pointer-open control can leave all model choices inaccessible. This happens with 40 synthetic account models. The input is fully visible, but the popup remains `visibility: hidden` while the input reports `aria-expanded="true"`.

The fresh native pointer reproduction uses normal Settings controls, ordinary catalog discovery, a new Session, Chat, a literal unsent draft, actual native window resizing, and the visible **Open model choices** button. It waits six animation frames before inspecting the result. It injects no application write command or model-selection state.

Reproduction steps are:

1. Run the isolated long-catalog fixture through `run-long-catalog.mjs` with `long-catalog-pointer.e2e.mjs`.
2. Refresh the synthetic catalog through Settings and select its Claude-labelled local fixture.
3. Create a Session and open Chat. Keep a literal unsent draft.
4. Resize the actual WebView to `640×488`. Reveal the model input and click **Open model choices**.
5. Observe the expanded input and absence of the menu.

The measured input spans y=421.421875 through 461.421875. The AI panel spans y=308 through 488. The available spaces are 107.421875px above and 20.578125px below the input. With 40 models, the hint wraps to 44px. Popup chrome is 66px, and the first option requires 53px. The required 119px exceeds both available spaces.

[`placeChatMenu`](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/frontend/src/components/useChatModelMenu.ts:12) returns `null` when the available height is below that minimum. [`measure`](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/frontend/src/components/useChatModelMenu.ts:71) reveals the input only when the input itself is entirely clipped. It does not adjust a visible anchor when the menu cannot fit. The hook then publishes no box, and [the popup style](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/frontend/src/components/useChatModelMenu.ts:139) hides the open menu indefinitely.

The independent Home/End diagnostic also reproduces the failure after resizing through the maintained size matrix. At `640×488`, the last Claude option spans y=3000.625 through 3054.015625. It is invisible, has zero readable lines, and fails hit testing. Earlier `1280×828`, `360×645`, and `320×645` endpoint samples pass. A following Copilot diagnostic fails for the same reason because that failed test leaves the window short. That follow-on failure is not a second product finding.

Users cannot review or select the advertised catalog choices at this supported short viewport. Search input remains available, but opening choices gives no visible menu or explanation.

A bounded fix must provide a visible placement when the measured hint and one complete row do not fit beside the current anchor. Adjust the owned scroll position on opening or use a bounded panel placement that preserves the readable hint and internally scrolling options. Do not make a hidden expanded menu the final state. Preserve query, focus, provider preference ownership, and modal membership. Add a native regression using a multi-digit catalog and a wrapped hint at `640×488`.

Evidence is in [pointer-cause.json](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/long-catalog-pointer/pointer-cause.json), [the pointer screenshot](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/long-catalog-pointer/ordinary-pointer-640-488.png), and [the DOM-key diagnostic](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/long-catalog-corrected/dom-key-diagnostic.json). Raw logs are `/tmp/ask-ai-independent-r2-long-catalog-pointer.log` and `/tmp/ask-ai-independent-r2-long-catalog-corrected.log`. The pointer reproduction has zero passed and one failed. The corrected matrix has zero passed and two failed, including the dependent second failure described above. No assertion was suppressed or skipped.

## Candidate and build provenance

I did not write the patch. This review used one OpenAI reviewer with no nested agents. The tool-isolated checkout is `/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055`.

I built the actual candidate through the documented `scripts/run-e2e.mjs` workflow. The runner completed the production frontend build and typecheck, then compiled `qa-scribe-core` and `qa-scribe-tauri` with feature `e2e` in this checkout. Cargo reported a completed unoptimized build with debug information. The build log is `/tmp/ask-ai-independent-r2-build-ui-polish.log`.

The executable is `target/debug/qa-scribe-tauri`, SHA-256 `87a2fbd70ffeebf28a3f8a535ac7388fff9729579842e9e30963740ecdc5558d`. Every subsequent native wave checked this hash before launch. The same hash remains after all executions. No parent optimized binary or old review binary was launched.

Dependencies and the initial target cache were ordinary private APFS `cp -cR` copies. The private Vitest manifest inode is 242606073, versus source inode 236505870. The initial private executable inode is 242733891, versus source inode 242592069. Both samples have link count 1 and are not symlinks. A complete dependency symlink walk found zero escapes. These are build-cache inputs, not a claim that the copied executable was accepted without rebuilding.

[Source manifest](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/source-manifest.json) records all 271 added or modified destinations and verifies their contents against the exact committed head. Final verification finds zero changed source hashes and a clean tracked worktree. [Repair hashes](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/repair-hashes.json) contains all 12 latest-commit files. [Build provenance](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/build-provenance.json) retains the actual build commands and receipt.

Key new source hashes are:

```text
5af059cbd2eacc4d1cf83ac2a6627cbb00c0d5e9876b1f0c6e178b35ac5e8bd5  frontend/src/components/ModelSelector.tsx
0df076d90cc7fed2bf120db9b324d6c50ec965a43d43ea84183ef6d216cf49cd  frontend/src/components/useChatModelMenu.ts
e9dd9a3f0ccec81c2db6e6614a1e9e5e45cb269bfad0de8aa757cec57686de1e  frontend/src/styles/ask-ai.css
527e286de7572b8a1924d512e982b460c616baba1a2935eb1f684d5982ff900a  frontend/src/styles/chat-permissions.css
```

## Source judgment and original closures

The review covers the base-to-head implementation, its relevant callers, and the latest 12-file layout repair and altered test contract. The transient menu data consists of its anchor, panel boundary, measured box, query, and active option. Saved model preferences remain owned by the existing Settings controller. The hook introduces no provider catalog cache, provider identity, or persisted preference state.

I traced pointer-down ownership, React portal blur handling, choice focus restoration, disabled rows, active-row scrolling, query changes, resize, hidden anchors, and cleanup. The popup checks both root and portal contents before treating a pointer or blur as outside. Active-row reveal changes the owned option list scroll position. The hook attaches observers and listeners only while open. The additional cleanup test verifies exact document listener removal and observer disconnection on close and unmount.

Generation-preflight choices remain inside the modal subtree. Settings and local creation controls keep their existing `ModelCombobox` props and persistence owners. The fresh model-selection workflow verifies saved IDs, a delayed catalog refresh, preference changes during a pending permission, historical selection provenance, generation launch arguments, and native restart. Frontend checks verify preference-save failure retains the confirmed value and dirty Settings input survives a quick preference write. No unintended Settings or generation persistence change was found.

The permission repair changes layout rather than decision handlers. Identity, request scope, cancellation, and non-approval review focus remain unchanged. The maintained workflow now requires simultaneous full panel, context, identity, and control bounds when the panel fits. At `1280×828` and `1280×645`, that branch passes. At `640×488`, `360×645`, and `320×645`, the panel is taller than its owned viewport, so the workflow requires sequential readable context and complete reachable decisions.

The independent stronger diagnostic checks every actual literal argument and approval-scope line, including horizontal bounds, vertical clipping, and text hit testing. Its argument and scope line counts are respectively 1 and 2 at `1280×828`, 1 and 2 at `1280×645`, 1 and 3 at `640×488`, 2 and 5 at `360×645`, and 3 and 6 at `320×645`. Every line becomes readable. All four complete decision controls pass full bounds and all nine sampled interior hit points at every size. This is stronger than accepting an engine-scrolled center alone.

The original model pointer matrix passes at `1280×828`, `360×645`, `320×645`, and `640×488` with the maintained small catalog. Each option becomes fully visible and hit-testable through its owned list. The new P2 shows why that small-catalog pass is insufficient for general acceptance.

The established restoration-lease and Undo protections pass their fresh maintained frontend checks and four native probes. Conflict → Undo → Save preserves independently newer stored B for both record kinds. Ordinary authored edits after Undo remain saveable. The coordination, both persistence implementations, proposal controller, and editor-history sources are byte-identical to `92f332f`. The fallback parser and completion source are also identical. Fresh core suites cover malformed, wrong-nonce, unknown-field, strict-kind, durable fallback, transaction, context, image, and metadata behavior.

[Unchanged closure hashes](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/unchanged-closure-hashes.json) records exact current and previous SHA-256 values. For example, coordination is `140dc649e5f4480099c48ff68948c91112af7f979f3c2ee1fd55dccf140b1291`, proposal control is `03e9c6b4ce0cc0f3897e6561fe59f08919e0827d041505ccb3ecb12ecfbfefc1`, and fallback completion is `2d11e1887a8e1e92d7265a750e08964ef4af3b77888a0f6448573557b8e2906b`.

The prior 19 original frontend probes, 14 additional lease probes, and model-evidence first/restart pair are historical evidence, not fresh executions counted here. Their source identity bounds reuse. The model-evidence spec remains SHA-256 `0a014d811d47138d9a8c16c895e372a0ce37e7ff5859cd70bdabe24e4ce548b9`. Its schema and structured-cancellation contracts are unchanged by this repair. Fresh model-selection first/restart checks exercise the changed shared picker, so repeating the unchanged evidence pair was unnecessary.

The original feature workflows pass saved manual and generated record context, unsaved snapshots without record Save, shared Notes conversation, images, guarded proposal Apply and Save, literal choices, target pinning, expiry, and explicit editable Prepare action followed by user Send. The literal `Finding subtask` label remains. No Jira client, catalog, journal, remote verification, or real Jira operation was introduced or exercised.

## Executions and retained failures

| Check | Actual result |
| --- | --- |
| Targeted frontend | 16 files, 208 passed. Includes 62 maintained compensation/lease cases, model preference, permissions, history, nested transcript scrolling, and preflight. |
| Independent menu cleanup | 1 file, 1 passed. Exact listener and observer lifecycle checks. |
| Frontend check | Typecheck, type-aware lint, CSS checks, and 96 contrast pairs passed. |
| Core integration | Seven suites, 57 passed, zero failed, ignored, or filtered. |
| UI polish, with minimum-width option | 6 passed. Fresh build used for this and all later native runs. |
| Maintained model-selection first | 10 passed, 1 failed, zero skipped. The failure is the explicit Linux/X11 OS-key prerequisite. |
| Maintained model-selection restart | Its 1 test passed. Aggregate runner remains failed because the first-run keyboard lane remains failed. |
| Chat images | 1 passed. 82 visual rows, zero failures or blocked widths. Actual matrix height 645px. |
| Ask AI context | 7 passed, including 1100px split and 768px panel. |
| Generation preflight | 1 passed with 9 layouts and 2 heading variants. Native OS-key opt-in was not requested. DOM focus-wrap checks are not OS-key evidence. |
| Record workspace layout | 10 passed. All 16 scrolled captures have header gap 0px. |
| Refinement | 11 passed. |
| Jira conversation draft | 9 passed. |
| Original native Undo probes | 4 passed across both record kinds. |
| Codex authorization | 7 passed. |
| Claude-labelled protocol fixture authorization | 7 passed. Local fake executable only. |
| Copilot-labelled protocol fixture authorization | 7 passed. Local fake executable only. |
| Stronger complete permission readability | 1 passed at five actual sizes. Every argument/scope line and 9 hit points per decision checked. |
| Initial long-catalog diagnostic | 1 passed, 1 failed. First failure was an incorrect probe reopen assumption after Escape. Original probe and failure are retained. |
| Corrected long-catalog diagnostic | 0 passed, 2 failed. Real short-window hidden popup plus dependent short-window second failure. |
| Independent pointer confirmation | 0 passed, 1 failed. Confirms the P2 without DOM key events. |
| Separate remaining long-catalog query diagnostic | 1 passed. Query retention, exact/custom matches, saved literal model ID, focus, close, and hidden-panel dismissal. |

The initial private diagnostic clicked the already focused input after Escape and assumed that click reopened choices. Opening is owned by the component's focus handler or explicit button. I corrected only the probe to use **Open model choices** when collapsed. No assertion was removed. `long-catalog-first.e2e.mjs` and `long-catalog-probe-correction.json` preserve the original and corrected probe hashes and the reason. The corrected test then exposed the product P2. Its failure remains open and was not filtered out to obtain a passing matrix.

The separate remaining-query diagnostic starts a fresh Session at a large viewport to execute checks that the failed short-size assertion prevented. Its one pass does not change either failing verdict.

All native execution receipts and full runner output remain under [the artifact directory](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2). [Execution summary](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/execution-summary.json) reports failures unchanged. The full commands and environment selectors are in [exact-commands.txt](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/exact-commands.txt). The retained `run-native-wave.py`, `run-native-followups.py`, and private spec wrappers show fixture selection and actual numeric runner results.

Principal commands were:

```sh
QA_SCRIBE_E2E_SPEC=ui-polish.e2e.mjs QA_SCRIBE_E2E_MINIMUM=1 QA_SCRIBE_E2E_ARTIFACTS="$PWD/artifacts/ask-ai/layout-independent-r2/ui-polish" node scripts/run-e2e.mjs
python3 artifacts/ask-ai/layout-independent-r2/run-native-wave.py
python3 artifacts/ask-ai/layout-independent-r2/run-native-followups.py
bun run --cwd frontend check
bun run --cwd frontend test --config node_modules/.cache/layout-independent-r2/vitest.config.mts
cargo test --offline -p qa-scribe-core --test chat_context --test chat_questions --test chat_refinement --test record_write_guards --test attachment_cleanup --test chat_image_cleanup --test creation_migrations
node artifacts/ask-ai/layout-independent-r2/comment-audit.mjs
git diff --check 1c34f3e HEAD
```

Native and frontend commands used Node `v24.22.1` from `/tmp/ask-ai-node24/node-v24.22.1-darwin-arm64/bin`, `TMPDIR=/private/tmp`, and `NODE_OPTIONS=--no-experimental-webstorage`. Logs retain WebDriver Actions scrolling fallbacks, service mock-store cleanup warnings, and two window-state warnings in the Claude-labelled fixture run. Passing assertions do not imply warning-free execution.

## Independent no-comments audit

I read Poteto, its full Principles index, the applicable leaf skills, no-comments, and the portable Comment Sicko prompt. I performed the fresh independent role myself under the explicit no-nested-agent fence. No second reviewer is claimed.

Babel parsed all 92 changed JavaScript and TypeScript files. Zero comment nodes intersect added lines. Eight Rust Markdown comments are exact moved baseline comments. The generated permission header is emitted by installed `tauri-utils-2.9.3/src/acl/build.rs:293`. The apparent `*choice = ...` comment candidate is a Rust dereference assignment. Markdown candidates are prose. The sole added suppression-text match is a historical review sentence, not a directive. Four baseline `useAppController.ts` oxlint suppressions remain unchanged and unexpanded.

New manual comments 0. New code suppressions 0. Comment deletions 0. Restores 0. Audit reruns 0. MUST KILL flags 0. Architect sketches, fixes, encoding offers, encodings, and unenforced new comment constraints 0. Raw candidates and dispositions are retained in `comment-audit.json` and `comment-audit-dispositions.json`. No source edit was made to satisfy the audit.

## Docs-only successor and pending objections

I read `git diff 1e8210c..37f1e43`. Only `implementation.md` and the performance README change. The update correctly removes stale acceptance language, labels performance as historical to `20bbeaf`, records the prior combined FAIL and corrected local checks, and leaves fresh independent acceptance, performance, hosted CI, and release pending. The rewritten historical S1 statement avoids presenting its old limits as current results.

The parent supplied `/tmp/ask-ai-current-build-equivalence.json`. I read its recorded exact reviewed/current revisions, three frontend asset manifests, `allAssetsIdentical=true`, and `binaryIdentical=true`. Its parent production binary hash is `70f360b0187726abe39c3738ae799951f0fbf170197523ba500284c6ed2fc97e`. This is parent evidence for docs-only equivalence, not this review's E2E binary or an independent optimized build. My checkout remains at `1e8210c`. I did not cherry-pick `37f1e43`.

The parent reports a complete frontend gate of 103 files and 1,027 tests at `1e8210c`, with `/tmp/ask-ai-final-layout-parent-frontend.log`. That is separate parent evidence, not part of my 208-test count.

While this review ran, the parent supplied a [new Sentry objection](https://github.com/ddv1982/qa-scribe/pull/84#discussion_r4369193792) about lost IPC or a save follow-up leaving a proposal-origin guard after a durable `update_draft` commit and later conversation submission. The parent assigned a separate bounded source/controller investigator. I did not duplicate that probe. The objection remains pending in this report and is not dismissed by the passing earlier lease schedules.

The parent also reports a macOS native-tooling CI failure where `/bin/ps` observation returns status null after the two-second timeout in `scripts/check-native-editor-smoke.mjs`. Parent triage is separate. This review neither diagnoses it nor claims protected CI is green. The prior two local host-tooling failures were not rerun, and no full local `verify` pass is claimed.

## Input limits, authority, and release

All native automation used the documented WDIO fallback because a matching installed native-control skill is unavailable. Pointer interaction means WebView element-click transport. Programmatic focus, keyboard events, range inspection, hit testing, and DOM scrolling are explicitly DOM diagnostics. Native resize changes the actual application window. None proves physical OS mouse, keyboard, wheel, clipboard shortcut, or file-dialog delivery.

The maintained model-selection OS-key lane failed on macOS with the literal prerequisite error `Native keyboard evidence requires Linux/X11`. It was neither skipped nor converted to a pass. Hosted Linux must establish OS delivery and geometry after the P2 is corrected.

The 40-model catalogs came from private copies of the existing local fixture implementation inside the isolated runner directory. Their exact generated source and hashes are retained in each diagnostic artifact. Claude and Copilot labels denote fake protocol executables, not calls to those providers. Installed user databases and credentials were not read. Canonical application read APIs and ordinary UI control paths supplied assertions. The Undo adversarial probe changes one isolated synthetic SQLite title to model another writer; its acceptance observations are real UI Save outcomes and canonical reads.

No tracked source edit, commit, cherry-pick, push, PR review/comment post, real provider request, Jira operation, performance benchmark, publication, merge, or release occurred. PR84 is registered internally with this thread. Parent owns the code fix, the new Sentry disposition, final performance, protected CI, and release.

Applied principles changed concrete choices. Prove It Works required a fresh executable and actual native executions. Test Behavior, Not Implementation required full clipping and hit tests, literal durable state, and every argument/scope line. Model the Domain kept the transient menu box separate from saved provider choices and the Editor guard lease separate from intent settlement. Minimize Reader Load focused the source trace on actual geometry and preference owners. Build the Lever produced retained rerunnable manifests, wave scripts, and diagnostics. Unslop and technical-writing shaped this report. Throughput checkpoint is n/a for the read-only investigation. Trusted sticky activation was not verified.

**Native lane RELEASED.** At `2026-10-25T01:14:47.778488+00:00`, all 18 app PIDs and all recorded WDIO launcher/worker PIDs were absent. A fresh process inventory found no remaining QA Scribe candidate or named native driver process. No forced termination was needed. The model pair's isolated state was removed after retaining its fixtures. [Native-lane release receipt](/Users/vriesd/.t3/worktrees/qa-scribe/t3-13a7a055/artifacts/ask-ai/layout-independent-r2/native-lane-release.json) records exact PIDs, the empty remaining-process lists, the clean tracked status, and the final binary hash.
