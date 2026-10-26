import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from '../../frontend/node_modules/jsdom/lib/api.js'
import { installUiPerformanceObserver } from './ui-performance-observer.mjs'
import { armDomAction, armEditorInput, assertComparableInput, buildInputProvenance, firstOpeningEndpoint, installDomActionProvenance, validateDomSample } from './ask-ai-conversations.benchmark.mjs'

function notesCase({ changeUi = true } = {}) {
  const messages = Array.from({ length: 100 }, (_, index) => `<p class="chat-message">PERF_MESSAGE_${String(index).padStart(3, '0')}</p>`).join('')
  const dom = new JSDOM(`<div class="session-workspace"><button aria-expanded="false">Ask AI</button></div>
    <div aria-label="Note body">Original Note</div><section aria-label="Session chat" hidden>${messages}<div aria-label="Message images"><img><img><img><img></div>
    <div><span role="status">Conversation saved</span></div><textarea>ISOLATION_ACTIVE_UNSENT_INPUT</textarea></section><aside><button>Ask AI</button></aside>`, { runScripts: 'outside-only' })
  const w = dom.window, frames = []
  w.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}] }
  for (const image of w.document.querySelectorAll('img')) Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 2 }, naturalHeight: { value: 2 } })
  w.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  w.eval(`(${installUiPerformanceObserver.toString()})()`)
  w.eval(`(${installDomActionProvenance.toString()})()`)
  const button = w.document.querySelector('.session-workspace button')
  button.addEventListener('click', () => {
    if (!changeUi) return
    w.document.querySelector('[aria-label="Session chat"]').hidden = false
    button.setAttribute('aria-expanded', 'true')
  })
  return { dom, w, button,
    arm: () => w.eval(`(${armDomAction.toString()})('notes-open','Ask AI',null)`),
    frame: () => { const callback = frames.shift(); assert.ok(callback); callback() },
    state: () => JSON.parse(JSON.stringify({ samples: w.__uiPerf.samples, clicks: w.__domAction.clicks, failures: w.__uiPerf.failures })) }
}

test('programmatic HTMLElement.click preserves false isTrusted and requires two ready frames', () => {
  const { dom, w, button, arm, frame, state } = notesCase()
  try {
    arm()
    assert.equal(w.__uiPerf.samples.length, 0)
    button.click()
    frame()
    assert.equal(w.__uiPerf.samples.length, 0)
    frame()
    const result = state()
    assert.equal(result.samples.length, 1)
    assert.deepEqual(result.samples[0].proof, { messages: 100, images: 4, textCharacters: 1600 })
    assert.equal(result.samples[0].trustedEvent, false)
    assert.equal(result.clicks[0].isTrusted, false)
    assert.equal(result.clicks[0].buttonText, 'Ask AI')
    assert.deepEqual(result.failures, [])
    assert.throws(() => assert.equal(result.samples[0].trustedEvent, true), /false !== true/)
    validateDomSample(result.samples[0], result.clicks[0], 1)
    assert.throws(arm, /Notes must start with the Ask AI panel closed/)
  } finally { dom.window.close() }
})

test('a UI click without the Notes transition cannot produce a ready sample', () => {
  const { dom, button, arm, frame, state } = notesCase({ changeUi: false })
  try {
    arm(); button.click(); frame(); frame(); frame()
    assert.equal(state().samples.length, 0)
    assert.equal(state().clicks.length, 1)
  } finally { dom.window.close() }
})

test('a matching label on another control cannot supply action provenance', () => {
  const { dom, w, arm, state } = notesCase()
  try {
    arm()
    w.document.querySelector('aside button').click()
    assert.equal(state().clicks.length, 0)
    assert.throws(() => validateDomSample({ action: 'notes-open' }, state().clicks[0], 1), /corresponding captured UI event/)
  } finally { dom.window.close() }
})

test('Save requires the edited marker and records editor input without declaring physical input', () => {
  const { dom, w, frame, state } = notesCase()
  try {
    const pane = w.document.createElement('section'); pane.className = 'record-detail-pane'
    pane.innerHTML = '<div contenteditable="true">Original</div><button>Save</button>'
    w.document.body.append(pane)
    assert.throws(() => w.eval(`(${armDomAction.toString()})('record-save','Save',' NEW_MARKER')`), /literal edited marker/)
    w.eval(`(${armEditorInput.toString()})(' NEW_MARKER')`)
    const editor = pane.querySelector('[contenteditable]')
    editor.textContent += ' NEW_MARKER'
    editor.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' NEW_MARKER' }))
    w.__domAction.edit = null
    pane.querySelector('button').addEventListener('click', () => {
      editor.remove(); pane.querySelector('button').textContent = 'Edit'
      pane.append(w.document.createTextNode('Original NEW_MARKER'))
      for (let index = 0; index < 4; index++) {
        const image = w.document.createElement('img')
        Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 2 } }); pane.append(image)
      }
    })
    w.eval(`(${armDomAction.toString()})('record-save','Save',' NEW_MARKER')`)
    pane.querySelector('button').click(); frame(); frame()
    const result = state()
    assert.deepEqual(result.samples[0].proof, { marker: ' NEW_MARKER', images: 4 })
    const edits = JSON.parse(JSON.stringify(w.__domAction.edits))
    const provenance = buildInputProvenance(result.samples, result.clicks, edits, { provider: 'embedded-test-mechanics' })
    assert.equal(provenance.physicalOsInputQualified, false)
    assert.deepEqual(provenance.editorInput, [{ eventType: 'input', eventClass: 'InputEvent', isTrusted: false, inputType: 'insertText' }])
  } finally { dom.window.close() }
})

