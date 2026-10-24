import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, release } from 'node:os'
import { join } from 'node:path'
import { installUiPerformanceObserver, scrollRichRecord } from './ui-performance-observer.mjs'

const env = process.env
const artifacts = env.QA_SCRIBE_E2E_ARTIFACTS
const side = env.QA_SCRIBE_UI_PERF_SIDE
assert.ok(['baseline', 'head'].includes(side), 'QA_SCRIBE_UI_PERF_SIDE must explicitly be baseline or head')
assert.match(env.QA_SCRIBE_E2E_BENCHMARK_REVISION ?? '', /^[a-f0-9]{40}$/, 'Declare the exact source SHA')
assert.equal(env.QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE, 'release-production-e2e')
assert.equal(env.QA_SCRIBE_UI_PERF_LANE_RELEASED, '1', 'Parent must release the native lane before invocation')
const fixture = JSON.parse(readFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'ui-perf-fixture.json'), 'utf8'))
const receipt = { schema: 'qa-scribe-native-ui-perf-v1', side, revision: env.QA_SCRIBE_E2E_BENCHMARK_REVISION,
  binarySha256: createHash('sha256').update(readFileSync(env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
  buildMode: env.QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE, fixture,
  clock: 'WebView performance.now and requestAnimationFrame timestamps',
  scope: 'DOM event capture to second ready animation frame. Paint opportunity, not physical display paint. No WDIO round trip or provider request is timed.',
  notesOpenScope: 'Visible opening/reveal latency. First means first measured click, not cold parsing. C1 may retain hydrated chat DOM while hidden. No Session-startup or total-work-reduction inference; the production startup gate is separate.',
  machine: { platform: process.platform, architecture: process.arch, release: release(), logicalCpus: cpus().length, loadAverage: loadavg() },
  completed: false, requestedScopeComplete: false, failures: 0, samples: [],
  proposal: { status: side === 'head' ? 'pending' : 'not-applicable', cases: [], applyBudgetMs: 100,
    scope: 'Head only. Twenty short realistic finding refinements in a separate 40-message companion Session. No images and no 100 KB proposal claim. Provider completion is seeded before native launch through the real V2 core contract.' } }
const persist = () => writeFileSync(join(artifacts, 'native-ui-performance.json'), `${JSON.stringify(receipt, null, 2)}\n`)
const invoke = (name, args = {}) => browser.execute(async (name, args) => window.__TAURI_INTERNALS__.invoke(name, args), name, args)
const click = async selector => { const element = await $(selector); await element.waitForClickable(); await element.click() }
const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]

async function measure(name, trigger, action, marker, proposal) {
  const count = receipt.samples.length
  await browser.execute((name, trigger, marker, proposal) => {
    if (window.__uiPerf.pending) throw Error('Overlapping performance action')
    window.__uiPerf.pending = { name, trigger, marker, proposal }
  }, name, trigger, marker, proposal)
  await action()
  await browser.waitUntil(() => browser.execute(count => window.__uiPerf.samples.length === count + 1
    || window.__uiPerf.failures.length > 0, count), { timeout: 7000, timeoutMsg: `${name} did not produce a WebView sample` })
  const state = await browser.execute(() => ({ samples: window.__uiPerf.samples, failures: window.__uiPerf.failures }))
  receipt.samples = state.samples
  receipt.observerFailures = state.failures
  persist()
  assert.deepEqual(state.failures, [])
  assert.equal(state.samples[count].action, name)
}

async function proposalRefinements() {
  const companion = JSON.parse(readFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'ui-perf-refinement.json'), 'utf8'))
  assert.equal(companion.schema, 'qa-scribe-ui-perf-refinement-v1')
  assert.equal(companion.mainFixtureUnchanged, true)
  assert.equal(companion.cases.length, 20)
  assert.equal(companion.messages, 40)
  assert.equal(companion.proposals, 20)
  assert.equal(companion.aiRuns, 0)
  assert.equal(companion.images, 0)
  assert.equal(companion.providerInvoked, false)
  receipt.proposal.fixture = companion
  const initial = await invoke('get_chat', { sessionId: companion.sessionId })
  assert.equal(initial.messages.length, 40)
  assert.ok(initial.messages.every(message => message.status === 'completed' && message.aiRunId === null))
  assert.equal(initial.aiRuns.length, 0)
  assert.equal(initial.proposals.length, 20)
  assert.ok(initial.proposals.every(proposal => proposal.state.kind === 'offered'))
  await click(`[role="option"]*=${companion.sessionTitle}`)
  await click('[role="tab"]*=Note')
  await browser.waitUntil(async () => await $('[aria-label="Session title"]').getValue() === companion.sessionTitle)
  await click('[role="tab"]*=Findings')
  for (const item of companion.cases) {
    assert.equal(item.contractVersion, 2)
    assert.ok(item.contextBytes < 32 * 1024)
    const offered = initial.proposals.find(proposal => proposal.id === item.proposalId)
    assert.ok(offered && offered.target.kind === 'finding')
    assert.equal(offered.target.snapshot.recordId, item.recordId)
    assert.equal(offered.userMessageId, item.requestId)
    assert.deepEqual(offered.before, item.before)
    assert.deepEqual(offered.after, item.after)
    const recordButton = await $('.record-master-list').$(`button*=${item.beforeTitle}`)
    await recordButton.waitForClickable()
    await recordButton.click()
    await $(`[aria-label="${item.beforeTitle} finding preview"]`).waitForDisplayed()
    await click('button=Ask AI')
    const selector = `.chat-proposal[aria-label="Local refinement for ${item.beforeTitle}"]`
    await $(selector).waitForDisplayed()
    await browser.execute(selector => document.querySelector(selector).scrollIntoView({ block: 'center' }), selector)
    const scopedClick = async text => {
      const control = await $(selector).$(`button=${text}`)
      await control.waitForClickable()
      await control.click()
    }
    await measure('proposal-review', 'Review refinement', () => scopedClick('Review refinement'), null, item)
    await measure('proposal-apply', 'Apply to editor', () => scopedClick('Apply to editor'), null, item)
    const staged = (await invoke('get_chat', { sessionId: companion.sessionId })).proposals.find(proposal => proposal.id === item.proposalId)
    assert.equal(staged?.state.kind, 'staged')
    assert.ok(staged.state.stage.id)
    assert.deepEqual(staged.state.stage.before, item.before)
    assert.deepEqual(staged.state.stage.after, item.after)
    assert.deepEqual((await invoke('list_findings', { sessionId: companion.sessionId })).find(record => record.id === item.recordId), item.beforeRecord,
      'Apply must leave every stored finding field unchanged')
    if (receipt.proposal.cases.length === 19) await browser.saveScreenshot(join(artifacts, 'proposal-apply-dirty-editor.png'))
    await scopedClick('Undo refinement')
    await browser.waitUntil(async () => {
      const proposal = (await invoke('get_chat', { sessionId: companion.sessionId })).proposals.find(proposal => proposal.id === item.proposalId)
      return proposal?.state.kind === 'undone' && await browser.execute(item => {
        const title = document.querySelector('.record-detail-pane [aria-label="Finding title"]')
        const body = document.querySelector('.record-detail-pane [contenteditable="true"]')
        return title?.value === item.beforeTitle && body?.textContent.trim() === item.beforeBodyText
      }, item)
    }, { timeout: 7000, timeoutMsg: 'Undo must restore the literal original editor and clear the staged proposal' })
    await click('button=Discard')
    await $(`[aria-label="${item.beforeTitle} finding preview"]`).waitForDisplayed()
    assert.deepEqual((await invoke('list_findings', { sessionId: companion.sessionId })).find(record => record.id === item.recordId), item.beforeRecord)
    await scopedClick('Hide refinement review')
    await click('[aria-label="Close AI chat"]')
    await $('[aria-label="Session chat"] textarea').waitForDisplayed({ reverse: true })
    receipt.proposal.cases.push({ recordId: item.recordId, proposalId: item.proposalId, stageId: staged.state.stage.id,
      stageKind: 'staged', storedUnchanged: true, dirtyLiteralEditorVerified: true, cleanupKind: 'undone-and-discarded' })
    persist()
  }
  const final = await invoke('get_chat', { sessionId: companion.sessionId })
  assert.equal(final.messages.length, 40)
  assert.equal(final.aiRuns.length, 0)
  assert.equal(final.proposals.filter(proposal => proposal.state.kind === 'undone').length, 20)
  assert.ok(final.proposals.every(proposal => proposal.state.kind !== 'staged'))
  receipt.proposal.status = 'passed'
  receipt.proposal.completedWork = { reviewed: 20, appliedToDirtyEditor: 20, storedRecordsUnchanged: 20, stagesCleared: 20 }
}

