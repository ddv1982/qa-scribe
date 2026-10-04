# Codebase improvement plan, 2026-10-04

Approved Flow goal: research and review qa-scribe, its architecture and complexity, then implement verified improvements. See [review](codebase-review-2026-10-04.md) for findings and standards.

## Execution checklist

- [x] Prerequisite amendment: Resolve frontend high-severity dependency advisories without suppressing audit or weakening checks; verify compatibility and rerun canonical gate.
- [x] plan-00: Persist researched review, coverage limits and baseline `bun run verify` evidence; obtain independent review.
- [x] plan-01, REV-001: Demonstrate delayed provider stdout-EOF regression, repair bounded normal shutdown, verify streaming lifecycle suite and independent review.
- [x] plan-06, REV-006: Demonstrate probe descendant leakage, repair owned process cleanup, verify provider suite and independent review.
- [x] plan-02a, REV-002: Demonstrate oversized/size-integrity read failures, bound reads and move expensive attachment work to native blocking workers, verify attachment/file behavior and independent review.
- [x] plan-02b, REV-004: Implement transactionally persisted exact-path cleanup, truthful partial success and bounded startup/manual retry; verify rollback/restart/live/unknown-file protection, UI feedback, bindings and independent review.
- [x] plan-03, REV-003: Demonstrate dry-run recovery mutation, validate arguments before mutation and refuse pending recovery read-only; verify CLI fixture preservation, normal recovery and independent review.
- [x] plan-07, REV-005: Demonstrate missing cross-tag publication serialization, wrap live check/deploy in fixed noncanceling job concurrency; verify workflow contract/order model, workflow linters and independent review.
- [x] plan-05: Run exact `bun run verify` and Linux `bun run e2e`, reconcile all findings and evidence, re-read checklist and obtain independent final review.

## Scope and sequencing

Run these units in listed order, stopping for checks and independent review. Re-read this file before each unit. Mark a unit complete only after its behavior checks and review pass. Record failing regressions before changing production behavior. Do not commit, publish or deploy as part of this plan.

Preserve the Rust core/Tauri/React architecture. No size-only refactor, new global state framework, connection pool, storage replacement or arbitrary orphan-file deletion is justified by this review. REV-004 authorizes a small additive SQLite exact-path cleanup outbox and typed partial-success IPC outcome. Delete only recorded managed paths, preserve live references and unknown siblings, and do not claim secure erasure.

Canonical repository gate: `bun run verify`. Additional final built-app gate: `bun run e2e` on Linux. A baseline failure is a blocker requiring classification and a supported same-goal prerequisite remedy; it is not a passing observation.

## Evidence log

Flow holds the immutable feature plan and host-observed command results. The
entries below are chronological milestones: an earlier pending-state statement
describes that moment, not the current implementation status.

