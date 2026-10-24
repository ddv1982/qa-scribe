import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from '../../frontend/node_modules/jsdom/lib/api.js'
import { installUiPerformanceObserver, scrollRichRecord } from './ui-performance-observer.mjs'

async function scrollCase({ side, gap, missingRecordHeader = false, drifting = false, position = 'sticky' }) {
  const header = missingRecordHeader ? '' : side === 'head'
    ? '<header class="record-header"><div class="record-actions"></div></header>'
    : '<div class="record-actions"></div>'
  const dom = new JSDOM(`<section class="center-workspace"><header class="session-context-header"></header>
    <section class="collection-view" style="overflow-y:auto"><div class="record-detail-pane"><article class="editable-record">
    ${header}<div class="rich-editor"></div></article></div></section></section>`, { runScripts: 'outside-only' })
  const w = dom.window
  const port = w.document.querySelector('.collection-view')
  const rect = (top, height) => ({ x: 10, y: top, top, bottom: top + height, left: 10, right: 810, width: 800, height })
  let offset = 0, at = 0
  const frames = []
  Object.defineProperties(port, {
    clientTop: { value: 2 }, clientLeft: { value: 0 }, clientHeight: { value: 600 }, clientWidth: { value: 800 }, scrollHeight: { value: 6000 },
    scrollTop: { get: () => offset, set: value => { offset = value; port.dispatchEvent(new w.Event('scroll')) } },
  })
  port.getBoundingClientRect = () => rect(80, 604)
  w.document.querySelector('.center-workspace').getBoundingClientRect = () => rect(20, 700)
  w.document.querySelector('.session-context-header').getBoundingClientRect = () => rect(20, 60)
  w.document.querySelector('.editable-record').getBoundingClientRect = () => rect(82 - offset, 5900)
  w.document.querySelector('.rich-editor').textContent = `${'x'.repeat(100000)}PERF_RECORD_END`
  const recordHeader = w.document.querySelector(side === 'head' ? '.record-header' : '.record-actions')
  if (recordHeader) {
    recordHeader.style.position = position
    recordHeader.style.top = '0px'
    recordHeader.getBoundingClientRect = () => rect(82 + Math.max(180 - offset, gap) + (drifting ? offset / 10 : 0), 60)
  }
  w.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  let settled = false, result, error
  w.eval(`(${scrollRichRecord.toString()})(${JSON.stringify(side)})`).then(value => { result = value; settled = true }, reason => { error = reason; settled = true })
  try {
    for (let turn = 0; turn < 1000 && !settled; turn++) {
      const callback = frames.shift()
      if (callback) callback(at += 16)
      await Promise.resolve()
    }
    assert.equal(settled, true, 'Observer must finish within a bounded fake animation schedule')
    if (error) throw Error(error.message)
    return JSON.parse(JSON.stringify(result))
  } finally { dom.window.close() }
}

for (const [side, gap] of [['baseline', 32], ['head', 0]]) {
  test(`${side} records the literal ${gap}px record gap despite the aligned Session-header decoy`, async () => {
    const result = await scrollCase({ side, gap })
    assert.deepEqual([...new Set(result.headerGapsPx)], [gap])
    assert.equal(result.headerSelector, side === 'head' ? '.record-detail-pane .record-header' : '.record-detail-pane .record-actions')
    assert.equal(result.geometry.length, 121)
    assert.equal(result.geometry[0].scrollport.top, 82)
    assert.equal(result.geometry[0].header.top, 82 + gap)
    assert.ok(result.geometry.every(frame => frame.pinned && frame.scrollTopPx > 180 && frame.scrollTopPx < 5400))
    assert.ok(result.geometry.every(frame => frame.recordBottomPx > frame.header.bottom + 64))
    assert.ok(result.movedPx >= 1000)
    assert.ok(result.scrollEvents >= 10)
    assert.equal(result.frameIntervalsMs.length, 120)
  })
}

test('an aligned Session header cannot substitute for a missing record header', async () => {
  await assert.rejects(scrollCase({ side: 'head', gap: 0, missingRecordHeader: true }), /Record sticky header is missing/)
})

test('an unpinned header cannot supply pinned geometry samples', async () => {
  await assert.rejects(scrollCase({ side: 'head', gap: 0, position: 'static' }), /Record header must be sticky/)
  await assert.rejects(scrollCase({ side: 'head', gap: 0, drifting: true }), /Record header moved within the pinned scroll range/)
})

const refinement = { recordId: 'record-00', proposalId: 'proposal-00', beforeTitle: 'Receipt delayed', afterTitle: 'Receipt appears immediately',
  beforeBodyText: 'Complete checkout and inspect the missing receipt.', afterBodyText: 'Complete checkout and verify the order number and total.' }

