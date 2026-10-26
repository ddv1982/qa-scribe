import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, release } from 'node:os'
import { join, resolve } from 'node:path'
import { installUiPerformanceObserver } from './ui-performance-observer.mjs'

export function installDomActionProvenance() {
  const state = { clicks: [], edits: [], target: null, edit: null }
  window.__domAction = state
  const describe = event => ({ eventType: event.type, eventClass: event.constructor.name, isTrusted: event.isTrusted, inputType: event.inputType ?? null })
  document.addEventListener('click', event => {
    const pending = window.__uiPerf.pending
    if (!pending || event.target.closest('button') !== state.target) return
    state.clicks.push({ ...describe(event), action: pending.name, actionId: pending.actionId,
      observerEventAtMs: pending.startedAt, buttonText: state.target.textContent.trim() })
  }, true)
  document.addEventListener('input', event => {
    if (!state.edit || !event.target.closest('.record-detail-pane [contenteditable="true"]')) return
    state.edit.events.push(describe(event))
  }, true)
}

export function armDomAction(name, trigger, marker) {
  const visible = node => Boolean(node?.getClientRects().length && !node.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden')
  if (window.__uiPerf.pending) throw Error('Overlapping measured action')
  const scope = name === 'notes-open' ? '.session-workspace' : '.record-detail-pane'
  const button = [...document.querySelectorAll(`${scope} button`)].find(node => visible(node) && node.textContent.trim() === trigger && !node.disabled)
  if (!button) throw Error('Expected enabled UI action is missing')
  if (name === 'notes-open') {
    if (!visible(document.querySelector('[aria-label="Note body"]')) || button.getAttribute('aria-expanded') !== 'false') throw Error('Notes must start with the Ask AI panel closed')
  } else if (name === 'record-save') {
    const editor = document.querySelector('.record-detail-pane [contenteditable="true"]')
    if (!visible(editor) || !marker || !editor.textContent.includes(marker)) throw Error('Save must start with the literal edited marker')
  } else { throw Error('Unsupported DOM action') }
  window.__domAction.target = button
  window.__uiPerf.pending = { name, trigger, marker, actionId: window.__uiPerf.samples.length + 1 }
}

export function armEditorInput(marker) {
  const editor = document.querySelector('.record-detail-pane [contenteditable="true"]')
  if (!editor || editor.textContent.includes(marker)) throw Error('Editor input must add a new marker')
  const edit = { marker, command: 'element.addValue', mechanism: 'embedded document.execCommand insertText', events: [] }
  window.__domAction.edits.push(edit)
  window.__domAction.edit = edit
}

export function validateDomSample(sample, capture, ordinal) {
  assert.ok(capture, 'The observer sample needs a corresponding captured UI event')
  assert.equal(capture.actionId, ordinal)
  assert.equal(capture.action, sample.action)
  assert.equal(capture.eventType, 'click')
  assert.equal(capture.buttonText, sample.action === 'notes-open' ? 'Ask AI' : 'Save')
  assert.equal(capture.observerEventAtMs, sample.eventAtMs)
  assert.equal(capture.isTrusted, sample.trustedEvent, 'Keep the observed isTrusted value unchanged')
  assert.equal(capture.isTrusted, false, 'This contract requires the embedded driver programmatic click path')
}

export function buildInputProvenance(samples, clicks, edits, driver) {
  assert.equal(clicks.length, samples.length, 'Every sample needs exactly one originating UI click')
  samples.forEach((sample, index) => validateDomSample(sample, clicks[index], index + 1))
  assert.ok(samples.length > 0 && edits.length > 0, 'Both click and editor-input provenance are required')
  const signature = ({ eventType, eventClass, isTrusted, inputType }) => ({ eventType, eventClass, isTrusted, inputType })
  const click = signature(clicks[0])
  clicks.forEach(event => assert.deepEqual(signature(event), click, 'Mixed click provenance in one run'))
  const editorInput = edits[0].events.map(signature)
  assert.ok(editorInput.length > 0, 'The editor action must emit an observed input event')
  edits.forEach(edit => {
    assert.ok(edit.events.every(event => event.eventType === 'input' && typeof event.isTrusted === 'boolean'))
    assert.deepEqual(edit.events.map(signature), editorInput, 'Mixed editor-input provenance in one run')
  })
  return { metric: 'dom-action-to-ready-v2', physicalOsInputQualified: false, driver, click, editorInput }
}

export function assertComparableInput(reference, candidate) {
  assert.equal(reference.schema, 'qa-scribe-ask-ai-conversations-performance-v2', 'Reject old or unqualified provenance references')
  assert.equal(reference.side, 'baseline')
  assert.equal(reference.completed, true)
  assert.equal(reference.commonScopeComplete, true)
  assert.equal(reference.failures, 0)
  assert.deepEqual(candidate, reference.inputProvenance, 'Input provenance differs from the qualified baseline')
}

export function firstOpeningEndpoint(spawnAt, timeline, bracket) {
  const toleranceMs = 2
  const spawnEpochMs = Date.parse(spawnAt)
  for (const value of [spawnEpochMs, timeline.timeOrigin, timeline.now, timeline.wallNow, bracket.before, bracket.after]) assert.ok(Number.isFinite(value), 'Finite same-host clock values are required')
  assert.ok(bracket.after >= bracket.before && timeline.wallNow >= bracket.before && timeline.wallNow <= bracket.after, 'WebView wall time must lie inside the host command bracket')
  assert.ok(Math.abs(timeline.timeOrigin + timeline.now - timeline.wallNow) <= toleranceMs, 'WebView performance epoch differs from same-host wall time')
  assert.equal(timeline.rafAvailable, true, 'Timer fallback cannot qualify a RAF endpoint')
  const matches = timeline.measures.filter(entry => entry.name === 'qa-scribe startup boot-to-first-paint-after-boot')
  assert.equal(matches.length, 1, 'Require one startup paint-opportunity measure')
  assert.ok(timeline.measures.some(entry => entry.name === 'qa-scribe startup boot-to-first-session-opened'), 'A failed boot cannot qualify first opening')
  assert.ok(!timeline.measures.some(entry => entry.name === 'qa-scribe startup boot-to-provider-deep-refresh'))
  const entry = matches[0]
  assert.ok(Number.isFinite(entry.startTimeMs) && entry.startTimeMs >= 0 && Number.isFinite(entry.durationMs) && entry.durationMs >= 0)
  const opportunityEpochMs = timeline.timeOrigin + entry.startTimeMs + entry.durationMs
  assert.ok(timeline.timeOrigin >= spawnEpochMs - toleranceMs && opportunityEpochMs >= spawnEpochMs && opportunityEpochMs <= timeline.timeOrigin + timeline.now + toleranceMs, 'Startup endpoint must belong to this fresh native launch')
  return { metric: 'native-spawn-to-startup-raf-opportunity-v1', spawnEpochMs, opportunityEpochMs,
    spawnToStartupRafOpportunityMs: opportunityEpochMs - spawnEpochMs,
    driverObservedReadyEpochMs: bracket.after, driverObservedReadyMs: bracket.after - spawnEpochMs,
    sameHostClockBracket: bracket, clockToleranceMs: toleranceMs, physicalPaintQualified: false, isolatedMigrationCost: false }
}

function registerBenchmark() {
  const env = process.env
  assert.equal(env.QA_SCRIBE_UI_PERF_LANE_RELEASED, '1', 'The parent must release the native lane')
  assert.ok(['baseline', 'head'].includes(env.QA_SCRIBE_UI_PERF_SIDE))
  assert.match(env.QA_SCRIBE_E2E_BENCHMARK_REVISION ?? '', /^[a-f0-9]{40}$/)
  assert.equal(env.QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE, 'release-production-e2e')
  const artifacts = env.QA_SCRIBE_E2E_ARTIFACTS
  const data = env.QA_SCRIBE_E2E_APP_DATA_DIR
  const fixture = JSON.parse(readFileSync(join(data, 'ask-ai-isolation-fixture.json'), 'utf8'))
  assert.equal(fixture.schema, 'qa-scribe-ask-ai-isolation-fixture-v1')
  const receipt = {
    schema: 'qa-scribe-ask-ai-conversations-performance-v2',
    side: env.QA_SCRIBE_UI_PERF_SIDE,
    sourceSha: env.QA_SCRIBE_E2E_BENCHMARK_REVISION,
    binarySha256: createHash('sha256').update(readFileSync(env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
    fixture,
    machine: { platform: process.platform, architecture: process.arch, release: release(), logicalCpus: cpus().length, loadAverageBefore: loadavg() },
    commonScope: 'DOM-action-to-ready. The maintained observer captures the programmatic embedded-driver click through the second ready animation frame. Actual isTrusted values are retained. This is a paint opportunity, not physical OS input latency. Driver round trips and provider work are excluded.',
    launchScope: 'Fresh-process spawn-start to the existing startup requestAnimationFrame callback, projected through WebView timeOrigin. Same-host clocks are bracket-checked. Includes native setup, storage and frontend boot. A paint opportunity, not physical paint or isolated migration cost. Later driver-observed readiness and backend storage logs remain separate diagnostics.',
    headOnly: { status: 'extension-points-unimplemented', actions: ['fresh-ask-ai-open', 'continue', 'proposal-apply', 'notes-reveal-after-record-chat', 'repeated-empty-launch-row-count'], budgetsMs: { freshAskAiP95: 250, continueP95: 250, applyP95: 100 } },
    completed: false, commonScopeComplete: false, requestedScopeComplete: false,
    failures: 0, samples: [],
  }
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  const driver = { provider: 'embedded', package: 'tauri-plugin-wdio-webdriver', version: '1.2.0',
    executorSha256: hash(env.QA_SCRIBE_UI_PERF_DRIVER_EXECUTOR), serviceSha256: hash(resolve('frontend/node_modules/@wdio/tauri-service/dist/esm/index.js')),
    observerSha256: hash(resolve('e2e/specs/ui-performance-observer.mjs')), probeSha256: hash(resolve('e2e/specs/ask-ai-conversations.benchmark.mjs')),
    platform: process.platform, architecture: process.arch,
    clickMechanism: 'elementClick -> click_element -> evaluate_js -> HTMLElement.click', editMechanism: 'element.addValue -> send_keys_to_element -> document.execCommand insertText' }
  const reference = env.QA_SCRIBE_UI_PERF_INPUT_REFERENCE ? JSON.parse(readFileSync(env.QA_SCRIBE_UI_PERF_INPUT_REFERENCE, 'utf8')) : null
  assert.ok(receipt.side !== 'head' || reference, 'Head requires a successful v2 baseline input-provenance reference')
  receipt.driver = driver
  receipt.inputReference = reference ? { sourceSha: reference.sourceSha, receiptSha256: hash(env.QA_SCRIBE_UI_PERF_INPUT_REFERENCE) } : null
  const persist = () => writeFileSync(join(artifacts, 'ask-ai-conversations-performance.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  const invoke = (name, args) => browser.execute((name, args) => window.__TAURI_INTERNALS__.invoke(name, args), name, args)
  const click = async selector => { const control = await $(selector); await control.waitForClickable(); await control.click() }
  const audit = (afterUi = false) => JSON.parse(execFileSync('python3', [resolve('scripts/prepare-ask-ai-baseline.py'), 'verify', data, ...(afterUi ? ['--after-ui'] : [])], { encoding: 'utf8' }))
  const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]

  async function measure(name, trigger, action, marker = null) {
    const count = receipt.samples.length
    await browser.execute(armDomAction, name, trigger, marker)
    await action()
    await browser.waitUntil(() => browser.execute(count => window.__uiPerf.samples.length === count + 1 || window.__uiPerf.failures.length > 0, count), { timeout: 7000 })
    const state = await browser.execute(() => ({ samples: window.__uiPerf.samples, failures: window.__uiPerf.failures, clicks: window.__domAction.clicks }))
    receipt.samples = state.samples.map((sample, index) => ({ ...sample, inputProvenance: state.clicks[index] }))
    receipt.observerFailures = state.failures
    persist()
    assert.deepEqual(state.failures, [])
    assert.equal(state.samples[count].action, name)
    assert.equal(state.clicks.length, count + 1)
    validateDomSample(state.samples[count], state.clicks[count], count + 1)
  }

  describe('Ask AI isolation common-operation baseline', () => {
    it('records fresh-process diagnostics and twenty Notes openings and record Saves', async () => {
      persist()
      try {
        const session = await $('[role="option"]*=Native UI performance fixture')
        await session.waitForDisplayed({ timeout: 15000 })
        await browser.execute(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const lifecycle = readdirSync(artifacts).filter(name => /^native-lifecycle-.*\.jsonl$/.test(name))
          .flatMap(name => readFileSync(join(artifacts, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
        const spawns = lifecycle.filter(row => row.phase === 'embedded.spawn-start')
        assert.equal(spawns.length, 1, 'Fresh-process launch must have exactly one observed native spawn')
        await browser.waitUntil(() => browser.execute(() => performance.getEntriesByName('qa-scribe startup boot-to-first-paint-after-boot').length === 1))
        const clockBefore = Date.now()
        receipt.webViewStartup = await browser.execute(() => ({ timeOrigin: performance.timeOrigin, now: performance.now(), wallNow: Date.now(), rafAvailable: typeof requestAnimationFrame === 'function',
          measures: performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('qa-scribe startup ')).map(entry => ({ name: entry.name, startTimeMs: entry.startTime, durationMs: entry.duration })) }))
        const clockAfter = Date.now()
        receipt.launch = { kind: 'first-launch-of-private-fixture-copy', lifecycle,
          telemetrySourceSha256: hash(resolve('frontend/src/app/startupTelemetry.ts')),
          endpoint: firstOpeningEndpoint(spawns[0].at, receipt.webViewStartup, { before: clockBefore, after: clockAfter }) }
        receipt.launch.bootSessionTitle = await $('[aria-label="Session title"]').getValue()
        assert.ok(['Native UI performance fixture', 'Isolation submitted Notes fixture', 'Isolation legacy mixed staged fixture'].includes(receipt.launch.bootSessionTitle))
        receipt.before = audit()
        await session.waitForClickable()
        await session.click()
        await browser.waitUntil(async () => await $('[aria-label="Session title"]').getValue() === 'Native UI performance fixture')
        const chat = await invoke('get_chat', { sessionId: 'perf-session' })
        assert.equal(chat.draftId, 'perf-chat')
        assert.equal(chat.messages.length, 100)
        assert.equal(chat.messages.flatMap(message => message.images).length, 4)
        assert.equal(chat.composer, 'ISOLATION_ACTIVE_UNSENT_INPUT')
        const submitted = await invoke('get_chat', { sessionId: 'isolation-submitted' })
        assert.equal(submitted.draftId, 'isolation-submitted-chat')
        assert.equal(submitted.submission.noteId, 'isolation-submitted-note')
        const mixed = await invoke('get_chat', { sessionId: 'isolation-mixed' })
        assert.equal(mixed.messages.length, 10)
        assert.equal(mixed.proposals.filter(proposal => proposal.state.kind === 'staged').length, 3)
        receipt.retainedState = { activeComposer: chat.composer, submittedReceipt: submitted.submission, mixedStagedProposals: mixed.proposals.map(proposal => proposal.id) }
        await browser.execute(installUiPerformanceObserver)
        await browser.execute(installDomActionProvenance)
        for (let index = 0; index < 20; index++) {
          await click('[role="tab"]*=Note')
          if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('.ask-ai-panel:not([hidden]) button[aria-label="Close Ask AI"]')
          await $('[aria-label="Note body"]').waitForDisplayed()
          await measure('notes-open', 'Ask AI', () => click('button=Ask AI'))
        }
        await browser.saveScreenshot(join(artifacts, 'legacy-notes-open.png'))
        await click('[role="tab"]*=Findings')
        await $('[aria-label="Performance rich finding finding preview"]').waitForDisplayed()
        for (let index = 0; index < 20; index++) {
          await click('button=Edit')
          const editor = await $('.record-detail-pane [contenteditable="true"]')
          await editor.waitForDisplayed()
          await editor.click()
          const marker = ` ISOLATION_SAVE_${String(index).padStart(2, '0')}`
          await browser.execute(armEditorInput, marker)
          await editor.addValue(marker)
          await browser.waitUntil(() => browser.execute(marker => document.querySelector('.record-detail-pane [contenteditable="true"]')?.textContent.includes(marker), marker))
          await browser.execute(() => { window.__domAction.edit = null })
          await measure('record-save', 'Save', () => click('button=Save'), marker)
          const saved = (await invoke('list_findings', { sessionId: 'perf-session' })).find(record => record.id === 'perf-finding')
          assert.ok(saved.body.includes(marker), 'Save must persist the exact native editor input')
          assert.equal((saved.body.match(/qa-scribe-attachment:\/\//g) ?? []).length, 4)
        }
        await browser.saveScreenshot(join(artifacts, 'record-after-twenty-saves.png'))
        receipt.after = audit(true)
        receipt.execution = JSON.parse(execFileSync('python3', ['-c', 'import json,pathlib,sqlite3,sys\np=pathlib.Path(sys.argv[1]).resolve()\nwith sqlite3.connect(p.as_uri()+"?mode=ro",uri=True) as db:\n print(json.dumps({"aiRuns":db.execute("SELECT count(*) FROM ai_runs").fetchone()[0],"messages":db.execute("SELECT count(*) FROM chat_messages").fetchone()[0],"conversations":db.execute("SELECT count(*) FROM chat_drafts").fetchone()[0]}))', join(data, 'qa-scribe.sqlite')], { encoding: 'utf8' }))
        assert.deepEqual(receipt.execution, { aiRuns: 0, messages: 1120, conversations: 103 })
        receipt.providerExecutions = readdirSync(env.QA_SCRIBE_E2E_FIXTURE_DIR).filter(name => /exec-\d+\.started$/.test(name))
        assert.deepEqual(receipt.providerExecutions, [])
        assert.equal(receipt.samples.length, 40)
        const provenance = await browser.execute(() => ({ clicks: window.__domAction.clicks, edits: window.__domAction.edits }))
        receipt.editorInputs = provenance.edits
        assert.equal(provenance.edits.length, 20)
        receipt.inputProvenance = buildInputProvenance(receipt.samples, provenance.clicks, provenance.edits, driver)
        if (reference) {
          assertComparableInput(reference, receipt.inputProvenance)
          assert.equal(receipt.launch.bootSessionTitle, reference.launch.bootSessionTitle, 'First-opening comparison needs the same initially opened fixture Session')
          assert.equal(receipt.launch.endpoint.metric, reference.launch.endpoint.metric)
          assert.equal(receipt.launch.telemetrySourceSha256, reference.launch.telemetrySourceSha256, 'First-opening endpoints need the same telemetry implementation')
        }
        receipt.comparisonStatus = reference ? 'qualified-reference-provenance-matched' : 'baseline-reference-candidate'
        receipt.summary = Object.fromEntries(['notes-open', 'record-save'].map(action => {
          const values = receipt.samples.filter(sample => sample.action === action).map(sample => sample.elapsedMs)
          assert.equal(values.length, 20)
          return [action, { count: values.length, p95Ms: p95(values), minMs: Math.min(...values), maxMs: Math.max(...values) }]
        }))
        receipt.machine.loadAverageAfter = loadavg()
        receipt.completed = true
        receipt.commonScopeComplete = true
      } catch (error) {
        receipt.failures++
        receipt.error = String(error)
        throw error
      } finally { persist() }
    }).timeout(240000)
  })
}

if (typeof globalThis.describe === 'function') registerBenchmark()
