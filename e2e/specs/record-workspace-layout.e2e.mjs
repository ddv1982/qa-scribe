import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, create, fill, fixture, fixtureStarted, native, save, tab } from './composer-proof.mjs'
import { resize } from './chat-handoff-proof.mjs'
import { openCreationAi } from './creation-helpers.mjs'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'Run through the isolated built-app E2E workflow')
const evidence = []
const findingTitle = 'Synthetic long checkout finding'
const testwareTitle = 'Synthetic long checkout test cases'
const longBody = Array.from({ length: 80 }, (_, index) => `Evidence ${index + 1}. Synthetic checkout validation remains readable while the record header stays visible.`).join('\n')
let session

async function settle() {
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

async function scroll(top) {
  await browser.execute(top => { document.querySelector('.collection-view').scrollTop = top }, top)
  await settle()
}

async function selectRecord(title) {
  await scroll(0)
  const list = await $('.record-master-list')
  const record = await list.$('button*=' + title)
  await record.waitForClickable()
  await record.click()
}

async function activateVisibleAction(label) {
  await browser.execute(label => {
    const button = Array.from(document.querySelectorAll('.record-detail-pane .record-actions button'))
      .find(node => (node.getAttribute('aria-label') ?? node.textContent.trim()) === label)
    if (!button || button.disabled) throw new Error(`Record action unavailable: ${label}`)
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (!button.contains(hit)) throw new Error(`Record action obscured: ${label}`)
    button.focus({ preventScroll: true })
    button.click()
  }, label)
  await settle()
}

async function capture(name) {
  const geometry = await browser.execute(() => {
    const rect = node => {
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
    }
    const scroller = document.querySelector('.collection-view')
    const record = document.querySelector('.record-detail-pane .editable-record')
    const header = record.querySelector('.record-header') ?? record.querySelector('.record-actions')
    const title = record.querySelector('.record-title, input[aria-label$="title"]')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.documentElement.dataset.theme,
      scroller: { ...rect(scroller), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, paddingTop: getComputedStyle(scroller).paddingTop },
      tabs: rect(document.querySelector('.session-workspace-tabs')),
      header: { ...rect(header), background: getComputedStyle(header).backgroundColor },
      title: { ...rect(title), text: title.value ?? title.textContent },
      metadata: Array.from(record.querySelectorAll('.finding-meta-row, .testware-metadata-badges'), node => ({ ...rect(node), text: node.textContent })),
      heading: rect(document.querySelector('.collection-header')),
      search: rect(document.querySelector('.collection-search')),
      body: rect(record.querySelector('.rich-record-editor-field')),
      actions: Array.from(record.querySelectorAll('.record-actions button'), node => ({ ...rect(node), label: node.getAttribute('aria-label') ?? node.textContent.trim(), focused: node === document.activeElement })),
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scrollTop: document.scrollingElement.scrollTop },
    }
  })
  evidence.push({ name, ...geometry })
  writeFileSync(join(artifacts, 'record-workspace-layout.json'), JSON.stringify(evidence, null, 2))
  await browser.saveScreenshot(join(artifacts, `${name}.png`))
  console.log(`record-workspace-layout ${name} ${JSON.stringify(geometry)}`)
  return geometry
}

