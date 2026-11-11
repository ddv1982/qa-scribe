# Codebase review, 2026-10-04

## Recommendation

Keep the existing Rust core, Tauri native shell and React renderer boundaries. The six prioritized process, attachment and release-safety findings below have been implemented and independently reviewed through the [phased plan](codebase-improvement-plan-2026-10-04.md). The closeout runs the exact repository gate and Linux built-app workflows after the final document edits; Flow retains their source-bound results.

This is a cross-codebase family-level review, not an exhaustive line-by-line audit. Source evidence establishes the control flows below; runtime regressions and current baseline results are separately recorded during execution. No current passing-test count is inferred from historical documents.

## Findings

| ID | Severity | Pre-improvement evidence | Improvement |
| --- | --- | --- | --- |
| REV-001 | Medium | `src-tauri/src/commands/ai/streaming_exec.rs:225-226,251-261` treats stdout EOF as successful read completion then unconditionally kills the registered process. | Permit bounded normal exit after EOF, retain watchdog/cancellation and blocked-stdin protection, preserve actual exit status/stderr. |
| REV-002 | Medium | `crates/qa-scribe-core/src/attachments/mod.rs:18,299-323` imports with a 25 MiB limit but previews/copies use unrestricted `fs::read` before hashing; import at line 69 also relies on a metadata precheck. `src-tauri/src/commands/files.rs` executes expensive filesystem/image operations synchronously. | Bound actual reads, validate stored size/hash, move expensive work through explicit native blocking workers. Corruption/enlargement on local disk is the demonstrated threat model, not a claimed remote exploit. |
| REV-003 | Low | `scripts/bump-version.mjs:47-61` performs interrupted recovery before parsing/validating arguments; the dry-run return is at lines 78-80. `scripts/version-transaction.mjs:96-155` recovery changes targets and removes transaction files. | Validate arguments first and inspect/refuse pending recovery without writes during dry runs; retain mutating recovery for valid write invocations. |
| REV-004 | Medium | `crates/qa-scribe-core/src/attachments/mod.rs:185-198` deletes the database row and discards filesystem cleanup errors. Desktop deletion returns success; reconciliation is used in tests/smoke, not deployed recovery. | Atomically persist exact managed-file cleanup intent with deletion, return truthful partial success, retain bounded restart/manual retry. Preserve database-first safety. |
| REV-005 | Medium | `.github/workflows/release.yml:13-15` serializes per tag only; `publish-apt-repository` at lines 816-851 checks live monotonicity and deploys without a cross-tag boundary. `scripts/check-apt-monotonic.mjs:80-105` observes but does not reserve publication. | Serialize the check/deploy job across tags, with cancellation disabled and a live check inside the boundary. No production race occurrence is claimed. |
| REV-006 | Medium | `src-tauri/src/commands/providers/probe/command.rs:54-59,71-84` creates a group but returns after normal parent exit without stopping descendants; timeout/cancel paths stop the group. | Preserve parent status/output while terminating owned descendants on success, failure and exceptional exits. Real-provider incidence is unknown. |

Line references identify the pre-improvement source and may shift during repairs.

## Architecture and complexity

The core owns domain validation, SQLite services, managed attachments and generation workflows. Tauri owns native integration, IPC, provider discovery, jobs and process execution. React owns editing/navigation and typed bridge calls. The process-neutral `ProviderExecutor` seam keeps native lifecycle execution out of domain workflows. No reviewed evidence warrants replacing these boundaries.

Complexity is concentrated in coordination, not simply long files. `frontend/src/app/sessionActions.writes.ts` combines write intents, compensation, navigation epochs and recovery gating; `useAppController.ts` composes capabilities and refs. These are characterization-test hotspots, but size alone is not a defect. `streaming_exec.rs` coordinates child, stdin writer, stdout/stderr readers and watchdog; REV-001 is a concrete lifecycle ownership defect. Attachment I/O can hold the service mutex, so bound work and use native workers without speculatively changing database serialization.

Storage currently rejects newer schemas before setup, configures foreign keys/busy timeout/WAL and performs destructive migrations in immediate transactions. The reviewed historical migration-stamping issue is addressed. SQLite transactions do not encompass external file deletion: durable intent and idempotent cleanup are required for REV-004.

Production CSP is explicit and restrictive; the main-window capability, command registrations, Specta declarations and permissions were inspected. Generated types provide a contract, not authorization. E2E privileges and frontend code are separately gated. No additional CSP/capability vulnerability was confirmed. Packaged-process smoke now exists but process survival does not prove rendered UI readiness; built-app workflows remain separate evidence.

## Review coverage

Inventory counts describe the initial inspected checkout, before the implementation files below were added. They are advisory filesystem/source counts, not executed test counts. Scopes overlap and must not be summed. The updated native command surface contains 35 commands.

| Family | Coverage |
| --- | --- |
| Rust workspace | Three crate boundaries/manifests; integrity-critical storage, attachments, generation and service paths inspected, remaining CRUD sampled. |
| Tauri | 53 Rust files inventoried; native commands, jobs, process I/O, discovery and security boundaries inspected. 34 custom commands accounted for. |
| Provider discovery/parsing | 29 provider Rust files inventoried (20 production and 9 dedicated test/support files); Claude/Copilot/Codex transports and all three generation parsers inspected; catalog/cache/default helpers sampled. |
| React | All nine production view files inspected; 22 app test files accounted for; Summary recovery/navigation/autosave/close protection inspected deeply. Remaining editor/components/CSS and test assertions sampled. |
| Release/tooling | 50 direct script files inventoried, including 14 `.test.mjs`; version transactions, package smoke, APT publication, archive safety, gate/isolation reviewed selectively. Two Python test families accounted for. |
| CI/E2E | Two workflows and three composite actions accounted for; publication/privilege boundaries inspected. Two E2E spec files and five isolated critical scenarios accounted for. |