function proposalDom() {
  const dom = new JSDOM(`<section class="chat-proposal" aria-label="Local refinement for Another record"><button>Review refinement</button></section>
    <section class="chat-proposal" aria-label="Local refinement for Receipt delayed"><p>Suggested local refinement. Not applied.</p>
    <button aria-expanded="false">Review refinement</button>
    <div class="chat-proposal-comparison" hidden>
      <section aria-label="Before refinement"><h3>Before</h3><p>Receipt delayed</p><div aria-label="Before refinement body">Complete checkout and inspect the missing receipt.</div></section>
      <section aria-label="After refinement"><h3>Suggested</h3><p>Receipt appears immediately</p><div aria-label="Suggested refinement body">Complete checkout and verify the order number and total.</div></section>
      <button>Apply to editor</button><button disabled>Undo refinement</button>
    </div></section>
    <section aria-label="Chat context">Receipt appears immediately. Saved record.</section>
    <div class="record-detail-pane"><input aria-label="Finding title" value="Receipt appears immediately"><div contenteditable="true">Complete checkout and verify the order number and total.</div><button>Save</button></div>`, { runScripts: 'outside-only' })
  const w = dom.window, frames = []
  w.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}] }
  w.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  w.__TAURI_INTERNALS__ = { invoke: async () => ({}) }
  w.eval(`(${installUiPerformanceObserver.toString()})()`)
  const card = w.document.querySelector('[aria-label="Local refinement for Receipt delayed"]')
  return { dom, w, card, frame: () => { const callback = frames.shift(); assert.ok(callback, 'A pending observation must request another frame'); callback() } }
}

test('review ignores another record and waits for the exact visible before/after bodies across two frames', () => {
  const { dom, w, card, frame } = proposalDom()
  try {
    w.__uiPerf.pending = { name: 'proposal-review', trigger: 'Review refinement', proposal: refinement }
    w.document.querySelector('button').click()
    assert.equal(w.__uiPerf.pending.startedAt, undefined, 'A different proposal cannot start this observation')
    card.querySelector('button').click()
    frame()
    assert.equal(w.__uiPerf.samples.length, 0, 'Collapsed content is not reviewed work')
    card.querySelector('.chat-proposal-comparison').hidden = false
    card.querySelector('[aria-label="Suggested refinement body"]').textContent = 'Wrong body'
    frame()
    assert.equal(w.__uiPerf.samples.length, 0)
    card.querySelector('[aria-label="Suggested refinement body"]').textContent = refinement.afterBodyText
    frame()
    assert.equal(w.__uiPerf.samples.length, 0, 'One ready frame is insufficient')
    frame()
    assert.equal(w.__uiPerf.samples[0].action, 'proposal-review')
    assert.equal(w.__uiPerf.samples[0].proof.recordId, 'record-00')
    assert.equal(w.__uiPerf.samples[0].proof.afterTitle, 'Receipt appears immediately')
    assert.equal(w.__uiPerf.failures.length, 0)
  } finally { dom.window.close() }
})

test('Apply requires the literal dirty editor, staged UI, and enabled Undo before accepting two frames', () => {
  const { dom, w, card, frame } = proposalDom()
  try {
    card.querySelector('.chat-proposal-comparison').hidden = false
    w.__uiPerf.pending = { name: 'proposal-apply', trigger: 'Apply to editor', proposal: refinement }
    const apply = [...card.querySelectorAll('button')].find(node => node.textContent === 'Apply to editor')
    apply.click()
    frame()
    assert.equal(w.__uiPerf.samples.length, 0, 'Editor text alone is not proof of Apply')
    card.querySelector('p').textContent = 'Suggested local refinement. Changes are applied to the local editor and not saved. Use the record Save control.'
    w.document.querySelector('[aria-label="Chat context"]').textContent = 'Receipt appears immediately. Unsaved edits included.'
    const undo = [...card.querySelectorAll('button')].find(node => node.textContent === 'Undo refinement')
    undo.disabled = false
    w.document.querySelector('[contenteditable]').textContent = 'Wrong body'
    frame()
    assert.equal(w.__uiPerf.samples.length, 0)
    w.document.querySelector('[contenteditable]').textContent = refinement.afterBodyText
    undo.disabled = true
    frame()
    assert.equal(w.__uiPerf.samples.length, 0, 'A pending stage must not complete the observation')
    undo.disabled = false
    frame()
    assert.equal(w.__uiPerf.samples.length, 0)
    frame()
    assert.equal(w.__uiPerf.samples[0].action, 'proposal-apply')
    assert.equal(w.__uiPerf.samples[0].proof.title, 'Receipt appears immediately')
    assert.equal(w.__uiPerf.samples[0].proof.bodyText, 'Complete checkout and verify the order number and total.')
    assert.equal(w.__uiPerf.samples[0].proof.dirty, true)
    assert.equal(w.__uiPerf.failures.length, 0)
  } finally { dom.window.close() }
})
