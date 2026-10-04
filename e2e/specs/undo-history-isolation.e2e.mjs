import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

// No view toggles, editor commands, store mocks, or native writes are used here.
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the evidence directory')
mkdirSync(artifacts, { recursive: true })
const noteSelector = '[aria-label="Note body"][contenteditable="true"]'
let diagnosticStage = 'startup'
let owned = []
let evidence = []
let caseName = ''

function checkpoint(stage, details = {}) {
  diagnosticStage = stage
  evidence.push({ stage, ...details })
  console.log(JSON.stringify({ case: caseName, stage, ...details }))
}

const paragraph = (text) => ({
  body: text ? `<p>${text}</p>` : '',
  json: { schemaVersion: 1, doc: { type: 'doc', content: text
    ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] } },
})

async function nativeState(id) {
  return browser.tauri.execute(async ({ core }, sessionId) =>
    core.invoke('open_session_note_state', { id: sessionId }), id)
}

function storedValue(state) {
  assert.ok(state.session.id, 'Native Session ID is required')
  assert.ok(state.noteEntry.id, 'Native Note Entry ID is required')
  assert.equal(state.noteEntry.sessionId, state.session.id)
  assert.equal(state.noteEntry.bodyFormat, 'tiptap_json')
  const json = JSON.parse(state.noteEntry.bodyJson)
  assert.equal(json.schemaVersion, 1)
  assert.equal(json.doc.type, 'doc')
  return { body: state.noteEntry.body, json }
}

function assertStored(state, fixture, expected) {
  assert.equal(state.session.id, fixture.id)
  assert.equal(state.session.title, fixture.title)
  assert.equal(state.noteEntry.id, fixture.entryId)
  assert.deepEqual(storedValue(state), expected)
}

async function persisted(fixture, expected) {
  checkpoint(`native body: ${fixture.title}`)
  let state
  await browser.waitUntil(async () => {
    state = await nativeState(fixture.id)
    const value = storedValue(state)
    return state.session.title === fixture.title && value.body === expected.body
      && isDeepStrictEqual(value.json, expected.json)
  }, { timeout: 6_000, interval: 100, timeoutMsg: `Native body did not settle for ${fixture.title}` })
  assertStored(state, fixture, expected)
  return state
}

async function domValue() {
  return browser.execute(() => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    return editor ? { text: editor.textContent, html: editor.innerHTML,
      images: editor.querySelectorAll('img').length, links: editor.querySelectorAll('a').length,
      currentSessionTitle: document.querySelector('[aria-label="Session title"]')?.value } : null
  })
}

async function baseline(text) {
  let value
  await browser.waitUntil(async () => {
    value = await domValue()
    return value !== null && value.text === text && value.images === 0 && value.links === 0
  }, { timeout: 5_000, interval: 50, timeoutMsg: `Editable Note baseline not reached: ${text}` })
  assert.equal(value.text, text)
  assert.equal(value.images, 0)
  assert.equal(value.links, 0)
  return value
}

// Runs inside the actual WebView. Selection is verified before native DOM editing.
// Optional navigation stays in one awaited WebView invocation, but yields until
// the actual editor change is registered in React, before the 850ms debounce.
async function editDom(text, targetTitle) {
  const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
  if (!editor) throw new Error('Actual editable Note is missing')
  editor.focus()
  const p = editor.querySelector('p')
  if (!p && (editor.textContent !== '' || editor.querySelector('img'))) {
    throw new Error('Paragraph-free Note is not an empty editable root')
  }
  // Canonical emptyDoc content: [] can render without any paragraph child.
  const target = p ?? editor
  const range = document.createRange()
  range.selectNodeContents(target)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  const selected = selection.toString()
  if (selected !== target.textContent || !target.contains(selection.anchorNode) || !target.contains(selection.focusNode)) {
    throw new Error('Replacement selection is not inside the real editing target')
  }
  const start = performance.now()
  const inserted = document.execCommand('insertText', false, text)
  const actual = editor.textContent
  let preNavigationStatus = document.querySelector('.document-status')?.textContent?.trim()
  let elapsedMs = performance.now() - start
  if (targetTitle) {
    // MutationObserver and React must commit the edit before the navigation handler
    // reads state. A DOM mutation alone is not a pending Note change.
    do {
      await new Promise((resolve) => setTimeout(resolve, 20))
      preNavigationStatus = document.querySelector('.document-status')?.textContent?.trim()
      elapsedMs = performance.now() - start
      if (elapsedMs >= 850) {
        throw new Error(`Pending edit missed debounce window (${elapsedMs}ms; status: ${preNavigationStatus})`)
      }
    } while (preNavigationStatus !== 'Unsaved changes')
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((node) => node.textContent.includes(targetTitle))
    if (!option) throw new Error(`Session option missing: ${targetTitle}`)
    elapsedMs = performance.now() - start
    if (elapsedMs >= 850) throw new Error(`Session click missed debounce window: ${elapsedMs}ms`)
    option.click()
  }
  return { inserted, selected, actual, elapsedMs, preNavigationStatus }
}