function assertPinned(value) {
  assert.ok(value.scroller.scrollTop > 200, 'Long record must actually scroll')
  const gap = value.header.top - value.scroller.top
  assert.ok(Math.abs(gap) <= 1, `Pinned record header gap must be within 1 CSS pixel; observed ${gap}px`)
  assert.ok(Math.abs(value.header.top - value.tabs.bottom) <= 1, 'Pinned header must meet the Session tabs')
  assert.ok(value.title.top >= value.header.top && value.title.bottom <= value.header.bottom, 'Record title must remain inside the pinned header')
  for (const meta of value.metadata) assert.ok(meta.top >= value.header.top && meta.bottom <= value.header.bottom, 'Record metadata must remain inside the pinned header')
  for (const action of value.actions) {
    assert.ok(action.top >= value.header.top && action.bottom <= value.header.bottom + 1, `${action.label} must remain inside the pinned header`)
    assert.ok(action.left >= 0 && action.right <= value.viewport.width + 1, `${action.label} must fit horizontally`)
  }
  assert.ok(value.header.bottom < value.scroller.bottom - 100, 'Header must leave room to read the document')
  assert.ok(value.page.width <= value.viewport.width + 1, 'No horizontal page overflow')
  assert.equal(value.page.scrollTop, 0, 'Document scrolling must not scroll the outer page')
}

