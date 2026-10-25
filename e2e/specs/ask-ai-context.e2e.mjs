import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, create, fill, fixture, native, out, save, tab } from './composer-proof.mjs'
import { resize } from './chat-handoff-proof.mjs'
import { openCreationAi } from './creation-helpers.mjs'
import { contextResponse } from '../fixtures/ask-ai-context-provider.mjs'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'

const composer = '.ask-ai-panel textarea'
const evidence = []
const title = 'Synthetic C1 checkout Session'
const findingTitle = 'Synthetic saved checkout finding'
const secondTitle = 'Synthetic second checkout finding'
const casesTitle = 'Synthetic saved checkout cases'
let session
let initialDraftId
let firstSnapshot

function count() { return readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length }
async function chat() { return native('get_chat', { sessionId: session.id }) }
async function settle() { await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done))) }
async function screenshot(name, details = {}) {
  const geometry = await browser.execute(() => {
    const rect = node => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
    }
    return { viewport: { width: innerWidth, height: innerHeight }, panel: rect(document.querySelector('.ask-ai-panel')),
      composer: rect(document.querySelector('.ask-ai-panel textarea')), document: rect(document.querySelector('.session-document-area')),
      context: document.querySelector('[aria-label="Chat context"]')?.textContent,
      outer: { scrollTop: document.scrollingElement.scrollTop, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } }
  })
  evidence.push({ name, geometry, ...details })
  writeFileSync(join(out, 'ask-ai-context.json'), JSON.stringify(evidence, null, 2))
  await browser.saveScreenshot(join(out, `${name}.png`))
  return geometry
}
async function select(recordTitle) {
  const list = await $('.record-master-list')
  const button = await list.$(`button*=${recordTitle}`)
  await button.waitForClickable()
  await button.click()
}
async function ask() {
  await click('button=Ask AI')
  await $(composer).waitForDisplayed()
  await browser.waitUntil(() => browser.execute(() => document.activeElement === document.querySelector('.ask-ai-panel textarea')))
}
async function pasteNativeImage() {
  await browser.execute(() => {
    const input = document.querySelector('.ask-ai-panel textarea')
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [], types: ['public.tiff'], getData: () => '' } })
    input.dispatchEvent(event)
  })
  await $('[aria-label="Attached images"] img').waitForDisplayed()
  await browser.waitUntil(async () => (await chat()).composerImages.length === 1)
}
async function start(text) {
  const index = count() + 1
  await fill(composer, text)
  await click('button=Send')
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  return { index, payload: JSON.parse(readFileSync(join(fixture, `codex-exec-${index}.chat.json`), 'utf8')) }
}
async function complete(turn) {
  writeFileSync(join(fixture, `codex-exec-${turn.index}.release`), 'Release synthetic C1 response\n', { flag: 'wx' })
  await browser.waitUntil(async () => (await chat()).messages.at(-1)?.role === 'assistant' && (await chat()).messages.every(message => message.status === 'completed'))
  await browser.waitUntil(async () => await $('button=Send').isExisting() && !(await $('button=Cancel response').isExisting()))
  assert.equal((await chat()).messages.at(-1).text, contextResponse)
}
async function generated(kind) {
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  await create(kind)
  await openCreationAi(kind)
  const index = count() + 1
  await click('dialog button=Generate')
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release synthetic record generation\n', { flag: 'wx' })
  await $('.creation-composer').waitForExist({ reverse: true })
  await $('.record-detail-pane .record-title').waitForDisplayed()
  return $('.record-detail-pane .record-title').getText()
}