- Baseline `bun run verify` failed at `frontend:audit` with 32 high-severity advisories (capture `d6937a71-6e21-4e5f-8992-ce126d88774c`). Later gate stages did not execute.
- A same-goal prerequisite amendment authorizes supported frontend dependency updates in `frontend/package.json` and `frontend/bun.lock`, with the canonical gate unchanged.
- `bun audit fix` and coordinated in-range Tiptap/DOMPurify updates reduced the next audit to five high advisories: basic-ftp, deepmerge-ts, braces and two extract-zip advisories. braces and extract-zip have no published patched version according to registry/advisory inspection on 2026-10-04. Supported in-range updates alone do not unblock acceptance.
- Compatibility check `bun run frontend:check && bun run frontend:test && bun run frontend:build` passed: typecheck/lint/CSS/46 contrast pairs, 38 test files and 295 tests, production build (capture `79778fd7-2884-4ee7-be97-b33960382aad`). This does not establish built-app E2E or native behavior.
- New tooling dependency graph: WebdriverIO 9.32.0, browser downloader 3.2.3, deepmerge-ts 8.0.0 and Mocha 11.7.5. High-severity frontend audit now passes; all five built-app scenarios pass (capture `5de9c46c-f4b7-475e-8aea-bd11f69a0535`). Mocha 12 was rejected after an import incompatibility.
- Canonical gate next failed at stale Rust registry metadata, not new Rust findings. A prerequisite amendment removes ten IDs no longer reported and reconciles summary without new exceptions or deadline extensions.
- Exact canonical baseline now passes, capture `b813364a-5920-4b63-a2b6-15a81a103fab`. No repair phase or independent review has completed; checklist completion awaits independent review.
- First independent review blocked on duplicate ProseMirror model identity (`plan-00.R16-01`); real-editor bullet/checklist regressions failed before repair. Retry adds model deduplication and native list editing/undo/reopen coverage. Embedded E2E does not test browser-download functionality (`plan-00.R16-02`); that unused path remains unverified.
- Model-identity regressions now pass (capture `c95c3e57-cb1b-4d31-a068-7562096cb842`); expanded native list editing/undo/save/reopen passes (`48465253-cc3d-4ac6-b062-a747b5b33d6b`). Undo uses a fresh Note-view editor; cross-Session history isolation remains an explicit follow-up, not a completed repair.
- Independent retry review passed at Flow revision 36. Current-source repository gate `4d69af0e-54ee-4f3f-a10d-63c0f2c17502` and five-scenario E2E `093a96f2-a7d8-4b04-b220-3da9060b0df6` passed, including 297 frontend tests and expanded list compatibility. plan-00 is verified; six product repairs remain pending.
- plan-01 passed independent review at revision 49: three EOF regressions failed before repair (`9a4488ac-9216-4b04-8f31-24e5f539245c`); all 16 streaming tests pass (`f08ccfc0-fe71-4a3a-a7b3-cf80551dd763`) and canonical gate passes (`a604d2b1-ed0b-4c1e-9855-f6372e0ab5eb`). Normal stdout EOF now permits a two-second grace while cancellation/watchdog remain active; pipe cleanup and actual exit status retained.
- plan-06 passed review at revision 56: completed-parent and unwind leak regressions failed before repair (`b5a61fd1-d811-4e8e-acfa-b29a9c018a16`); provider suite passes 81 tests with two existing live-provider checks ignored (`9b398eaa-d64c-43ed-9d66-f57773acbd80`); canonical gate passes (`096aa69c-2680-4cab-a2b9-f76de19979b5`). Owned Unix group cleanup and preserved parent results verified; Windows tree guarantees not established by Linux evidence.
- plan-02a passed review at revision 79: oversize/mismatched-size regressions failed before repair (`c95cf05c-a7be-4b1a-8cc3-ed27c36d0a57`), all attachment/file checks and canonical gate (`0fcd46d5-e40d-4688-bb67-a502afa3f503`) pass. Native image import/preview/copy/reopen passed (`bb1b03fb-9e46-471d-b01e-9f1955532b80`) against scripts verified byte-for-byte with the workspace snapshot at `frontend/src/test/attachment-native-validation.md`. Linux image pixels and explicit worker execution verified; other-platform behavior remains unverified.
- plan-02b passed review at revision 98: two deletion regressions failed before repair (`b6df0523-7380-4d37-b6d7-16cbfedde0b1`); schema 9 atomic exact-path queue, 50-path fair retry, rollback/restart/ack safety and live/unknown/symlink preservation pass. Current core/308 frontend tests, generated bindings and 35-command surface pass; canonical gate `cb12f601-e5d6-4564-ba0f-fa55f22773be` passes. Two real native launches (`3bfac40b-b8e1-4151-951b-2b8879006c6a`) prove pending warning survives restart, deletion stays committed and manual retry clears the queue without deleting unknown siblings. `pendingFiles: null` explicitly represents unavailable cleanup status after commit.
- plan-03 passed review at revision 106: interrupted dry-run/invalid CLI calls mutated the original fixture (`632ee680-29da-4e83-bb5a-8d6865969973`), then all transaction/bump/release checks and canonical gate (`2fc4a326-1d66-43e0-b0d6-10248dfe9a38`) passed. Dry-run pending recovery is refused read-only; valid mutation still recovers. Nonblocking advisory `plan-03.R105-01`: a dedicated `.next`-only interruption case remains a testing follow-up; source review confirms that discovery branch is read-only.
- plan-07 passed review at revision 117: original workflow/model tests failed (`0496e024-62aa-4865-82c5-0897e66c93cf`), then all 15 APT tests, actionlint and the documented compatible Zizmor 1.29.0/offline profile passed; canonical gate `8a665c0f-fd15-42d6-a478-0979eb56b473` passes. Fixed cross-tag job exclusion encloses the live check and deployment. Pending-job replacement, no hosted deployment evidence, and modern Zizmor 1.30.1's eleven low-severity recommendations remain explicit limitations. Advisory `plan-07.R116-01` tracks hosted audit/toolchain coordination.

## Closeout validation