describe('Record workspace layout in the built native application', () => {
  before(async () => {
    await click('button=New Session')
    await fill('[aria-label="Session title"]', 'Record workspace native proof')
    await fill('[aria-label="Note body"]', 'Synthetic checkout source for record layout verification.')
    await browser.waitUntil(async () => (await native('list_sessions')).some(session => session.title === 'Record workspace native proof'))
    session = (await native('list_sessions')).find(session => session.title === 'Record workspace native proof')
    await tab('Findings')
    await create('finding')
    await fill('[aria-label="Finding title"]', findingTitle)
    await fill('[aria-label="Creation draft body"]', longBody)
    await save('finding')
    await $('.record-detail-pane .record-title').waitForDisplayed()
  })

  it('pins the long manual finding header against the unpadded scroller and Session tabs', async () => {
    await scroll(0)
    await capture('lane-1-top')
    await scroll(650)
    assertPinned(await capture('lane-1-scrolled'))
  })

  it('pins manually saved test cases with the same scroll behavior', async () => {
    await tab('Test cases')
    await create('testware')
    await fill('[aria-label="Test case title"]', testwareTitle)
    await fill('[aria-label="Creation draft body"]', longBody)
    await save('testware')
    await scroll(650)
    assertPinned(await capture('lane-2-scrolled'))
  })

  it('retains alignment on saved generated findings and test cases after lengthening their bodies', async () => {
    for (const [index, kind] of ['finding', 'testware'].entries()) {
      await tab(kind === 'finding' ? 'Findings' : 'Test cases')
      await create(kind)
      await openCreationAi(kind)
      await click('dialog button=Generate')
      await fixtureStarted(index + 1)
      writeFileSync(join(fixture, `codex-exec-${index + 1}.release`), 'Release synthetic layout fixture\n')
      await $('.creation-composer').waitForExist({ reverse: true })
      await $('.record-detail-pane .record-title').waitForDisplayed()
      const title = await $('.record-detail-pane .record-title').getText()
      assert.equal(title, kind === 'finding' ? 'E2E finding' : 'Record workspace native proof Test Cases')
      const generated = (await native(kind === 'finding' ? 'list_findings' : 'list_drafts', { sessionId: session.id })).find(record => record.title === title)
      assert.ok(generated.body.includes(kind === 'finding' ? 'Deterministic provider output.' : 'Deterministic generated case'))
      await click('button=Edit')
      await fill('.record-detail-pane [contenteditable="true"]', longBody)
      await click('button=Save')
      await $('.record-detail-pane .record-title').waitForDisplayed()
      await scroll(650)
      assertPinned(await capture(`lane-3-generated-${kind}`))
    }
  })

  it('restores ordinary heading, search and record spacing at the top', async () => {
    await scroll(0)
    const value = await capture('lane-4-returned-to-top')
    assert.equal(value.scroller.scrollTop, 0)
    assert.ok(value.search.top > value.heading.bottom, 'Search must remain below the collection heading')
    assert.ok(value.header.top > value.search.bottom, 'Record header must remain below search at the top')
    assert.ok(value.body.top > value.header.bottom, 'Document must remain separated from the header')
  })

  it('keeps actions and document scrolling usable in short and narrow native windows', async () => {
    try {
      for (const width of [1280, 768]) {
        const viewport = await resize(width, 700)
        assert.ok(Math.abs(viewport.width - width) <= 2 && Math.abs(viewport.height - 700) <= 2)
        await scroll(650)
        assertPinned(await capture(`lane-5-${width}-by-700`))
      }
    } finally {
      await resize(1280, 800)
    }
  })

  for (const [index, theme] of ['light', 'dark'].entries()) {
    it(`uses an opaque ${theme} header while text scrolls behind it`, async () => {
      await click('button=Settings')
      await click(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await click('button=Back')
      await $('.record-detail-pane .record-title').waitForDisplayed()
      await scroll(650)
      const value = await capture(`lane-${index + 6}-${theme}`)
      assertPinned(value)
      assert.equal(value.theme, theme)
      assert.match(value.header.background, /^rgb\(/, 'Sticky header must have an opaque background')
    })
  }

  it('keeps each focused record action visible without changing document scroll', async () => {
    await scroll(650)
    const buttons = await $$('.record-detail-pane .record-actions button')
    for (let index = 0; index < buttons.length; index++) {
      await browser.execute(index => document.querySelectorAll('.record-detail-pane .record-actions button')[index].focus({ preventScroll: true }), index)
      const value = await capture(`lane-8-focused-action-${index + 1}`)
      assertPinned(value)
      assert.equal(value.scroller.scrollTop, 650)
      assert.equal(value.actions[index].focused, true)
    }
  })

  it('keeps Copy, Edit and Save usable at the scrolled position and persists the edited title', async () => {
    await tab('Findings')
    await selectRecord(findingTitle)
    await scroll(650)
    await activateVisibleAction(`Copy ${findingTitle}`)
    await $(`[aria-label="${findingTitle} copied"]`).waitForDisplayed()
    const clipboard = readClipboardText()
    assert.ok(clipboard.plain.includes('Evidence 80. Synthetic checkout validation'))
    await activateVisibleAction('Edit')
    const editing = await capture('lane-9-editing-scrolled')
    assertPinned(editing)
    assert.equal(editing.scroller.scrollTop, 650)
    await fill('[aria-label="Finding title"]', findingTitle + ' reviewed')
    await capture('lane-9-title-edited')
    await activateVisibleAction('Save')
    await $('.record-detail-pane .record-title').waitForDisplayed()
    const saved = (await native('list_findings', { sessionId: session.id })).find(record => record.title === findingTitle + ' reviewed')
    assert.ok(saved?.body.includes('Evidence 80. Synthetic checkout validation'))
    const value = await capture('lane-9-saved-scrolled')
    assertPinned(value)
    assert.equal(value.scroller.scrollTop, 650)
  })

  it('switches records and returns to the original Note without an outer scrollbar', async () => {
    await selectRecord('E2E finding')
    assert.equal(await $('.record-detail-pane .record-title').getText(), 'E2E finding')
    await scroll(650)
    assertPinned(await capture('lane-10-other-record'))
    await tab('Note')
    assert.equal(await $('[aria-label="Session title"]').getValue(), 'Record workspace native proof')
    assert.equal(await $('[aria-label="Note body"]').getText(), 'Synthetic checkout source for record layout verification.')
    const note = await browser.execute(() => ({
      pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight,
      workspaceHeight: document.querySelector('.session-workspace').clientHeight,
      documentHeight: document.querySelector('.document-body').clientHeight,
    }))
    assert.ok(note.pageHeight <= note.viewportHeight + 1, 'Note must not introduce an outer scrollbar')
    assert.ok(note.documentHeight > 200, 'Note editor must remain usable')
    writeFileSync(join(artifacts, 'note-layout.json'), JSON.stringify(note, null, 2))
    await browser.saveScreenshot(join(artifacts, 'lane-10-note.png'))
  })
})