async function edit(text) {
  const result = await browser.execute(editDom, text, null)
  assert.equal(result.inserted, true, 'WebView insertText must succeed')
  assert.equal(result.actual, text)
  await baseline(text)
}

async function create(label, text = '') {
  const noteTab = await $('[role="tab"]*=Note')
  if (await noteTab.isExisting()) await noteTab.click()
  const newSession = await $('button=New Session')
  await newSession.waitForClickable()
  const previousTitle = await browser.execute(() =>
    document.querySelector('[aria-label="Session title"]')?.value ?? null)
  await newSession.click()
  await browser.waitUntil(async () => {
    const value = await domValue()
    return value !== null && /^Untitled session \d+$/.test(value.currentSessionTitle ?? '')
      && value.currentSessionTitle !== previousTitle && value.text === ''
      && value.images === 0 && value.links === 0
  }, { timeout: 6_000, interval: 50, timeoutMsg: 'New Session identity and editable blank Note did not mount' })
  await (await $('button=New Session')).waitForClickable()
  await baseline('')
  const title = `Undo isolation ${caseName} ${label}`
  await (await $('[aria-label="Session title"]')).setValue(title)
  let sessions
  await browser.waitUntil(async () => {
    sessions = await browser.tauri.execute(async ({ core }) => core.invoke('list_sessions'))
    return sessions.filter((session) => session.title === title).length === 1
  }, { timeout: 6_000, interval: 100, timeoutMsg: `Session title not persisted: ${title}` })
  const session = sessions.find((candidate) => candidate.title === title)
  const state = await nativeState(session.id)
  const fixture = { title, id: session.id, entryId: state.noteEntry.id }
  owned.push(fixture)
  assertStored(state, fixture, paragraph(''))
  if (text) await edit(text)
  await persisted(fixture, paragraph(text))
  return fixture
}

async function open(fixture, text) {
  checkpoint(`switch to ${fixture.title}`)
  const option = await $(`[role="option"]*=${fixture.title}`)
  await option.waitForClickable()
  await option.click()
  await browser.waitUntil(async () =>
    (await (await $('[aria-label="Session title"]')).getValue()) === fixture.title,
  { timeout: 5_000, timeoutMsg: `Session UI did not open ${fixture.title}` })
  // Never toggle Testware or Note here: the switch itself must isolate history.
  if (text !== undefined) await baseline(text)
}

async function shortcut(redo = false) {
  return browser.execute((shift) => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    if (!editor) throw new Error('Shortcut target is not an editable Note')
    editor.focus()
    const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true,
      shiftKey: shift, bubbles: true, cancelable: true })
    editor.dispatchEvent(event)
    return event.defaultPrevented
  }, redo)
}

async function isolated(fixture, text, expected = paragraph(text)) {
  await baseline(text)
  await preservedShortcuts(fixture, expected)
}