The six prioritized repair features have passed independent review. The final
unit reruns these checks after the final report/checklist edits:

- Exact whole-repository gate: `bun run verify`.
- Linux critical built-app workflows: `bun run e2e`.
- Native image import/preview/clipboard/reopen: `node /tmp/opencode/qa-scribe-attachment-run.mjs`, whose executed files must match `frontend/src/test/attachment-native-validation.md`.
- Actual deletion/restart/retry lifecycle: run `e2e/specs/attachment-cleanup.e2e.mjs` in `delete` and `restart` stages through two complete E2E invocations sharing one fresh isolated `QA_SCRIBE_E2E_TEMP_ROOT`. The source fixture records the filesystem/SQLite/UI assertions. Keep both stages' host output as evidence.

Current-source final capture IDs are held in the final Flow assignment and
closeout history. Historical feature captures above remain historical rather
than being relabeled final. Mark the final unit only after checks and its
independent review pass, then re-read the checklist for unexplained omissions.

Remaining follow-ups are documented in the review, outside the six locked repair
outcomes: cross-Session undo-history isolation, hosted validator/toolchain
coordination (`plan-07.R116-01`), the `.next`-only CLI case (`plan-03.R105-01`), and
measurement/characterization before additional coordination refactors. Neither
modern Zizmor nor hosted CI, authenticated providers, macOS/Windows native
behavior, browser downloads or final distributable packages are claimed verified
by local closeout. No commit, push, tag or deployment is part of this plan.

## Follow-up inspection: cross-Session undo isolation

The earlier delivery is closed. This separately approved inspect-only Flow goal
investigates `plan-05.R123-03`; it does not authorize a product repair. Preserve
all earlier work. Temporary native observation fixtures are reproduced in the
existing review so the reviewer can inspect their exact source.

- [x] undo-inspect-01: Reproduce foreign-Note restoration in the real built app, read native persistence before/after undo and reopen, diagnose editor/history ownership, recommend a narrow fix, run exact `bun run verify` as gate-observe, and obtain independent review.

Focused observation: `node /tmp/opencode/qa-scribe-undo-observe-run.mjs`.
Its desired-isolation assertion may fail; retain that result as a product finding.
Run the focused observation and canonical gate after final evidence/report edits.
Do not claim that a passing repository gate proves undo isolation.

Inspection accepted by independent review at Flow revision 8. Current-source
focused observation `8b12ef2d-dabc-4fbd-97c3-e37b47a01bc7` exited 1, confirming
persisted foreign-Note restoration; canonical observation
`a28ae953-1c46-423e-8214-86ad0034e050` exited 0. These captures precede this
post-review checklist update. Finding `undo-inspect-01.R7-01` remains unresolved:
inspection acceptance is not repair acceptance. No product repair was made.

## Approved repair: Session-owned editor and toolbar

The user now authorizes repairing `plan-05.R123-03` / `undo-inspect-01.R7-01`.
The existing editor-card subtree will use `activeSession.id` as its React key.
Switching Sessions resets history and toolbar state; same-Session history
survives autosave and rerenders. Preserve the earlier dirty baseline.

- [x] Add real-view and native regressions; capture product assertion failures before editing production.
- [x] Key the editor-card subtree by Session identity; verify targeted history, toolbar, save and attachment lifecycle regressions pass.
- [x] Record evidence, run exact `bun run verify`, `bun run e2e` and the explicit native isolation spec against final source, then obtain independent review and close the repair.

Focused frontend command:
`bun run --cwd frontend test src/views/SessionEditorView.history.test.tsx src/editor/RichTextEditor.test.tsx src/editor/listIdentity.test.ts src/app/attachmentActions.test.ts`.

Focused native command:
`env -u QA_SCRIBE_E2E_SCENARIO -u QA_SCRIBE_E2E_SKIP_BUILD -u QA_SCRIBE_E2E_TEMP_ROOT QA_SCRIBE_E2E_SPEC=undo-history-isolation.e2e.mjs QA_SCRIBE_E2E_ARTIFACTS=/tmp/opencode/qa-scribe-undo-isolation-repair bun run e2e`.

The native spec checks same-Note undo/redo across autosave, Session roundtrips,
equal-content histories, blank new Sessions, pending-save flush, link-toolbar
reset and managed-image preview reload, with native HTML/JSON/Entry readback.
Controlled delayed import/preview interleavings use the actual view, editor,
registry and attachment actions with only native I/O mocked; this does not
claim a deterministically delayed native upload race or non-Linux coverage.
No dependency change, unrelated refactor, commit or release is part of this repair.