describe('Bounded native WebView UI performance preparation', () => {
  it('records shared UI work and head Ask AI plus reviewed proposal Apply work', async () => {
    persist()
    try {
      const session = await $('[role="option"]*=Native UI performance fixture')
      await session.waitForClickable({ timeout: 15000 })
      await session.click()
      await $('[aria-label="Session title"]').waitForDisplayed()
      assert.equal(await $('[aria-label="Session title"]').getValue(), 'Native UI performance fixture')
      const chat = await invoke('get_chat', { sessionId: fixture.sessionId })
      assert.equal(chat.messages.length, 100)
      assert.equal(chat.messages.flatMap(message => message.images).length, 4)
      assert.ok(chat.messages.every(message => message.status === 'completed'))
      receipt.chatJsonBytes = Buffer.byteLength(JSON.stringify(chat))
      await browser.execute(installUiPerformanceObserver)
      for (let index = 0; index < 20; index++) {
        await click('button=Write note')
        await $('[aria-label="Note body"]').waitForDisplayed()
        await measure('notes-open', 'Chat', () => click('button=Chat'))
      }
      await browser.saveScreenshot(join(artifacts, 'notes-chat-100-messages-four-images.png'))
      await click('[role="tab"]*=Findings')
      const preview = '.record-detail-pane [aria-label="Performance rich finding finding preview"]'
      await $(preview).waitForExist()
      await browser.waitUntil(() => browser.execute(() => {
        const images = [...document.querySelectorAll('.record-detail-pane img')]
        return images.length === 4 && images.every(image => image.complete && image.naturalWidth === 2)
      }), { timeout: 7000, timeoutMsg: 'Rich record images did not load' })
      const ask = await $('button=Ask AI').isExisting()
      receipt.observedVariant = ask ? 'head' : 'baseline'
      assert.equal(receipt.observedVariant, side, 'Expected side must match observable Ask AI presence')
      receipt.scroll = await browser.execute(scrollRichRecord, side)
      assert.ok(receipt.scroll.scrollEvents >= 10, 'Actual scroll events must occur')
      assert.ok(receipt.scroll.movedPx >= 1000, 'The long record must actually move')
      assert.equal(receipt.scroll.frameIntervalsMs.length, 120)
      assert.equal(receipt.scroll.headerGapsPx.length, 121, 'Pinned header must be observed throughout scrolling')
      assert.ok(receipt.scroll.geometry.every(frame => frame.pinned), 'Only genuinely pinned record-header positions may be sampled')
      receipt.scroll.p95FrameIntervalMs = percentile(receipt.scroll.frameIntervalsMs)
      receipt.scroll.maxHeaderGapPx = Math.max(...receipt.scroll.headerGapsPx.map(Math.abs))
      await browser.saveScreenshot(join(artifacts, 'long-rich-record-after-scroll.png'))
      for (let index = 0; index < 20; index++) {
        await click('button=Edit')
        const editor = await $('.record-detail-pane [contenteditable="true"]')
        await editor.waitForDisplayed()
        await editor.click()
        const marker = ` PERF_EDIT_${String(index).padStart(2, '0')}`
        await measure('manual-edit', null, () => editor.addValue(marker), marker)
        await measure('record-save', 'Save', () => click('button=Save'), marker)
        const saved = (await invoke('list_findings', { sessionId: fixture.sessionId })).find(record => record.id === fixture.findingId)
        assert.ok(saved.body.includes(marker), 'Save must persist the actual edited finding')
        assert.equal((saved.body.match(/qa-scribe-attachment:\/\//g) ?? []).length, 4, 'Save must retain four managed images')
      }
      if (side === 'head') {
        for (let index = 0; index < 20; index++) {
          await measure('ask-ai-open', 'Ask AI', () => click('button=Ask AI'))
          await click('[aria-label="Close AI chat"]')
          await $('[aria-label="Session chat"] textarea').waitForDisplayed({ reverse: true })
        }
        await proposalRefinements()
      }
      const expectedActions = { 'notes-open': 20, 'manual-edit': 20, 'record-save': 20,
        ...(side === 'head' ? { 'ask-ai-open': 20, 'proposal-review': 20, 'proposal-apply': 20 } : {}) }
      assert.deepEqual(Object.fromEntries(Object.keys(expectedActions).map(action => [action, receipt.samples.filter(sample => sample.action === action).length])), expectedActions)
      assert.equal(receipt.samples.length, side === 'head' ? 120 : 60)
      if (side === 'head') assert.equal(receipt.proposal.status, 'passed')
      receipt.executionAudit = JSON.parse(execFileSync('python3', ['-c',
        'import json,sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as db:\n print(json.dumps({"aiRuns":db.execute("SELECT count(*) FROM ai_runs").fetchone()[0],"messages":db.execute("SELECT count(*) FROM chat_messages").fetchone()[0]}))',
        join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')], { encoding: 'utf8' }))
      assert.deepEqual(receipt.executionAudit, { aiRuns: 0, messages: side === 'head' ? 140 : 100 })
      receipt.providerExecutionFiles = readdirSync(env.QA_SCRIBE_E2E_FIXTURE_DIR).filter(name => /exec-\d+\.started$/.test(name))
      assert.deepEqual(receipt.providerExecutionFiles, [], 'The probe must not request a provider response')
      receipt.summary = Object.fromEntries([...new Set(receipt.samples.map(sample => sample.action))].map(action => {
        const values = receipt.samples.filter(sample => sample.action === action).map(sample => sample.elapsedMs)
        return [action, { count: values.length, p95Ms: percentile(values), minMs: Math.min(...values), maxMs: Math.max(...values) }]
      }))
      if (side === 'head') {
        receipt.proposal.applyP95Ms = receipt.summary['proposal-apply'].p95Ms
        assert.ok(receipt.proposal.applyP95Ms <= receipt.proposal.applyBudgetMs, 'Proposal Apply p95 exceeded its 100 ms budget')
      }
      receipt.machine.loadAverageAfter = loadavg()
      receipt.completed = true
      receipt.requestedScopeComplete = true
      receipt.completedScope = side === 'head' ? 'Shared Notes/scroll/edit/Save; Ask AI; 20 companion proposal review/Apply/Undo/Discard cases.' : 'Shared Notes/scroll/edit/Save. Head-only Ask AI and companion proposals do not exist on baseline.'
    } catch (error) {
      receipt.failures++
      receipt.error = error.message
      if (side === 'head') receipt.proposal.status = 'failed'
      throw error
    }
    finally { persist() }
  }).timeout(240000)
})