async function preservedShortcuts(fixture, expected) {
  await browser.execute(() => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    if (!editor) throw new Error('History baseline requires an actual editable Note')
    editor.focus()
    const paragraph = editor.querySelector('p')
    if (!paragraph) return // Empty roots retain the semantic blank contract.
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await browser.pause(100) // Commit caret selection before comparing exact DOM HTML.
  const before = await domValue()
  assert.ok(before, 'History isolation requires a real editable baseline')
  const comparable = (value) => {
    assert.ok(value, 'Shortcut must retain an actual editable Note')
    if (expected.body !== '') return value
    const { text, images, links, currentSessionTitle } = value
    return { text, images, links, currentSessionTitle }
  }
  assertStored(await nativeState(fixture.id), fixture, expected)
  for (const redo of [false, true]) {
    checkpoint(`${redo ? 'redo' : 'undo'} must not cross Session boundary`, { id: fixture.id })
    const handled = await shortcut(redo)
    // Fresh-history no-ops need not preventDefault. The content is the assertion.
    const after = await domValue()
    assert.deepEqual(comparable(after), comparable(before), 'Session switch must not expose outgoing undo/redo history')
    checkpoint('isolated shortcut content unchanged', { redo, handled })
    await browser.pause(1_100)
    assert.deepEqual(comparable(await domValue()), comparable(before), 'Content must remain unchanged after debounce')
    assertStored(await nativeState(fixture.id), fixture, expected)
  }
}

async function reopenPair(a, aText, b, bText, aExpected = paragraph(aText), bExpected = paragraph(bText)) {
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.entryId, b.entryId)
  await persisted(a, aExpected)
  await persisted(b, bExpected)
  await open(b, bText)
  assertStored(await nativeState(b.id), b, bExpected)
  await open(a, aText)
  assertStored(await nativeState(a.id), a, aExpected)
}

async function selectText(text) {
  assert.equal(await browser.execute((expected) => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    editor.focus()
    const p = editor.querySelector('p')
    const range = document.createRange()
    range.selectNodeContents(p)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return selection.toString() === expected && p.contains(selection.anchorNode) && p.contains(selection.focusNode)
  }, text), true, 'Real DOM selection must cover the intended text')
  // Let ProseMirror observe selectionchange before clicking the toolbar.
  await browser.pause(100)
}

function test(label, run) {
  it(label, async function () {
    this.timeout(60_000)
    caseName = label.split(':')[0]
    owned = []
    evidence = []
    checkpoint('fixture creation')
    try {
      await run()
      checkpoint('case complete')
    } catch (error) {
      // Do not hide timeouts or native failures. Preserve diagnostic read failures too.
      const failureStage = diagnosticStage
      let native, ui
      try { native = await Promise.all(owned.map((fixture) => nativeState(fixture.id))) }
      catch (readError) { native = { readFailure: String(readError) } }
      try { ui = await domValue() } catch (readError) { ui = { readFailure: String(readError) } }
      writeFileSync(join(artifacts, `${caseName}-failure.json`), JSON.stringify({
        caseName, diagnosticStage: failureStage, error: String(error), owned, native, ui, evidence,
      }, null, 2))
      console.log(JSON.stringify({ case: caseName, diagnosticStage: failureStage,
        failureEvidence: join(artifacts, `${caseName}-failure.json`) }))
      throw error
    }
    writeFileSync(join(artifacts, `${caseName}-evidence.json`), JSON.stringify({ owned, evidence }, null, 2))
  })
}