describe('Ask AI with immutable record context in the built native application', () => {
  before(async () => {
    await click('button=New Session')
    await fill('[aria-label="Session title"]', title)
    await fill('[aria-label="Note body"]', 'Synthetic private Session Note. Never include this full note automatically.')
    await browser.waitUntil(async () => (await native('list_sessions')).some(item => item.title === title))
    session = (await native('list_sessions')).find(item => item.title === title)
    initialDraftId = (await chat()).draftId
    await tab('Findings')
    for (const recordTitle of [findingTitle, secondTitle]) {
      await create('finding')
      await fill('[aria-label="Finding title"]', recordTitle)
      await fill('[aria-label="Creation draft body"]', `Saved evidence for ${recordTitle}`)
      await save('finding')
    }
    await tab('Test cases')
    await create('testware')
    await fill('[aria-label="Test case title"]', casesTitle)
    await fill('[aria-label="Creation draft body"]', 'Synthetic saved test case body')
    await save('testware')
    await tab('Findings')
    await select(findingTitle)
  })

  it('opens the existing Session conversation for a saved manual finding with a focused composer', async () => {
    await ask()
    assert.equal((await chat()).draftId, initialDraftId)
    assert.match(await $('[aria-label="Chat context"]').getText(), /Saved record/)
    const turn = await start('Review the saved synthetic finding')
    const message = turn.payload.messages.at(-1)
    assert.equal(message.context.kind, 'finding')
    assert.equal(message.context.snapshot.title, findingTitle)
    assert.equal(message.context.snapshot.sessionId, session.id)
    assert.equal(message.context.snapshot.origin, 'saved')
    assert.ok(!JSON.stringify(turn.payload).includes('Synthetic private Session Note'))
    firstSnapshot = message.context
    await complete(turn)
    const value = await screenshot('lane-1-saved-finding')
    assert.ok(value.document.width >= 400, 'A desktop split must leave a readable document')
    assert.ok(value.composer.bottom <= value.viewport.height + 1)
  })

  it('captures unsaved rich content without saving and keeps the original context while switching targets', async () => {
    await click('[aria-label="Close AI chat"]')
    await click('button=Edit')
    await fill('.record-detail-pane [contenteditable="true"]', 'Unsaved synthetic evidence at Send')
    await ask()
    assert.match(await $('[aria-label="Chat context"]').getText(), /Unsaved edits included/)
    const turn = await start('Review my unsaved evidence')
    const original = turn.payload.messages.at(-1).context
    assert.equal(original.snapshot.origin, 'unsaved_editor')
    assert.ok(original.snapshot.documentJson.includes('Unsaved synthetic evidence at Send'))
    assert.ok(!(await native('list_findings', { sessionId: session.id })).find(record => record.id === original.snapshot.recordId).body.includes('Unsaved synthetic evidence at Send'))
    await click('[aria-label="Close AI chat"]')
    await click('button=Discard')
    await select(secondTitle)
    await ask()
    assert.match(await $('[aria-label="Chat context"]').getText(), /Synthetic second checkout finding/)
    assert.deepEqual((await chat()).messages.at(-1).context, original)
    await complete(turn)
    assert.deepEqual((await chat()).messages[0].context, firstSnapshot)
    await screenshot('lane-4-unsaved-and-lane-5-target-switch', { original })
  })

  it('reuses native clipboard images and retains input, images and scroll across close, expand and Notes', async () => {
    const dataUrl = `data:image/png;base64,${readFileSync(imageFixture.path).toString('base64')}`
    await native('copy_local_image_to_clipboard', { dataUrl })
    assert.ok(await native('read_chat_clipboard_image_data_url'), 'Read actual pixels from the operating-system clipboard')
    await fill(composer, 'Retain composer and image while switching panels')
    await pasteNativeImage()
    let image = (await chat()).composerImages[0]
    await browser.execute(() => { document.querySelector('.chat-scroll-region').scrollTop = 0 })
    await click('[aria-label="Expand AI chat"]')
    await click('[aria-label="Collapse AI chat"]')
    await click('[aria-label="Close AI chat"]')
    await ask()
    assert.equal(await $(composer).getValue(), 'Retain composer and image while switching panels')
    assert.deepEqual((await chat()).composerImages, [image])
    const recordTurn = await start('Synthetic record screenshot question')
    assert.equal(recordTurn.payload.messages.at(-1).context.kind, 'finding')
    assert.equal(recordTurn.payload.messages.at(-1).images.length, 1)
    await complete(recordTurn)
    await fill(composer, 'Retain composer and image while switching panels')
    await pasteNativeImage()
    image = (await chat()).composerImages[0]
    await tab('Note')
    await click('button=Chat')
    await $('[aria-label="Session title"]').waitForDisplayed()
    assert.match(await $('[aria-label="Chat context"]').getText(), /Session context/)
    assert.equal(await $(composer).getValue(), 'Retain composer and image while switching panels')
    const notes = await screenshot('lane-6-native-clipboard-and-lane-10-notes')
    assert.ok(notes.composer.bottom <= notes.viewport.height + 1, 'Notes chat must keep its composer in view')
    assert.equal(notes.outer.scrollTop, 0, 'Notes chat must not scroll the outer page')
    await click(`[aria-label="Remove ${image.filename}"]`)
    await browser.waitUntil(async () => !(await chat()).composerImages.length)
    assert.equal(await $(composer).getValue(), 'Retain composer and image while switching panels')
    await pasteNativeImage()
    const turn = await start('Synthetic screenshot question')
    assert.equal(turn.payload.messages.at(-1).images.length, 1)
    assert.deepEqual(turn.payload.messages.at(-1).context, { kind: 'session' })
    await complete(turn)
  })

  it('labels Notes as Session context and detaches records for future sends only', async () => {
    const noteTurn = await start('A Session-only question')
    assert.deepEqual(noteTurn.payload.messages.at(-1).context, { kind: 'session' })
    await complete(noteTurn)
    await tab('Findings')
    await ask()
    await click('[aria-label="Detach record context"]')
    const turn = await start('A detached Session question')
    assert.deepEqual(turn.payload.messages.at(-1).context, { kind: 'session' })
    assert.deepEqual(turn.payload.messages[0].context, firstSnapshot)
    await complete(turn)
  })

  it('uses the same context contract for saved manual and generated Test cases and generated findings', async () => {
    await click('[aria-label="Close AI chat"]')
    await tab('Test cases')
    await select(casesTitle)
    await ask()
    let turn = await start('Review synthetic manual test cases')
    assert.equal(turn.payload.messages.at(-1).context.kind, 'test_cases_draft')
    assert.equal(turn.payload.messages.at(-1).context.snapshot.recordKind, 'testware')
    assert.ok(turn.payload.messages.at(-1).context.snapshot.documentJson.includes('Synthetic saved test case body'))
    await complete(turn)
    await click('[aria-label="Close AI chat"]')
    for (const kind of ['finding', 'testware']) {
      const generatedTitle = await generated(kind)
      await ask()
      turn = await start(`Review generated ${kind}`)
      assert.equal(turn.payload.messages.at(-1).context.snapshot.title, generatedTitle)
      await complete(turn)
      await screenshot(`lane-${kind === 'finding' ? '2-generated-finding' : '3-generated-test-cases'}`)
      await click('[aria-label="Close AI chat"]')
    }
  })

  it('uses full content for a narrow workspace and preserves the composer on WebView reload', async () => {
    await ask()
    await fill(composer, 'Unsent text survives a WebView reload')
    await browser.waitUntil(async () => (await chat()).composer === 'Unsent text survives a WebView reload')
    for (const width of [1280, 1100, 768]) {
      await resize(width, 700)
      await settle()
      const value = await screenshot(`lane-8-${width}-by-700`)
      assert.ok(value.composer.right <= value.viewport.width + 1 && value.composer.bottom <= value.viewport.height + 1)
      assert.ok(value.outer.width <= value.viewport.width + 1)
      assert.equal(value.outer.scrollTop, 0)
      const actions = await browser.execute(() => {
        const panel = document.querySelector('.ask-ai-panel').getBoundingClientRect()
        return [...document.querySelectorAll('.ask-ai-panel .chat-compose-actions button')].map(button => {
          const bounds = button.getBoundingClientRect()
          return { label: button.textContent.trim() || button.getAttribute('aria-label'), left: bounds.left, right: bounds.right,
            minimum: Math.max(0, panel.left), maximum: Math.min(innerWidth, panel.right) }
        })
      })
      for (const action of actions) assert.ok(action.left >= action.minimum - 1 && action.right <= action.maximum + 1,
        `${width}px chat action must fit its panel: ${JSON.stringify(action)}`)
      if (width === 768) assert.equal(value.document.width, 0, 'Narrow chat must occupy the full available content')
    }
    await resize(1280, 800)
    const before = await chat()
    await browser.refresh()
    await $(`[role="option"]*=${title}`).waitForClickable()
    await click(`[role="option"]*=${title}`)
    await tab('Note')
    await click('button=Chat')
    assert.equal(await $(composer).getValue(), 'Unsent text survives a WebView reload')
    assert.deepEqual((await chat()).messages, before.messages)
    assert.equal((await chat()).draftId, initialDraftId)
    await screenshot('lane-9-persisted-context-webview-reload')
    await fill(composer, '')
  })
  it('retains input when the selected provider rejects replayed chat images', async () => {
    await click('button=Settings')
    const select = await $('[aria-label="Default AI provider"]')
    await select.waitForEnabled()
    await browser.execute(() => {
      const select = document.querySelector('[aria-label="Default AI provider"]')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'copilot_cli')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('button=Save settings')
    await browser.waitUntil(async () => (await native('get_settings')).selectedAiProvider === 'copilot_cli')
    await click('button=Back')
    await $(composer).waitForDisplayed()
    const before = await chat()
    const invocations = count()
    await fill(composer, 'Keep this question after unsupported images')
    await click('button=Send')
    await browser.waitUntil(async () => (await $('.ask-ai-panel').getText()).includes('Copilot Chat does not support image attachments yet'))
    assert.equal(await $(composer).getValue(), 'Keep this question after unsupported images')
    assert.deepEqual((await chat()).messages, before.messages)
    assert.equal(count(), invocations)
    await screenshot('lane-7-unsupported-provider-retained-input')
  })

})