Before repair, component capture `5388ad19-2d78-4fe7-a8ba-e5438355308d`
failed five isolation regressions with 29 controls/supporting tests passing.
Native capture `f98b4508-2aa7-4d65-b6b4-d1d491784b5a` passed same-Note
undo/redo and failed distinct/equal/blank history and link-toolbar isolation.
Its pending-save case required a fixture scheduling correction; earlier
component initialization/expectation and native empty-paragraph setup failures
are not counted as product evidence. Host captures retain full failure output.

The production diff is one line in `SessionEditorView.tsx`. Focused component
capture `4a850b70-c97c-4c2d-a060-cb5513843878` passed all 34 tests; native
capture `88e6afd4-0fcb-4cdf-9026-5e1c8c38d736` passed all six cases, including
an unsaved edit followed by navigation at 22 ms and a managed PNG preview with
pixel `[18, 171, 52, 255]` after reopening. These are milestones before final
documentation, source-bound validation and independent review.

Canonical capture `9e465d59-08a9-4866-abb0-4307e873751c` stopped at
ESLint `prefer-const` in the new deferred-render test harness. Bounded amendment
`undo-repair-test-lint-20261004` replaces that handle with a const-backed mutable
container; it preserves safe initial callbacks and every assertion without
suppression or production edits. Final source-bound checks follow this correction.

Independent final review accepted `undo-fix-01` at Flow revision 25, with no
findings. `plan-05.R123-03` and `undo-inspect-01.R7-01` are repaired for the
approved Session-navigation contract. All four final Linux captures passed on
source `e48fb12c6fbc1a17e7dda4145319cc09b704756b388a81bb466e1100e1c4d996`:

- `ac6f0331-113b-4ec6-9f9a-b48f811d2bbb`: exact `bun run verify`, 316 frontend tests and repository/native gates.
- `c1653490-5d3f-4f8c-aa0f-519e53617e7a`: focused component/editor/attachment checks, 34 tests.
- `340b3e66-74d3-499e-93e3-6cf485b932eb`: explicit native isolation spec, six cases.
- `3d275cd0-92b4-4dcf-9031-540a153954ba`: exact `bun run e2e`, five isolated standard scenarios.

This post-review checklist update records accepted evidence; the captures
precede it. The production repair remains one line. Earlier pending milestone
statements are historical, not the current outcome. Work remains uncommitted.

## Checklist layout repair

Fix the user's stacked checkbox/text screenshot with task-list-scoped shared
editor CSS. Preserve content, history, ordinary list styles, previous work and
the running app's Session data. Use actual native geometry and screenshots.

- [x] Add a small native checklist layout check and observe the stacked-row failure before changing CSS.
- [x] Correct the four live TaskItem selectors; if measured Record input sizing requires it, add only a scoped compact checkbox override. Verify first-line alignment, wrapping, toggles and Note/Record contexts at desktop and narrow widths.
- [x] Inspect screenshots, run final native layout and exact `bun run verify`, obtain independent review, then close with all units verified.

Native command:
`env -u QA_SCRIBE_E2E_SCENARIO -u QA_SCRIBE_E2E_SKIP_BUILD -u QA_SCRIBE_E2E_TEMP_ROOT QA_SCRIBE_E2E_SPEC=checklist-layout.e2e.mjs QA_SCRIBE_E2E_ARTIFACTS=artifacts/checklist-layout bun run e2e`.
Geometry, actual viewport sizes and screenshots live under
`artifacts/checklist-layout`. No dependency, editor-content or controller change,
commit or release is included. Final checks must bind the reviewed source.

Before-fix capture `0d4751c1-c3ba-4fbf-858d-3e7b4fa0b5a0` reached the actual
Note NodeView and failed geometry: checkbox `(340,289,12,12)` versus first text
line `(338,310,201.48,19)`, a -14px horizontal gap and stacked lines. The
1280x816 viewport screenshot reproduces the user's layout. Paragraph/bullet
controls passed unchanged 12px bottom margin and 24px list indentation.
Narrow validation uses the existing test window's supported 640px minimum;
phone-width coverage and test-window configuration changes are not claimed.

Four selector corrections fixed Note rows. Capture
`c644ce45-3abd-4fd6-930a-bd3b180284b9` then measured a Record checkbox as
4x36px with an 11.5px first-line-center offset from generic input sizing. The
approved task-list-only width/height/padding reset restores native 12x12px
checkboxes without touching other inputs. The stylesheet remains 494 lines.