Residual limits: not every DTO field, provider catalog helper, package-builder/parser branch or test assertion was reviewed line by line; no visual/accessibility audit, compiled-artifact audit or dependency reachability audit is claimed. Major maintained source/test families are covered. Baseline commands provide separate executable evidence.

## Historical audit disposition

July documents are historical input, not the current backlog. Current source addresses: AUD-002 navigation epochs; AUD-003 provider observation ordering; AUD-004 blank-title save rejection; AUD-005 preview caching; AUD-006 recovery/cancellation/finalization safeguards; AUD-007 provider-directory fail-closed setup; AUD-008 owned temporary-output tests; AUD-009 structured output rejection; AUD-010 conditional Evidence restoration; AUD-011 centralized rich-body resolution; AUD-012 quote-aware HTML scanning; AUD-013 installed/executed final-package smoke; AUD-014 isolated E2E scenarios/handshakes; AUD-015 YAML size policy; AUD-016 recoverable version transactions; AUD-017 pinned cargo-audit.

AUD-001's recovered Summary overwrite mechanism is addressed by startup job capture before hydration, recovery-gated writes, canonical reload ordering, dirty authored-content decisions and close protection. Existing regressions in `useAppController.lifecycle.summary-recovery.test.ts`, autosave and close-protection recovery suites execute in the passing frontend suite. The built-app Summary-recovery scenario also passed. These dispositions do not claim every unrelated interleaving is proven. Historical refuted entries were not fully re-audited.

## Researched standards and applicability

Retrieved 2026-10-04 using Exa official-source research; Tauri async command, GitHub concurrency and uv tool-version guidance additionally fetched through Ref. Project: Rust edition 2024, Tauri 2 (minimum constraint 2.11.2, lockfile resolution 2.11.5), rusqlite 0.37, React 19, TypeScript 6 and Vite 7. Stable standard-library contracts apply; current framework docs require comparison with resolved versions. Standards are mapped to actual defects, not used as blanket style mandates.