function comparisonCase() {
  const click = { eventType: 'click', eventClass: 'MouseEvent', isTrusted: false, inputType: null, action: 'notes-open', actionId: 1, buttonText: 'Ask AI', observerEventAtMs: 100 }
  const sample = { action: 'notes-open', eventAtMs: 100, trustedEvent: false }
  const edit = { events: [{ eventType: 'input', eventClass: 'InputEvent', isTrusted: true, inputType: 'insertText' }] }
  const driver = { provider: 'embedded', version: '1.2.0', executorSha256: 'same-source' }
  const provenance = buildInputProvenance([sample], [click], [edit], driver)
  const reference = { schema: 'qa-scribe-ask-ai-conversations-performance-v2', side: 'baseline', completed: true, commonScopeComplete: true, failures: 0, inputProvenance: provenance }
  return { click, sample, edit, driver, provenance, reference }
}

test('qualified baseline comparison accepts identical provenance and rejects mixed side provenance', () => {
  const { provenance, reference } = comparisonCase()
  assertComparableInput(reference, structuredClone(provenance))
  const differentTrust = structuredClone(provenance); differentTrust.editorInput[0].isTrusted = false
  assert.throws(() => assertComparableInput(reference, differentTrust), /Input provenance differs/)
  const differentDriver = structuredClone(provenance); differentDriver.driver.executorSha256 = 'different-source'
  assert.throws(() => assertComparableInput(reference, differentDriver), /Input provenance differs/)
  assert.throws(() => assertComparableInput({ ...reference, schema: 'qa-scribe-ask-ai-conversations-performance-v1' }, provenance), /Reject old/)
  assert.throws(() => assertComparableInput({ ...reference, completed: false }, provenance))
})

test('missing input, duplicate clicks, altered isTrusted and mixed click streams are rejected', () => {
  const { sample, click, edit, driver } = comparisonCase()
  assert.throws(() => buildInputProvenance([sample], [click, click], [edit], driver), /exactly one/)
  assert.throws(() => buildInputProvenance([sample], [click], [{ events: [] }], driver), /observed input event/)
  assert.throws(() => validateDomSample({ ...sample, trustedEvent: true }, click, 1), /Keep the observed isTrusted/)
  assert.throws(() => buildInputProvenance([sample, { ...sample, trustedEvent: true }], [click, { ...click, actionId: 2, isTrusted: true }], [edit], driver), /programmatic click path/)
  const mixedInput = { events: [{ ...edit.events[0], isTrusted: false }] }
  assert.throws(() => buildInputProvenance([sample], [click], [edit, mixedInput], driver), /Mixed editor-input/)
})

function startupCase() {
  return { spawnAt: '1970-01-01T00:00:01.000Z', bracket: { before: 1399, after: 1401 },
    timeline: { timeOrigin: 1100, now: 300, wallNow: 1400, rafAvailable: true,
      measures: [{ name: 'qa-scribe startup boot-to-first-paint-after-boot', startTimeMs: 50, durationMs: 100 },
        { name: 'qa-scribe startup boot-to-first-session-opened', startTimeMs: 50, durationMs: 80 }] } }
}

test('startup epoch uses measure start plus duration and separates later driver observation', () => {
  const { spawnAt, timeline, bracket } = startupCase()
  const result = firstOpeningEndpoint(spawnAt, timeline, bracket)
  assert.equal(result.opportunityEpochMs, 1250)
  assert.equal(result.spawnToStartupRafOpportunityMs, 250)
  assert.equal(result.driverObservedReadyMs, 401)
  assert.equal(result.physicalPaintQualified, false)
  assert.equal(result.isolatedMigrationCost, false)
})

test('startup rejects clock mismatch, timer fallback, missing and duplicated measures', () => {
  const { spawnAt, timeline, bracket } = startupCase()
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, wallNow: 2000 }, bracket), /host command bracket/)
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, timeOrigin: 1000 }, bracket), /performance epoch differs/)
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, rafAvailable: false }, bracket), /Timer fallback/)
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, measures: [] }, bracket), /one startup/)
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, measures: [...timeline.measures, timeline.measures[0]] }, bracket), /one startup/)
})

test('startup rejects failed boot, deep provider work and a reused or future WebView timeline', () => {
  const { spawnAt, timeline, bracket } = startupCase()
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, measures: [timeline.measures[0]] }, bracket), /failed boot/)
  assert.throws(() => firstOpeningEndpoint(spawnAt, { ...timeline, measures: [...timeline.measures, { name: 'qa-scribe startup boot-to-provider-deep-refresh' }] }, bracket))
  assert.throws(() => firstOpeningEndpoint('1970-01-01T00:00:01.300Z', timeline, bracket), /fresh native launch/)
  const future = structuredClone(timeline); future.measures[0].durationMs = 1000
  assert.throws(() => firstOpeningEndpoint(spawnAt, future, bracket), /fresh native launch/)
})