describe('Built application Session-local Note undo history', () => {
  test('same-note: undo and redo survive autosave and a title update', async () => {
    const a = await create('A', 'Same note baseline')
    await edit('Same note revision')
    await persisted(a, paragraph('Same note revision'))
    a.title += ' renamed'
    await (await $('[aria-label="Session title"]')).setValue(a.title)
    await persisted(a, paragraph('Same note revision'))
    await baseline('Same note revision')
    checkpoint('same-note undo after autosave/title update')
    assert.equal(await shortcut(), true, 'Same-note undo must be handled')
    await baseline('Same note baseline')
    await persisted(a, paragraph('Same note baseline'))
    checkpoint('same-note redo after autosave')
    assert.equal(await shortcut(true), true, 'Same-note redo must be handled')
    await baseline('Same note revision')
    await persisted(a, paragraph('Same note revision'))
  })

  test('distinct-notes: outgoing redo branch cannot mutate either Session', async () => {
    const a = await create('A', 'Distinct A retained')
    const b = await create('B', 'Distinct B baseline')
    await edit('Distinct B redo sentinel')
    await persisted(b, paragraph('Distinct B redo sentinel'))
    assert.equal(await shortcut(), true, 'Outgoing B must have a real redo branch')
    await baseline('Distinct B baseline')
    await persisted(b, paragraph('Distinct B baseline'))
    await open(a, 'Distinct A retained')
    await isolated(a, 'Distinct A retained')
    await open(b, 'Distinct B baseline')
    await isolated(b, 'Distinct B baseline')
    await reopenPair(a, 'Distinct A retained', b, 'Distinct B baseline')
  })

  test('equal-notes: equal final content does not preserve different intermediate histories', async () => {
    const a = await create('A', 'Old A sentinel')
    await edit('Equal final content')
    await persisted(a, paragraph('Equal final content'))
    const b = await create('B', 'Old B sentinel')
    await edit('Equal final content')
    await persisted(b, paragraph('Equal final content'))
    await open(a, 'Equal final content')
    await isolated(a, 'Equal final content')
    await open(b, 'Equal final content')
    await isolated(b, 'Equal final content')
    await reopenPair(a, 'Equal final content', b, 'Equal final content')
  })

  test('blank-note: New Session cannot undo into the edited previous Note', async () => {
    const a = await create('A', 'Blank source baseline')
    await edit('Blank source edited sentinel')
    await persisted(a, paragraph('Blank source edited sentinel'))
    const b = await create('B')
    // DOM empty paragraphs/placeholder breaks are allowed; storage is canonical emptyDoc.
    await isolated(b, '')
    await reopenPair(a, 'Blank source edited sentinel', b, '')
  })

  test('pending-flush: navigation before debounce saves outgoing A only', async () => {
    const a = await create('A', 'Pending A old body')
    const b = await create('B', 'Pending B unchanged')
    await open(a, 'Pending A old body')
    assertStored(await nativeState(a.id), a, paragraph('Pending A old body'))
    checkpoint('pre-debounce registered edit and Session click in one awaited WebView invocation')
    const timing = await browser.execute(editDom, 'Pending A flushed revision', b.title)
    checkpoint('pending edit timing', timing)
    assert.equal(timing.inserted, true)
    assert.equal(timing.actual, 'Pending A flushed revision')
    assert.equal(timing.preNavigationStatus, 'Unsaved changes', 'Navigation must follow a registered pending Note edit')
    assert.ok(timing.elapsedMs < 850, `Navigation missed debounce window: ${timing.elapsedMs}ms`)
    await baseline('Pending B unchanged')
    await persisted(a, paragraph('Pending A flushed revision'))
    await isolated(b, 'Pending B unchanged')
    await reopenPair(a, 'Pending A flushed revision', b, 'Pending B unchanged')
  })

  test('toolbar-image: link UI is isolated and managed PNG survives switching', async () => {
    const a = await create('A', 'Toolbar A retained')
    const b = await create('B', 'Toolbar B linked')
    await open(a, 'Toolbar A retained')
    await selectText('Toolbar A retained')
    await (await $('[aria-label="Formatting toolbar"] button[aria-label="Link"]')).click()
    await (await $('[aria-label="Link URL"]')).setValue('javascript:foreignSentinel')
    await (await $('[aria-label="Apply link"]')).click()
    assert.equal(await (await $('[aria-label="Link URL"]')).getAttribute('aria-invalid'), 'true')
    await open(b, 'Toolbar B linked')
    checkpoint('outgoing invalid link panel must be gone')
    assert.equal(await (await $('[aria-label="Link URL"]')).isExisting(), false)
    await selectText('Toolbar B linked')
    await (await $('[aria-label="Formatting toolbar"] button[aria-label="Link"]')).click()
    await (await $('[aria-label="Link URL"]')).setValue('https://example.com/undo-isolation')
    await (await $('[aria-label="Apply link"]')).click()
    const linkExpected = {
      body: '<p><a href="https://example.com/undo-isolation" target="_blank" rel="noreferrer">Toolbar B linked</a></p>',
      json: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{
        type: 'text', text: 'Toolbar B linked', marks: [{ type: 'link', attrs: {
          href: 'https://example.com/undo-isolation', target: '_blank', rel: 'noreferrer', class: null, title: null,
        } }],
      }] }] } },
    }
    await persisted(b, linkExpected)
    assert.equal(await (await $(`${noteSelector} a`)).getAttribute('href'), 'https://example.com/undo-isolation')
    assertStored(await nativeState(a.id), a, paragraph('Toolbar A retained'))
    await open(a, 'Toolbar A retained')
    await browser.execute(() => {
      const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
      editor.focus()
      const range = document.createRange()
      range.selectNodeContents(editor.querySelector('p'))
      range.collapse(false)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = '#12ab34'
      context.fillRect(0, 0, 1, 1)
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (char) => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'isolation-pixel.png', { type: 'image/png' }))
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    })
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelectorAll('[aria-label="Note body"] img[data-attachment-id]').length === 1),
    { timeout: 6_000, timeoutMsg: 'Real PNG paste did not create a managed image' })
    const attachmentId = await (await $(`${noteSelector} img`)).getAttribute('data-attachment-id')
    assert.ok(attachmentId, 'Real paste must expose a managed attachment ID')
    let imageExpected
    await browser.waitUntil(async () => {
      imageExpected = storedValue(await nativeState(a.id))
      return imageExpected.body.includes(attachmentId)
        && JSON.stringify(imageExpected.json).includes(attachmentId)
    }, { timeout: 6_000, interval: 100, timeoutMsg: 'Managed image did not persist through native storage' })
    const images = []
    const texts = []
    const walk = (node) => {
      if (node.type === 'image') images.push(node)
      if (node.type === 'text') texts.push(node.text)
      node.content?.forEach(walk)
    }
    walk(imageExpected.json.doc)
    assert.equal(texts.join(''), 'Toolbar A retained')
    assert.equal(images.length, 1)
    assert.equal(images[0].attrs.attachmentId, attachmentId)
    assert.equal(images[0].attrs.src, `qa-scribe-attachment://${attachmentId}`)
    assert.equal(images[0].attrs.alt, 'isolation-pixel.png')
    assert.deepEqual(await browser.execute((html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html').body
      const image = parsed.querySelector('img')
      return { text: parsed.textContent, count: parsed.querySelectorAll('img').length,
        attachmentId: image?.getAttribute('data-attachment-id'), src: image?.getAttribute('src'),
        alt: image?.getAttribute('alt') }
    }, imageExpected.body), { text: 'Toolbar A retained', count: 1, attachmentId,
      src: `qa-scribe-attachment://${attachmentId}`, alt: 'isolation-pixel.png' })
    assert.ok(!imageExpected.body.includes('data:image/'), 'Storage must retain managed references, not preview data URLs')
    checkpoint('managed PNG persisted', { id: a.id, entryId: a.entryId, attachmentId })
    await open(b)
    await browser.waitUntil(async () => {
      const value = await domValue()
      return value?.text === 'Toolbar B linked' && value.links === 1 && value.images === 0
    }, { timeout: 5_000, timeoutMsg: 'Reopened B link baseline did not render' })
    await preservedShortcuts(b, linkExpected)
    assertStored(await nativeState(b.id), b, linkExpected)
    await open(a)
    assertStored(await nativeState(a.id), a, imageExpected)
    await browser.waitUntil(() => browser.execute(() => {
      const image = document.querySelector('[aria-label="Note body"] img[data-attachment-id]')
      return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1
    }), { timeout: 6_000, timeoutMsg: 'Reopened managed PNG preview did not decode' })
    const preview = await browser.execute(() => {
      const image = document.querySelector('[aria-label="Note body"] img[data-attachment-id]')
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { attachmentId: image.dataset.attachmentId, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) }
    })
    assert.deepEqual(preview, { attachmentId, pixel: [18, 171, 52, 255] })
    await preservedShortcuts(a, imageExpected)
    assert.notEqual(a.id, b.id)
    assert.notEqual(a.entryId, b.entryId)
    await open(b)
    await browser.waitUntil(async () => {
      const value = await domValue()
      return value?.text === 'Toolbar B linked' && value.links === 1 && value.images === 0
    }, { timeout: 5_000, timeoutMsg: 'Final reopened B link baseline did not render' })
    assertStored(await nativeState(b.id), b, linkExpected)
  })
})