- [Rust Child](https://doc.rust-lang.org/std/process/struct.Child.html): wait blocks, try_wait polls/reaps exited children; kill requires reaping, Drop does not wait. Stdout EOF is not process completion (REV-001/006).
- [Rust Stdio](https://doc.rust-lang.org/std/process/struct.Stdio.html): pipe backpressure requires concurrent output draining while writing large input (REV-001).
- [Rust Read::take](https://doc.rust-lang.org/std/io/trait.Read.html): bound reads during reading, with a sentinel byte to distinguish oversize from exact EOF (REV-002).
- [Tauri async commands](https://tauri.app/develop/calling-rust/#async-commands) and [spawn_blocking](https://docs.rs/tauri/latest/tauri/async_runtime/fn.spawn_blocking.html): synchronous commands execute on the main thread; async alone does not relocate blocking filesystem/database/image work. Started blocking tasks need explicit resource cancellation (REV-002).
- [React effect synchronization](https://react.dev/learn/synchronizing-with-effects): abort or ignore stale async results and include reactive dependencies. Existing navigation/recovery ordering is relevant implementation evidence.
- [SQLite atomic commit](https://sqlite.org/atomiccommit.html): guarantees database transaction atomicity, not arbitrary external file cleanup (REV-004).
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/) and [CSP](https://v2.tauri.app/security/csp/): minimal scoped frontend permissions, merged overlapping capabilities, explicit restrictive content sources.
- [Vite production builds](https://vite.dev/guide/build) and [static deployment](https://vite.dev/guide/static-deploy): validate production output as well as development execution; preview is not a production server.

REV-003's no-write dry-run contract is an application promise, not a Node filesystem API guarantee. [GitHub concurrency guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency#using-concurrency-in-different-scenarios) confirms exclusion within one group and default replacement of the single pending job. Tag/dispatch order is not a version-order guarantee, so the live recheck stays inside the publication job. The newer `queue: max` option was probed but is not recognized by released actionlint 1.7.12.

[uv tool-version guidance](https://docs.astral.sh/uv/concepts/tools/index.md#tool-versions) confirms that `uvx` defaults to an installed tool's version. Local workflow validation uses actionlint 1.7.12 and installed Zizmor 1.29.0/offline. Zizmor 1.30.1 reported eleven low-severity recommendations for [GitHub's new self-repository syntax](https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/), which released actionlint also rejects. [Zizmor 1.30 release notes](https://github.com/zizmorcore/zizmor/releases/tag/v1.30.0) identify the new audit. No new ignore comments or audit flags were introduced; the 30 pre-existing Zizmor suppressions remain. This is version-qualified local evidence, not a passing modern-profile or hosted-CI claim.

## Baseline and implementation evidence

The initial host-observed `bun run verify` exited 1 at `frontend:audit`, reporting 32 high-severity advisories. It did not reach native checks, repository tests or smoke. Flow capture: `d6937a71-6e21-4e5f-8992-ce126d88774c`.

A bounded prerequisite amendment retained the exact gate and authorized supported dependency security updates. `bun audit fix` updated the lockfile and brace-expansion to 5.0.12; a coordinated in-range update aligned all direct Tiptap packages to 3.31.4 and DOMPurify to 3.4.16. Other affected transitives were refreshed within dependency ranges. At this intermediate point the prerequisite was only partly repaired; the subsequent steps below completed and reviewed it.

The next audit reported five high advisories: basic-ftp 5.3.1, deepmerge-ts 7.1.5, braces 3.0.3, and two extract-zip 2.0.1 advisories. Those paths were build/E2E tooling dependencies; application exploitability is not established by the audit alone. Registry queries showed latest braces 3.0.3 and extract-zip 2.0.1. [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [extract-zip symlink advisory](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) explicitly reported no patched version. The [second extract-zip advisory](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) reported unknown patched versions; Bun included it in audit output. Pages were retrieved through Exa on 2026-10-04. The subsequent tooling graph removes those obsolete paths rather than suppressing advisories.

Post-update compatibility command `bun run frontend:check && bun run frontend:test && bun run frontend:build` passed: TypeScript, ESLint, CSS color checks, 46 contrast pairs, 38 Vitest files/295 tests and Vite production build. Flow capture: `79778fd7-2884-4ee7-be97-b33960382aad`. Vite reported its existing large-chunk warning (editor chunk approximately 508 kB); no size-only refactor is justified by that warning alone.

The subsequent tooling compatibility amendment updates direct WebdriverIO packages to 9.32.0 and overrides browser downloader 3.2.3, deepmerge-ts 8.0.0 and Mocha 11.7.5. These remove the vulnerable legacy downloader/watch graph rather than suppress advisories. Mocha 12 was tested and rejected because it removes a helper imported by WebdriverIO. Mocha 11 imports successfully and the resulting high-severity audit passes (629 packages checked, one finding below the configured high threshold). Embedded Tauri workflows do not exercise browser-download functionality; the downloader override is not general browser-download compatibility evidence.

Linux `bun run e2e` then passed all five isolated scenarios on the built application: Session lifecycle, manual Testware, native clipboard, streaming completion/cancellation, and Summary recovery. Capture `5de9c46c-f4b7-475e-8aea-bd11f69a0535`. External driver diagnostics are misleading for the configured embedded driver and did not block these workflows. The initial two-minute attempt timed out during compilation; the Mocha 12 attempt failed before test sessions; neither is passing evidence. The passing rerun used Mocha 11 and a longer host timeout.

The next canonical gate passed frontend audit and stopped on ten stale Rust exception IDs plus summary mismatch (capture `1b778535-1843-4559-a2d7-bcf274385218`). A third prerequisite amendment removes only IDs no longer reported by raw cargo audit and reconciles documentation. It adds no exceptions and extends no deadlines.

After reconciliation, exact `bun run verify` passed (capture `b813364a-5920-4b63-a2b6-15a81a103fab`): configured dependency audits, code-size/terminology, frontend checks and 295 tests, release-script/package checks, production build/isolation, bindings/34-command contract, Rust format/clippy, 165 core unit tests, 48 storage integration tests, 129 native tests (two existing authenticated live-provider tests ignored), workspace build and non-GUI smoke. This is the repaired baseline, not evidence that the six source findings have been fixed.

The repaired baseline was accepted after dependency identity and native editor compatibility review. All six prioritized source repair phases have subsequently passed their own independent reviews, summarized below. Final acceptance uses current-source closeout captures rather than relabeling the earlier baseline as final evidence.

Independent baseline review found `plan-00.R16-01`: duplicate ProseMirror model constructors in the updated lockfile break bullet/checklist conversion despite the previous gate and five scenarios passing. Two real-editor regressions failed with the explicit multiple-versions Fragment RangeError (capture `1d4fd4fd-7a27-4b9b-a420-b360fde9ae3e`). The dependency repair pins one compatible model identity and refreshes installed dependencies with `bun install --force`. Both real-editor regressions then pass (capture `c95c3e57-cb1b-4d31-a068-7562096cb842`). Production StarterKit adds a trailing empty paragraph after lists; the tests explicitly retain that behavior.

The built-app lifecycle scenario now passes list conversion, undo, list-local editing, autosave and reopen checks (capture `48465253-cc3d-4ac6-b062-a747b5b33d6b`). Toolbar clicks drive conversion; a DOM keyboard event drives the real undo handler and the WebView editing command inserts text, because embedded-driver text/modifier simulation did not exercise those paths correctly. Selection is explicitly placed inside the intended list paragraph, and checkbox accessibility label text is excluded from content comparisons. No editor/store mock is used. `plan-00.R16-02` records the unused downloader limitation above.

Additional inspection follow-up: undo immediately after switching Sessions restored the prior secondary Note in one expanded test run (`a7937b7b-70b0-4140-b9cf-b1e697fff613`), consistent with shared editor history. List compatibility now checks undo within a freshly opened Note view and separately verifies persisted Session content. Cross-Session undo-history isolation is not proven and is outside the six locked repair outcomes; investigate before authorizing an additional product change. Reload-based expanded checks also encountered embedded-driver reconnect timeouts; the existing Summary-recovery scenario retains its reload check.

## Implemented phases and verified milestones

These are historical feature milestones with their own passing independent reviews. Exact capture IDs and review revisions are retained in the checklist and Flow history. The final feature reruns whole-repository and Linux E2E acceptance after this report is written.

| Finding / phase | Implemented outcome | Behavior and contract evidence |
| --- | --- | --- |
| REV-001 / plan-01 | Two-second normal-exit grace after stdout EOF; child remains registered for watchdog/cancellation; cached exit status preserved; owned group stopped before pipe joins. | Three new regressions failed before repair. All 16 streaming cases pass, including delayed success/failure diagnostics, post-EOF cancellation below the fallback bound, blocked stdin, flooding, watchdog and reaping. Review passed at revision 49. |
| REV-006 / plan-06 | Local probe ownership guard stops descendants and reaps the parent on normal result, error and unwind. | Success/nonzero-parent output/status and post-spawn unwind cases failed before repair, then passed with 81 provider tests. Review passed at revision 56. Linux evidence does not establish Windows process-tree guarantees. |
| REV-002 / plan-02a | Actual import/managed reads capped at 25 MiB plus sentinel; stored size/hash checked; expensive native image work runs through explicit blocking workers. | Oversize matching-hash and size-mismatch cases failed before repair. Exact-limit, bounded growing-stream, corruption and worker/error checks pass. Native paste/import, exact preview bytes, clipboard 1x1 red pixels and Session reopen pass. Workspace-readable fixture: `frontend/src/test/attachment-native-validation.md`. Review passed at revision 79. |
| REV-004 / plan-02b | Schema 9 additive exact-path outbox enqueued atomically with Session deletion; 50-path rotating retry; live/unknown/symlink protections; nonrecursive cleanup; nullable status and persistent UI retry surface. | Unknown-sibling preservation and missing durable intent failed before repair. Twelve rollback/crash/retry/fairness/safety cases pass. Two actual native launches prove pending cleanup survives restart and manual retry clears intent while unknown siblings survive. UI guards and 35-command/binding alignment pass. Review passed at revision 98. |
| REV-003 / plan-03 | Validate arguments before recovery; read-only pending-state discovery/refusal on dry run; valid mutating invocation still recovers before preflight. | Byte/tree snapshots failed before repair, then passed for dry-run and six invalid argument shapes. Killed-between-replacements recovery and existing rollback tests remain. Review passed at revision 106. |
| REV-005 / plan-07 | Fixed cross-tag APT job exclusion encloses both the live-version guard and deploy, with active-job cancellation disabled. | Three source-contract/schedule cases failed before repair. Fifteen APT cases pass with real monotonic guard logic; actionlint and compatible Zizmor profile pass. Review passed at revision 117. This models GitHub group exclusion; production publication was not executed. |

The latest pre-closeout repository gate (`8a665c0f-fd15-42d6-a478-0979eb56b473`) passed: 308 frontend tests, 166 core unit tests, 12 cleanup integration cases, 53 storage cases, 136 native tests (two existing authenticated-provider cases ignored), 114 release-script cases, five Python metadata/archive cases, format/clippy, generated bindings/35-command surface, production frontend/isolation, workspace build and non-GUI smoke. These counts come from executed output, not July's baseline document.

The frontend audit passes its configured high-severity threshold; one lower-threshold advisory was reported. Rust audit retains ten reviewed upstream-constrained exceptions: two vulnerabilities, one unsoundness warning and seven unmaintained warnings. Their review deadlines were not extended, and no new exceptions were added. See `docs/rust-dependency-audit.md` and `scripts/rust-audit-exceptions.json`.

## Remaining improvement backlog

1. **Investigate cross-Session undo-history isolation first.** Reproduce it with the real editor, determine whether history can restore another Session's Note, then approve a narrow identity/history fix. The observed restoration is recorded above; a general isolation fix is not claimed.
2. **Coordinate hosted workflow validator versions and modern action references.** `plan-07.R116-01` remains advisory: dynamically resolved hosted Zizmor can select 1.30.1 while actionlint 1.7.12 rejects its recommended `$/` syntax. The eleven low-severity recommendations and modern-profile failure remain recorded in `docs/ci.md`. Local compatible-profile success is not hosted CI success.
3. **Add the `.next`-only CLI interruption case.** `plan-03.R105-01` remains advisory: the current regression fixture contains both manifest files, so dedicated staging-only branch coverage would improve recovery characterization. Source review confirms read-only discovery; this is not an unresolved source defect in the implemented contract.
4. **Continue characterization before coordination refactors.** Exercise Summary recovery, pending-save/navigation and record compensation interleavings with real editor boundaries before extracting or replacing controller machinery. File-size watchlists identify review hotspots, not automatic refactor work.
5. **Measure before further responsiveness/storage redesign.** Blocking workers reduce inline heavy work, but the shared service mutex still serializes operations. Startup/large-data latency and contention were not benchmarked in this review, so no numeric performance gain or connection-pool redesign is justified.

## Verification boundaries

Current-source closeout requires exact `bun run verify` and Linux `bun run e2e`; additional image and two-process cleanup workflows supply relevant native behavior evidence. Independent reviews and the repository checklist define phase completion. Commands, source digests, exit codes and complete-output digests are held by Flow.

No exhaustive per-line, visual/accessibility, compiled-package, dependency-reachability or authenticated-provider audit is claimed. macOS/Windows native behavior, browser-download functionality, modern Zizmor network/new-rule coverage, hosted CI and production deployment were not verified here. Existing startup budgets were not rerun. Hostile concurrent filesystem replacement and secure erasure are not guarantees of the cleanup design. Existing Electrobun/Bun data was not read or migrated. Work remains uncommitted; no push, tag or release was performed.

## undo-inspect-01 temporary native observation source

Prepared for approved session `eb473079-18a0-4afe-86f1-17681ed165df`, revision 3. These temporary fixtures are inspection-only preparation, not production repairs or executed results. At the actual scheduled execution, the runner compares both temporary scripts byte-for-byte with these source fences before rebuilding and launching the isolated Linux native application. Native readbacks and editor, autosave and reopen observations are saved to artifact `observation.json` before the final foreign-Session isolation assertion. A no-op undo is not an isolation failure; recorded persistence or reopen errors require separate interpretation. The manager owns execution and diagnosis.

### `/tmp/opencode/qa-scribe-undo-observe-run.mjs`

```javascript
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = '/home/vriesd/projects/qa-scribe'
const paths = ['/tmp/opencode/qa-scribe-undo-observe-run.mjs', '/tmp/opencode/qa-scribe-undo-observe.e2e.mjs']
const review = readFileSync(join(root, 'docs/codebase-review-2026-10-04.md'), 'utf8')
for (const path of paths) {
  const marker = '### `' + path + '`\n\n```javascript\n'
  assert.equal(review.split(marker).length, 2, `Expected one source snapshot for ${path}`)
  const start = review.indexOf(marker) + marker.length
  const end = review.indexOf('\n```', start)
  assert.ok(end >= start, `Missing closing source fence for ${path}`)
  const snapshot = Buffer.from(review.slice(start, end) + '\n')
  const source = readFileSync(path)
  assert.ok(source.equals(snapshot), `Executed source differs from review snapshot: ${path}`)
  console.log(`SOURCE ${path} SHA256 ${createHash('sha256').update(source).digest('hex')}`)
}
const artifacts = mkdtempSync('/tmp/opencode/qa-scribe-undo-observe-')
console.log(`ARTIFACTS ${artifacts}`)
const { runE2e } = await import(pathToFileURL(join(root, 'scripts/run-e2e.mjs')).href)
const environment = { ...process.env }
delete environment.QA_SCRIBE_E2E_SCENARIO
delete environment.QA_SCRIBE_E2E_SKIP_BUILD
delete environment.QA_SCRIBE_E2E_TEMP_ROOT
process.exitCode = runE2e({
  ...environment,
  QA_SCRIBE_E2E_SPEC: relative(join(root, 'e2e/specs'), paths[1]),
  QA_SCRIBE_E2E_ARTIFACTS: artifacts,
})
console.log(`UNDO OBSERVATION EXIT ${process.exitCode}; ${join(artifacts, 'observation.json')}`)
```

### `/tmp/opencode/qa-scribe-undo-observe.e2e.mjs`

```javascript
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const titles = { A: 'Undo observe Session A 20261004', B: 'Undo observe Session B 20261004' }
const notes = { A: 'UNDO_OBSERVE_A_20261004 original Note alpha.', B: 'UNDO_OBSERVE_B_20261004 foreign Note beta.' }
const evidence = { titles, notes, steps: [] }
const output = join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'observation.json')
function record(stage, data) {
  evidence.steps.push({ stage, at: new Date().toISOString(), ...data })
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(`UNDO_OBSERVE ${stage} ${JSON.stringify(data)}`)
}
async function editorState() {
  return browser.execute(() => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    return { title: document.querySelector('[aria-label="Session title"]')?.value,
      html: editor?.innerHTML, text: editor?.textContent, innerText: editor?.innerText }
  })
}
async function nativeState(title) {
  return browser.tauri.execute(async ({ core }, titleValue) => {
    const sessions = await core.invoke('list_sessions')
    const session = sessions.find((candidate) => candidate.title === titleValue)
    if (!session) throw new Error(`Native Session missing: ${titleValue}`)
    const state = await core.invoke('open_session_note_state', { id: session.id })
    return { sessions, state, sessionId: state.session.id, title: state.session.title,
      entryId: state.noteEntry.id, entrySessionId: state.noteEntry.sessionId,
      body: state.noteEntry.body, bodyJson: state.noteEntry.bodyJson,
      bodyFormat: state.noteEntry.bodyFormat }
  }, title)
}
async function waitStored(title, body) {
  await browser.waitUntil(async () => (await nativeState(title)).body === body,
    { timeout: 5_000, interval: 100, timeoutMsg: `Native Note did not persist expected body for ${title}` })
}
async function createSessionFixture(key) {
  const noteTab = await $('[role="tab"]*=Note')
  if (await noteTab.isExisting()) {
    await noteTab.waitForClickable()
    await noteTab.click()
  } else {
    const sessions = await (await $('nav[aria-label="Workspace sections"]')).$('button*=Sessions')
    await sessions.waitForClickable()
    await sessions.click()
  }
  const newSession = await $('button=New Session')
  await newSession.waitForClickable()
  await newSession.click()
  const title = await $('[aria-label="Session title"]')
  await title.waitForDisplayed()
  await title.setValue(titles[key])
  await (await $('[aria-label="Note body"]')).setValue(notes[key])
  await browser.waitUntil(() => browser.execute(() =>
    document.querySelector('p.status-pill.saved')?.textContent?.includes('Note saved') ?? false),
  { timeout: 5_000, timeoutMsg: 'Note autosave did not reach saved state' })
  await waitStored(titles[key], `<p>${notes[key]}</p>`)
  const native = await nativeState(titles[key])
  record(`created-${key}`, { editor: await editorState(), native })
  assert.equal(native.entrySessionId, native.sessionId)
  assert.equal(native.body, `<p>${notes[key]}</p>`)
}
async function switchSession(key) {
  const option = await $(`[role="option"]*=${titles[key]}`)
  await option.waitForClickable()
  await option.click()
  await browser.waitUntil(async () => (await editorState()).title === titles[key],
    { timeout: 5_000, timeoutMsg: `Session ${key} title did not load` })
}
async function observeWait(action) {
  try { await action(); return null }
  catch (error) { return { message: error.message, stack: error.stack } }
}
describe('actual native cross-Session Note undo observation', () => {
  it('records undo, autosave and reopen before checking foreign restoration', async () => {
    try {
      await createSessionFixture('A')
      await createSessionFixture('B')
      await switchSession('A')
      await browser.waitUntil(async () => (await editorState()).text === notes.A,
        { timeout: 5_000, timeoutMsg: 'Session A baseline Note did not load' })
      const baseline = { A: await nativeState(titles.A), B: await nativeState(titles.B) }
      record('before-undo', { editor: await editorState(), ...baseline })
      assert.equal(baseline.A.body, `<p>${notes.A}</p>`)
      assert.equal(baseline.B.body, `<p>${notes.B}</p>`)
      const undo = await browser.execute(() => {
        const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
        const read = () => ({ title: document.querySelector('[aria-label="Session title"]')?.value,
          html: editor.innerHTML, text: editor.textContent, innerText: editor.innerText })
        editor.focus()
        const before = read()
        const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
        editor.dispatchEvent(event)
        return { before, after: read(), defaultPrevented: event.defaultPrevented }
      })
      record('undo-immediate', undo)
      const persistenceError = await observeWait(() => waitStored(titles.A, undo.after.html))
      const persistedA = await nativeState(titles.A)
      const persistedB = await nativeState(titles.B)
      record('after-autosave', { editor: await editorState(), A: persistedA, B: persistedB,
        persistenceError, ABodyMatchesUndoHtml: persistedA.body === undo.after.html,
        ABodyMatchesForeignBaseline: persistedA.body === baseline.B.body,
        AEntryIdentityStable: persistedA.entryId === baseline.A.entryId,
        BEntryIdentityStable: persistedB.entryId === baseline.B.entryId,
        BBodyMatchesBaseline: persistedB.body === baseline.B.body,
        BBodyCorrect: persistedB.body === `<p>${notes.B}</p>` })
      await switchSession('B')
      const BDisplayError = await observeWait(() => browser.waitUntil(async () => (await editorState()).text === notes.B,
        { timeout: 5_000, timeoutMsg: 'Session B baseline Note did not load' }))
      record('switched-away-B', { editor: await editorState(), native: await nativeState(titles.B), BDisplayError })
      await switchSession('A')
      const reopenError = await observeWait(() => browser.waitUntil(async () => (await editorState()).text === undo.after.text,
        { timeout: 5_000, timeoutMsg: 'Reopened Session A did not display its post-undo Note text' }))
      const reopened = { editor: await editorState(), A: await nativeState(titles.A), B: await nativeState(titles.B) }
      record('reopened-A', { ...reopened, reopenError,
        ABodyMatchesDisplayHtml: reopened.A.body === reopened.editor.html,
        ADisplayMatchesUndoText: reopened.editor.text === undo.after.text,
        ABodyMatchesUndoHtml: reopened.A.body === undo.after.html,
        ABodyMatchesForeignBaseline: reopened.A.body === baseline.B.body,
        AEntryIdentityStable: reopened.A.entryId === baseline.A.entryId,
        BEntryIdentityStable: reopened.B.entryId === baseline.B.entryId,
        BBodyMatchesBaseline: reopened.B.body === baseline.B.body,
        BBodyCorrect: reopened.B.body === `<p>${notes.B}</p>` })
      // No assertion about undo being nontrivial: a no-op satisfies isolation.
      // All native readbacks and evidence precede the desired-isolation assertion.
      const bodies = [undo.after.text, persistedA.body, reopened.editor.text, reopened.A.body]
      assert.ok(bodies.every((body) => !body.includes('UNDO_OBSERVE_B_20261004')),
        'Session A undo restored foreign Session B Note sentinel (see observation.json)')
    } catch (error) {
      record('failure', { message: error.message, stack: error.stack })
      throw error
    }
  })
})
```

## undo-inspect-01 investigation results

Inspection is complete, not repair. Advisory `plan-05.R123-03` is now confirmed: cross-Session Note undo can persist another Session's body into the destination Note. No production change or broad controller refactor was authorized or implemented.

### Historical initial native observation

The manager supplied host-observed Linux built-app evidence from unchanged production defaults. This initial capture is historical: after this report edit, exact focused observation and canonical `bun run verify` reruns are still pending for the current-source validation packet. Independent outcome review is also pending; no final capture IDs or passing outcome are inferred here.

- Command: `node /tmp/opencode/qa-scribe-undo-observe-run.mjs`.
- Capture: `0548d914-6536-4ceb-b4a3-4820e0d61464`, exit **1** at the final desired-isolation assertion, not an environment/setup failure.
- Artifacts: `/tmp/opencode/qa-scribe-undo-observe-7wdyg8/observation.json` and sibling `wdio-run.log`.
- The runner verified both source fences byte-for-byte before building frontend/native and launching: runner SHA256 `66921db4bee15f0feba02a43ee09bb5066db1fd331505a9ab704a7849fb7f2c7`; spec SHA256 `fc17d908a981a3c7da4164c73067593f65e771404b267693ec651071c1755af1`.
- A: Session `fc53b9e6-aab4-43b8-ae37-343d88ffe286`, Note Entry `8a0fe7a6-bb58-483e-9b4d-b1d181bde6b0`.
- B: Session `54745540-234d-40ff-bfac-c03c5f93c352`, Note Entry `89a3c19f-0382-4523-9c6c-afcf1693fc2d`.

| Requirement | Observed evidence |
| --- | --- |
| UNDO-OBS-01 | B-to-A navigation kept the Note editor mounted. Before undo, native `body`, `bodyJson` and format verified A as `<p>UNDO_OBSERVE_A_20261004 original Note alpha.</p>` and B as `<p>UNDO_OBSERVE_B_20261004 foreign Note beta.</p>`. Actual DOM Ctrl+Z was handled (`defaultPrevented: true`): A's body became B's foreign body while the title remained A. |
| UNDO-OBS-02 | After the approximately 850 ms autosave, A's unchanged Entry and Session IDs held B's body in both HTML and JSON. B's Entry ID and body remained unchanged; `persistenceError` was null. |
| UNDO-OBS-03 | Actual navigation to B and back to A displayed A's persisted foreign body, with native raw body matching display and A's Entry ID stable. B remained unchanged; `BDisplayError` and `reopenError` were null. The final foreign-sentinel assertion failed as intended for the defective product. |

These results establish persisted foreign-body contamination, not merely a transient editor display mismatch. They do not establish non-Linux behavior or prove a future repair.

### Source cause and bounded repair suitability

- `frontend/src/editor/RichTextEditor.tsx:237-267` retains the editor with `useEditor(..., [])`; external bodies at `274-282` use `setContent(..., { emitUpdate: false })`. `frontend/src/views/SessionEditorView.tsx:92,190` supplies a constant editor ID without identity ownership.
- Installed TipTap core **3.31.4**, `src/commands/setContent.ts:51-78`, sets `preventUpdate` only. Its `src/Editor.ts:766-779` suppresses the update event, not history recording. Installed prosemirror-history **1.5.0**, `src/history.ts:259-297`, records replacement steps unless `addToHistory` is false. Excluded transactions map existing branches rather than clear them; `closeHistory` only closes grouping (`263,363-368`). Fresh plugin state initializes empty branches (`398-404`).
- The manager checked the [TipTap setContent reference](https://github.com/ueberdosis/tiptap-docs/blob/main/src/content/editor/api/commands/content/set-content.mdx), including `emitUpdate: false` examples. Installed source is authoritative for the history semantics here.
- Undo changes use the ordinary `onUpdate` Note callback (`RichTextEditor.tsx:254-258`), stable setter (`useSessionWorkspace.ts:42-46`) and destination autosave (`useAppController.ts:381-394`). Autosave correctly targets the current Entry, so it persists the already-contaminated editor value.
- The smallest eventual production change is a React key on the **editor-card subtree**, `SessionEditorView.tsx:175`, using stable `activeSession.id`. This remounts editor and toolbar together. Session identity already reaches this view; no prop threading or shared-editor change is needed for current Session switching.
- New Session activation waits for its blank Note Entry, then publishes Session, Entry, body and saved baseline together (`sessionActions.ts:150-186`); opening does likewise (`90-119`). No editor is rendered without an active Session (`SessionEditorView.tsx:109-128`). A Session-only key therefore covers the current creation/navigation model.
- The stronger Session+Note Entry identity variant requires threading `noteEntryId` from `AppShell.tsx:187-226` into `SessionEditorView`, then using scalar IDs in the subtree key. It also covers same-Session Entry replacement. Never key by body, Entry object, timestamps or save state: ordinary autosave updates the Entry object with the same ID (`sessionActions.writes.ts:396-412`).
- Resetting history on Session switch versus retaining separate per-Session histories is an explicit product-behavior decision. The proposed remount resets history on departure/return, while retaining it during same-Note autosave and rerenders; neither behavior has been implemented here.
- Keying only the editor leaves toolbar saved selections, link popover and captured upload inserter alive (`RichTextEditor.tsx:33-36,43-60,111-124`). Keying the subtree avoids those stale identity-owned references. It also resets focus/selection and reloads image previews.
- Preview cleanup invalidates pending loads, clears retry timers and cache (`RichTextEditor.tsx:228-235,395-420`); registry cleanup removes only its own editor (`richEditorRegistry.ts:22-32`). Upload guards compare Session, Entry and exact registered inserter and discard stale imports (`attachmentActions.ts:250-275`). Lifecycle caveat: TipTap destroys an unmounted editor on a timer (`node_modules/@tiptap/react/src/useEditor.ts:288-310`), so `isDestroyed` alone is not an immediate stale-inserter guarantee.

### Required eventual repair validation

Use the actual built app, not only editor mocks or type checks. Preserve unchanged same-Note undo/redo across autosave and rerenders; exercise immediate undo/redo on A/B roundtrips, identical-content Notes with different histories, and a blank new Session. Confirm pending-save navigation flush, toolbar/link state, pending uploads and managed-image previews. Check destination and source Entry IDs, native bodies and reopened display, not only the immediate editor text. Existing navigation flushes pending edits before hydration (`sessionActions.ts:80-81,146-147`); a repair must preserve that contract. No additional execution or future-fix proof is claimed by this source-evidence slice.

## undo-fix-01 implemented repair and pre-closeout milestones

The approved repair implements requirements `UNDO-FIX-01`, `UNDO-FIX-02`, `UNDO-FIX-03` and `UNDO-FIX-04`. `frontend/src/views/SessionEditorView.tsx:175` adds only `key={activeSession.id}` to the editor-card `<section>`. Editor and toolbar now share a Session-identity lifetime: switching discards history and toolbar transient state, including on return; fresh same-ID objects and ordinary title, save-state and autosave rerenders retain the editor and history. No shared-editor or controller refactor was made. `plan-05.R123-03` and `undo-inspect-01.R7-01` are proposed resolved, pending final independent acceptance, not closed by this milestone.

### Meaningful before-repair evidence

- Corrected component capture `5388ad19-2d78-4fe7-a8ba-e5438355308d`, from the exact combined command, failed five product assertions with 29 passes before the key edit: A/B foreign-history restoration, equal-body private-history restoration, blank new-Session redo, surviving link popover and stale import not deleted.
- Native capture `f98b4508-2aa7-4d65-b6b4-d1d491784b5a` ran all six native cases before the edit. Same-Note continuity passed; distinct-body, equal-body, blank and link-state isolation assertions failed. The pending-navigation same-task click fixture issue was classified separately, not as an additional product defect.
- Earlier harness initialization, expected heading trailing paragraphs, ambiguous status queries and unfocused initial blank DOM failures were test setup failures, not defect proof. Production StarterKit's trailing paragraph remains enabled.

### Post-repair focused milestones

- Component capture `4a850b70-c97c-4c2d-a060-cb5513843878`: all 34 cases passed (eight new real-view cases and 26 existing cases). The new cases use actual SessionEditorView, editor/history, toolbar, production extensions, registry and attachmentActions; deferred import/preview tests mock only native I/O boundaries. They cover A/B roundtrips, identical bodies with private histories, blank activation, same-ID typing/node undo/redo continuity, popover/error and saved-selection lifetime, delayed previews and stale imports.
- The deferred upload uses real toolbar file selection and actual attachmentActions, with A -> B -> A restoring the same Session and Entry IDs. Exact inserter identity rejects the old import, native deletion discards it and no authored-body update occurs. Delayed old-A preview completion cannot hydrate the latest A editor; its latest preview displays correctly.
- Linux built-app capture `88e6afd4-0fcb-4cdf-9026-5e1c8c38d736`: all six native cases passed. Final maintained source is `e2e/specs/undo-history-isolation.e2e.mjs`; no additional temporary source snapshot is required.
- Same-Note undo/redo survives actual autosave and title changes. A/B switching preserves original Entry identities, exact stored HTML/JSON and reopened content; cross-switch undo/redo is a no-op and need not report a handled key event when history is empty. Equal-body Notes retain private-history isolation; blank storage retains canonical JSON content `[]`.
- Pending-Note navigation observed `Unsaved changes` and clicked in 22 ms, below the 850 ms autosave interval. Navigation flushed the original A Entry while B remained unchanged. Invalid link popover state reset; a new valid B link preserved exact native HTML/JSON attributes, including `title: null`.
- A real 1x1 managed PNG retained its data reference and decoded preview pixel `[18,171,52,255]` after remount. Empty-history undo/redo did not remove it. Stable caret placement precedes nonblank DOM comparisons; focused blank paragraphs and image gap-cursor/node-selection classes are selection-only corrections, not authored content. Blank comparisons use document semantics, and full native body/JSON checks remain.

### Chronology and remaining acceptance boundaries

These captures are historical milestones before this final documentation edit, rooted in Flow records, not inferred current-source closeout results. Production did not change after the key edit; subsequent test edits corrected fixture contracts only. Final canonical `bun run verify`, full standard `bun run e2e`, current-source focused reruns and independent review acceptance are tracked by the checklist and Flow closeout. Their later outcomes supersede this timestamped pending state; none is inferred here.

The native asynchronous pending-upload race was not deterministically exercised; its coverage is component integration only. Non-Linux behavior, the full standard E2E suite and canonical gates for this repair remain pending at this milestone. Prior accepted dirty work was preserved; this report is not Git, commit or release authority.

### Accepted repair closeout

Independent final review accepted `undo-fix-01` at Flow revision 25 with no findings. `plan-05.R123-03` and `undo-inspect-01.R7-01` are repaired for the approved Session-navigation contract. Final source-bound Linux checks passed: exact `bun run verify` (`ac6f0331-113b-4ec6-9f9a-b48f811d2bbb`, including 316 frontend tests), focused real-view/editor/attachment checks (`c1653490-5d3f-4f8c-aa0f-519e53617e7a`, 34 tests), explicit native isolation spec (`340b3e66-74d3-499e-93e3-6cf485b932eb`, six cases), and exact `bun run e2e` (`3d275cd0-92b4-4dcf-9031-540a153954ba`, five standard scenarios). The repository checklist retains the shared accepted source digest and historical failure evidence.

This post-review closeout records acceptance after the captures and supersedes the pending milestone statements above. Native pending-upload race timing, non-Linux behavior and same-Session Note Entry replacement remain outside the verified claims. No commit, push or release was performed.