Focused milestone `aead13d1-5bda-4ad4-8a78-3a110c728912` passed actual Note
and Record geometry, wrapped text columns, toggles, native Note persistence,
Record save/reopen and unchanged paragraph/bullet spacing. Manager inspected
`note-desktop.png`, `note-narrow.png`, `record-desktop.png` and
`record-narrow.png`: text is beside the checkbox and wrapping remains aligned.
Recorded viewports are 1280x816 and 546x430 CSS pixels (the narrow native resize
request was 640 pixels). No phone emulation or unrelated responsive redesign is
claimed. Pixel-unit and Record navigation-prompt fixture corrections are not
product defects; assertions still check actual geometry and persisted content.
These are milestones before final document/source-bound checks and review.

Independent final review accepted `checklist-layout-01` at Flow revision 13
with no findings, verifying CHECKLIST-01..04 and preservation of 57 preexisting
baseline entries. Final source-bound checks passed on
`834356ba55ddf95a2836cd297f7d47c98b9559780a7fcad42507698fd4233e4a`:
canonical `c32f48fd-5952-49c5-ad2c-50c0854c796f` and native geometry/visual
check `f4e15cdc-7668-4092-9b59-8d35984eca3f`. Controls measure 12x12px,
10px text gaps and 0.5px first-line-center offsets at both actual viewport sizes.
This post-review checklist update records acceptance after those captures.
The development app was reopened and its server readback serves the corrected
styles. No commit or release was performed.

## Release-readiness inspection

Assess the complete accepted working tree for the actual release process.
This is inspection only: no branch/version/tag, staging/commit, PR/push/merge,
publication, deployment or product/config repair is authorized. Preserve prior
work. Report preparation blockers separately from local and hosted gates.

- [x] Verify candidate Git/version identity, published/live versions, protection, signing-input metadata, Pages and actual release triggers.
- [x] Observe frozen installation, current-tag metadata, provisional next-version APT guard, workflow lint/security and exact `bun run verify`; classify failures without repairs.
- [x] Record a phase-specific release decision and remaining commands, obtain independent inspection review, and close with every gap explained.

Focused commands:
`bun install --cwd frontend --frozen-lockfile`;
`node scripts/check-release-metadata.mjs --expected-tag v0.7.21`;
`node scripts/check-apt-monotonic.mjs --version 0.7.22`;
`actionlint .github/workflows/*.yml`;
`uvx --from zizmor==1.30.1 zizmor .github`.
Canonical inspect gate: `bun run verify` as gate-observe. A complete failure is
an inspection finding, not repair authority or passing release evidence.

Readiness identity/environment evidence (read-only Git/GitHub queries):

- Local `main`, remote `main` and remote `v0.7.21` all resolve to
  `c2a283310b6f43c489a1ed6bf24057e150e709e8`; accepted changes remain dirty and
  uncommitted. No remote `v0.7.22` was returned.
- GitHub's latest published release is `v0.7.21` (2026-07-21). Live APT is also
  0.7.21; guard observation `90582b4a-c3b3-41c7-9ce9-768577e18832` exited 0
  for provisional 0.7.22. This checks monotonicity only, without publishing.
- Main protection requires strict `CI success` and pull requests, with admin
  enforcement; required approving-review count is zero. Signing secret names
  and `DEB_SIGNING_PUBLIC_KEY` variable exist, including optional Apple identity
  and team names. Pages uses `build_type: workflow`. No secret values or current
  credential validity were inspected.
- Historical main CI [29872296403](https://github.com/ddv1982/qa-scribe/actions/runs/29872296403)
  and Release [29872296428](https://github.com/ddv1982/qa-scribe/actions/runs/29872296428)
  succeeded at the current committed HEAD. They do not validate this dirty tree.
- More recent Dependabot CI [34801700534](https://github.com/ddv1982/qa-scribe/actions/runs/34801700534)
  failed online Zizmor 1.25.2 at the same existing Rust-toolchain SHA pins
  (`impostor-commit`, two high findings) and Rust-cache version-comment mismatch
  (one medium). That run is not candidate evidence. The GitHub commit endpoint
  still resolves the Rust SHA, which does not prove branch-history membership.
- Actual `release.yml:3-8,46-92` runs on main and tags and can create the missing
  version tag on main, continuing the same publication pipeline. Documentation's
  manual post-merge tagging sequence is incomplete. Merging a version-bumped
  PR is the release trigger; do not routinely push a second manual tag.
- Observed local tooling: Bun 1.4.0, actionlint 1.7.12, Zizmor 1.30.1. CI's
  repository Bun pin remains 1.3.5; current PR CI must establish pinned-tool parity.

Local observation milestones before final source-bound checks:

- Frozen installation `c89ae689-ee98-45d1-a205-2bb6e19761d3` exited 0 with
  no dependency changes. Current-tag metadata
  `d1da83ea-b097-472c-9ede-0f9830590290` exited 0 for v0.7.21; this does not
  permit reusing its published tag or cover new release notes.
- Actionlint 1.7.12 observation `69dd99a1-541c-46f7-b2ec-25e17d506706`
  exited 0. Zizmor 1.30.1 defaults to offline without authentication and reports
  eleven low `self-repository` findings, requiring `$/` references that the
  current actionlint pin does not support. These remain toolchain-coordination
  work, not permission to suppress checks.
- A supplementary authenticated manager observation used an inline, ephemeral
  existing GitHub credential and ran the same Zizmor 1.30.1 audit online. It
  exited 14: two high `impostor-commit` findings at
  `.github/actions/setup-project/action.yml:47,54` for Rust-toolchain SHA
  `4cda84d5c5c54efe2404f9d843567869ab1699d4`, plus eleven low self-repository
  findings. No medium findings remained in this current online output. This
  observation is not a separate Flow validation capture; it is corroborated by
  the earlier hosted failure and inspected unchanged pins. Secret values were
  neither printed nor written to repository files. A prior cross-call export
  attempt still produced offline output and is not counted as an online audit.

Preparation classification and conditional next sequence:

1. The candidate cannot be released as-is: it is uncommitted, still uses an
   already-published version, has no new changelog section, and workflow auditing
   is not green. Local application verification is a separate assurance layer.
2. After separate preparation authority, preserve the complete accepted delta
   on `release/v0.7.22`, fix the actual action-pin/tooling audit blockers, and
   reconcile release documentation with the main-merge trigger. Do not change
   unrelated dependencies or weaken audit criteria.
3. Use the project bump script, optionally previewing `bun run bump 0.7.22 --dry-run`
   first. The real bump inserts a TODO and can fail its final check until real
   notes are supplied. New notes should cover Session undo isolation, checklist
   alignment, editor/dependency compatibility, provider lifecycle fixes, bounded
   attachment workers, schema-9 durable cleanup/retry, dry-run preservation and
   serialized APT publication. Preserve the published v0.7.21 section.
4. On the final candidate, run frozen installation, exact `bun run verify`,
   `node scripts/check-release-metadata.mjs --expected-tag v0.7.22`, and both
   workflow checks. Review/stage exact intended paths, commit and push the release
   branch, open a main-targeting PR and require current strict `CI success`.
5. Merge only with release authority: the main workflow creates the version tag
   at the merge SHA and continues through validation, draft creation, signed and
   notarized macOS artifacts, Linux packaging/install smokes, checksums, Pages
   and final publication. Do not normally push a second manual tag. Pages and
   checksum signing are separate downstream branches, so publication across
   channels is not atomic. Verify the final run, assets, tag SHA and live APT.

Current signing credential validity, macOS artifacts/notarization and final
installer/deployment behavior remain hosted/disposable-host gates, not local
inspection claims. Authenticated-provider smoke is explicitly optional. The
release-readiness decision and source-bound local gate still await final review.

Canonical milestone `4ab102b0-66fd-40e2-a05b-271bcfd158c6` completed with
exit 0: 316 frontend tests, native/repository suites, audits, contracts and builds.
This does not include the failing workflow audit or establish a releasable,
committed, version-bumped candidate. Final inspection validation reruns the
declared observations after this bookkeeping edit. Decision: prepare 0.7.22
only after separate authority to fix the observed release-gate blockers and
record the accepted change set; do not merge or publish the current tree.

Independent inspection review accepted REL-READY-01..05 at Flow revision 18.
Immediate release remains NO-GO, with residual findings:
`release-readiness-01.R17-01` (candidate preparation/hosted evidence),
`release-readiness-01.R17-02` (non-green workflow audit), and
`release-readiness-01.R17-03` (manual-tag documentation mismatch).
These are advisory under the inspection contract, not low release impact.

All final declared observations are complete on source
`9f3f6c2884fa19fe00922c90cae166b5c89a7a4dcb70e55ca298ea5aeb915004`:
frozen install `6324ba3c-ef47-498d-b134-ebf7f5815044` exit 0;
current-tag metadata `e1181712-0cd5-44db-bcb0-218514cb0490` exit 0;
APT preview `07333646-badd-444b-84b7-fc809a122a07` exit 0;
actionlint `007889d5-bc42-47c1-a77d-df704d528d0b` exit 0;
offline Zizmor `da3149f4-0d10-4bff-abeb-94d092bbd80c` exit 12;
exact canonical gate `500e8f90-c868-464d-ba0b-ea000c838fea` exit 0.
This post-review bookkeeping follows the captures. No release preparation,
product repair or external publication action occurred.

## Authorized v0.7.22 preparation and PR

User now authorizes preparing the complete accepted delta, fixing release-gate
blockers, committing/pushing `release/v0.7.22` and opening a PR with green required
CI. Stop before merge, auto-merge, merge-queue enrollment, tags or publication.
Branch created from unchanged `c2a283310b6f43c489a1ed6bf24057e150e709e8`,
preserving the dirty tree. Explicitly stage intended files, not `git add -A`.

- [x] release-prep-01: Capture online audit failure, repair reachable Rust pins and current validator compatibility, update instructions, pass focused/canonical checks and independent review.
- [x] release-prep-02: Run existing seven-file 0.7.22 bump transaction, fill factual notes, verify complete accepted candidate with pinned Bun/frozen install/metadata/workflow/standard and owned native gates, and obtain review before commit.
- [ ] release-prep-03: Screen and stage exact reviewed candidate paths, commit/push only release branch, open PR, require green exact-head CI, obtain delivery review, and stop before merge/publication.

Canonical gate: `bunx --package bun@1.3.5 bun run verify`, using the unchanged
whole-repository script under CI's Bun pin. Probe verified runner and child Bun
1.3.5. Workflow checks: `node scripts/check-workflows.mjs` and
`GH_TOKEN="$(gh auth token)" uvx --from zizmor==1.30.1 zizmor .github`.
Credentials remain ephemeral/unprinted. No new audit ignores or severity filters.

Latest official actionlint 1.7.12 still lacks `$/` support (upstream issue 711 and
PR 732 open); Zizmor 1.30.1 is current. A small YAML-AST/source-range stdin lint
view maps only actual literal job/step `$/` prefixes to equivalent `./`, retaining
positions and all other checks. Actual workflows and online audit use `$/`.
Unsupported aliases/representations fail closed. Declare existing yaml 2.9.0 as
an exact direct dev dependency and pin validators in tool-versions.json.
Rust action SHA `7e38f4b43b4db5c8dd498af069a4f6196df1d067` compares identical
to upstream master on 2026-10-04. Retain the existing Rust channel and targets.

Version transaction must run without concurrent writers. Its post-write TODO
metadata failure is expected only when confirmed; other failures are blockers.
Final candidate checks include metadata for v0.7.22, live APT guard, frozen
dependencies, authenticated online audit, standard E2E and owned undo/checklist
specs, followed by independent production build/isolation. Current strict
`CI success` must pass on the PR head before delivery is complete.

Preparation baseline audit `d1efc80d-3320-4eab-9046-ab017ed1e399` exited 14
before edits. Focused checker contracts subsequently proved the unmodified
released actionlint rejects `$/` while the source-preserving lint view accepts
it and still rejects genuine workflow errors. Authenticated current Zizmor
reported no findings with the existing 33 suppressions unchanged.

Canonical capture `45c0d105-1c6e-4019-80d6-865dd7fe27e6` then exposed one
existing shared-validator contract matching legacy `./` rather than `$/`.
Amendment `release-selfref-contract-20261004` changes only that expected syntax,
retaining exactly one validation call per workflow and all installer assertions.
Final source-bound validation and independent review follow this bookkeeping.

release-prep-01 accepted by independent review at revision 15 with no findings.
Current online audit has no findings (existing 33 suppressions unchanged);
checker contracts and actual workflow lint pass, and Bun 1.3.5 canonical gate
passes 316 frontend, 122 release-script and native/repository checks. Accepted
captures: `c6c268c4-0d38-4ea5-a9c6-56a47d75f8ae`,
`157c095b-fa91-40d2-8a42-8cbaaff5d025`,
`2d79c598-f9ce-4a8e-9c6f-e0ae8a58b57c`,
`3fa788e1-b4c3-4cd7-aac4-66459e0d6f9e`. This bookkeeping follows review.
Version preparation and PR delivery remain pending.

release-prep-02 started with the complete accepted 67-path dirty inventory and
immutable base `c2a283310b6f43c489a1ed6bf24057e150e709e8`. No concurrent
development process was running. The existing bump preview listed exactly seven
targets; the real transaction updated them to 0.7.22 and stopped only at the
confirmed changelog TODO verification. Eight factual public notes now replace
that placeholder under `## v0.7.22 - 2026-10-04`; the published 0.7.21 section
is preserved. Candidate checks and independent review precede staging/commit.

The first candidate run passed all ten checks at source digest
`15a9f4c7b038eff8302b9cb2a2193648f3c39661cafbaac49fa963e106655f07`.
Review `release-prep-02.R27-01` stopped for incomplete inspection, not a
demonstrated product defect. Retry preserves the original baseline. Four bounded
source-evidence slices inspect all 73 candidate files: core 13, native 13,
frontend/native QA 24, delivery/tooling/docs 23. These are evidence handoffs,
not independent approval. The final reviewer must assess their coverage and
critical contracts before accepting the candidate.

Frontend inspection identified the cleanup warning and active editor competing
for grid row 2. Native failure `a44ae559-0395-41a0-8a22-5cbc804c13d7` measured
implicit columns `507px 467px` at 1280x816, with the editor spilling outside the
workspace. A scoped CSS repair explicitly stacks warning, header and editor in
one column while preserving ordinary two-row/no-header layouts. Deletion-stage
capture `bae57d96-03fe-4ef5-9658-be792a9bfa35` passes at 1280x816 and actual
546x430: one column, full-width warning, correct stacking and persisted desktop
editing. Narrow coverage measures horizontal placement and retained text, not
typing or a fully visible editor in a short window. Initial test setup failures
compared HTML to plain text and attempted narrow offscreen typing; both are
distinct from the demonstrated implicit-column failure.

- [x] Verify the scoped cleanup-warning regression through a real restart with the same isolated data root, then refresh candidate gates and independent review.

Source inspection also records existing limitations: path-based cleanup does
not contain concurrent hostile filesystem substitution; process-group cleanup
does not contain descendants that escape their group; startup retries bound
path count, not latency. They are not newly reproduced release regressions.
Custom native specs require explicit runner selection. The existing `.next`-only
interruption-test advisory remains outside this release repair. No additional
production scope follows from these source-only observations.

Candidate accepted at revision 47 after independent inspection of all 507 diff
pages, the complete 73-path scope and five risk lenses. The coverage-only
finding `release-prep-02.R27-01` is resolved; no new findings. All nine required
focused checks and canonical `b929d3da-70b7-4cd8-8cb6-b9d386049e48` pass at
source digest `994245ae6007abd83e340f4dbceef19dfe1c167b2c2ad4cd0faeedf1deae0b6b`.
Real restart `c6ffb53b-de3b-4789-af31-fd0d076b1c39` preserves pending intent,
then manual retry removes only the queued file and retains unknown siblings.
This completion bookkeeping follows approval. Delivery begins at revision 48;
the PR and its required hosted checks are still pending.

Release branch commit `81848130660435acca38c7a7577c83f0aa78a105` is pushed;
PR https://github.com/ddv1982/qa-scribe/pull/26 targets main and remains open
with no auto-merge. Initial required-check watch ran before the aggregate
`CI success` existed. Run `37234432845` then failed Linux quality because the
old Zizmor action rejected pinned tool 1.30.1 before auditing. Reachable released
action v0.6.4 SHA `cc914d7f3750a2d13d75c7f184a1060aa0e9d482` includes that
tool's immutable container digest; update only the installer action pin.
Actual actionlint installation and adapted lint passed on the hosted runner.

The same run passed macOS ARM64 Rust tests and Intel cross-check. Its
observational native Session-lifecycle spec failed the synthetic undo handler:
Control+Z was hardcoded, but Tiptap uses Command+Z on macOS. Select Meta/Ctrl
using the browser platform exactly as ProseMirror does, preserving handled-event,
structure, toolbar and persistence assertions. The other four observational
native workflows passed. These are actual same-goal installer/test-glue repairs,
not waived gates or application behavior changes.

- [ ] Verify the current Zizmor action pin and platform-correct native undo event, independently inspect the scoped follow-up, and commit/push the repair without weakening gates.
