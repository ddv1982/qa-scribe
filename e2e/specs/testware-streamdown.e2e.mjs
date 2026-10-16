import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const preview = '[data-renderer="streamdown"][aria-label="Pending generated testware"]'
const savedPreview = '.record-detail-pane [aria-label$="testware preview"]'
const editor = '.record-detail-pane [aria-label$="testware body"][contenteditable="true"]'
const edit = ' Tester reviewed and saved this rich Testware.'
const wrappedTask = ' Verify wrapped checklist text stays in its own column beside the first line.'.repeat(8)
const safeLink = `https://example.test/check/${'long-reference-'.repeat(24)}`

async function native(command, args = {}) {
  return browser.execute(async (name, parameters) =>
    window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

let windowScale
async function resize(width) {
  if (!windowScale) {
    await browser.setWindowSize(1280, 860)
    let lastWidth = 0
    let stable = 0
    await browser.waitUntil(async () => {
      const current = await browser.execute(() => innerWidth)
      stable = current === lastWidth ? stable + 1 : 0
      lastWidth = current
      return stable >= 3
    }, { timeout: 5_000, interval: 100, timeoutMsg: 'Native window geometry did not settle' })
    const viewport = await browser.execute(() => ({ width: innerWidth, height: innerHeight }))
    // Calibrate at desktop width, where the application's minimum window size
    // cannot distort the physical-to-logical ratio on scaled WebKitGTK.
    windowScale = 1280 / viewport.width
  }
  await browser.setWindowSize(Math.round(width * windowScale), Math.round(860 * windowScale))
  await browser.waitUntil(async () => Math.abs(await browser.execute(() => innerWidth) - width) <= 16,
    { timeout: 5_000, timeoutMsg: `WebView did not reach the requested ${width}px logical viewport` })
}

async function inspect(selector) {
  return browser.execute((target) => {
    const root = document.querySelector(target)
    if (!root) return null
    const image = root.querySelector('img[alt="Managed evidence"]')
    const rect = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    return {
      text: root.textContent, h2: root.querySelector('h2')?.textContent,
      h3: root.querySelector('h3')?.textContent,
      strong: root.querySelector('strong')?.textContent, em: root.querySelector('em')?.textContent,
      orderedStart: root.querySelector('ol')?.getAttribute('start'), orderedText: root.querySelector('ol')?.textContent,
      nestedText: root.querySelector('ul ul')?.textContent,
      tasks: Array.from(root.querySelectorAll('input[type="checkbox"]'), (input) => ({
        checked: input.checked, disabled: input.disabled, text: input.closest('li')?.textContent,
        box: rect(input), labelBox: rect(input.closest('li')?.querySelector('p')),
      })),
      typography: { fontSize: getComputedStyle(root).fontSize, lineHeight: getComputedStyle(root).lineHeight,
        firstMargin: root.querySelector('h2') && getComputedStyle(root.querySelector('h2')).marginTop,
        readingScale: getComputedStyle(root).getPropertyValue('--font-size-md').trim() },
      links: Array.from(root.querySelectorAll('a'), (link) => ({ href: link.getAttribute('href'), box: rect(link) })),
      image: image && { id: image.dataset.attachmentId, src: image.getAttribute('src'),
        complete: image.complete, naturalWidth: image.naturalWidth, box: rect(image) },
      hostileGlobal: typeof window.__streamdownHostile !== 'undefined',
      hostileNodes: root.querySelectorAll('script, [onerror], [onclick], img[src^="http"], img[alt="Remote evidence"]').length,
      box: rect(root), clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
      viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
      documentWidth: document.documentElement.scrollWidth,
    }
  }, selector)
}

function assertRich(value, attachmentId, live = false) {
  assert.ok(value, 'Rich Testware must be mounted')
  if (live) assert.equal(value.h2, 'E2E test cases')
  assert.equal(value.h3, 'Scenario')
  assert.equal(value.strong, 'Important')
  assert.equal(value.em, 'context')
  assert.ok(value.text.includes('**literal** _name_ `code` [label](url) & entities'), 'HTML literal Markdown and entities must retain their meaning')
  assert.equal(value.orderedStart, '7')
  assert.match(value.orderedText, /Seventh/)
  assert.match(value.text, /Parent/)
  assert.match(value.nestedText, /Nested/)
  assert.equal(value.tasks.length, 2)
  assert.deepEqual(value.tasks.map(({ checked }) => checked), [true, false])
  assert.match(value.tasks[0].text, /Verified/)
  assert.match(value.tasks[1].text, /Pending/)
  if (live) assert.ok(value.tasks.every(({ disabled }) => disabled), 'Streaming tasks are read-only')
  assert.equal(value.image?.id, attachmentId)
  assert.match(value.image.src, /^data:image\/png;base64,/)
  assert.ok(value.image.complete && value.image.naturalWidth > 0, 'Managed Evidence must really decode')
  assert.equal(value.hostileGlobal, false)
  if (live) assert.equal(value.hostileNodes, 0)
}

function assertLayout(value, width, theme) {
  for (const task of value.tasks) {
    assert.ok(task.box.right <= task.labelBox.left, 'Checkbox must sit beside its label, not on a separate line')
    assert.ok(task.box.top < task.labelBox.top + 24 && task.box.bottom > task.labelBox.top,
      'Checkbox must align with the first text line')
    assert.ok(task.box.height > 0 && task.box.height <= 22, 'Checkbox must remain compact')
  }
  assert.equal(value.typography.fontSize, value.typography.readingScale, 'Record text must retain the Chat reading scale')
  assert.equal(value.typography.firstMargin, '0px', 'Initial heading must not add a second document inset')
  assert.equal(value.theme, theme, 'Theme must be changed through the application control')
  assert.ok(width === 640 ? value.viewport.width <= 700 : value.viewport.width >= 1000, 'Native viewport must actually resize')
  assert.ok(value.box.width > 100 && value.box.height > 0, 'Document must have usable geometry')
  assert.ok(value.box.left >= -1 && value.box.right <= value.viewport.width + 1, 'Document must fit horizontally')
  assert.ok(value.scrollWidth <= value.clientWidth + 1 && value.documentWidth <= value.viewport.width + 1, 'Rich content must not overflow')
  assert.ok(value.image.box.width > 0 && value.image.box.height > 0
    && value.image.box.left >= value.box.left - 1 && value.image.box.right <= value.box.right + 1, 'Managed image must remain bounded')
}

// Exported workflow only: the maintained critical-workflow runner owns selection and timeout.
export async function runTestwareStreamdownWorkflow({ createSessionFixture, sessionTab, sessionOption, button,
  waitForFixtureFile, releaseFixtureInvocation }) {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
  assert.ok(directory && artifacts, 'Native Streamdown workflow requires isolated fixture and evidence directories')
  mkdirSync(artifacts, { recursive: true })
  const evidence = { layouts: [], requests: [], checkpoints: [] }
  // A real wide Evidence image exercises responsive sizing after native import.
  const pixel = await browser.execute(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 960
    canvas.height = 120
    const context = canvas.getContext('2d')
    context.fillStyle = '#008000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  })
  const server = createServer((request, response) => {
    evidence.requests.push(request.url)
    response.writeHead(200, { 'Content-Type': 'image/png', 'Connection': 'close' })
    response.end(Buffer.from(pixel.split(',')[1], 'base64'))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const title = 'E2E Streamdown rich Testware'
  let sessionId
  const records = () => native('list_drafts', { sessionId })
  const click = async (label) => {
    const target = await button(label)
    await target.waitForClickable()
    await target.click()
  }
  const generate = async () => {
    await (await sessionTab('Note')).click()
    await click('Generate test cases')
    const confirm = await (await $('dialog')).$('button=Generate test cases')
    await confirm.waitForClickable()
    await confirm.click()
  }
  const waitRich = async (selector, attachmentId) => {
    await $(selector).waitForDisplayed({ timeout: 10_000 })
    await browser.waitUntil(async () => {
      const value = await inspect(selector)
      return value?.h3 === 'Scenario' && value.image?.id === attachmentId
        && value.image.complete && value.image.naturalWidth > 0
    }, { timeout: 10_000, timeoutMsg: 'Native rich Testware and managed image never hydrated' })
    return inspect(selector)
  }
  const captureLayouts = async (phase, selector, attachmentId, editing = false) => {
    for (const theme of ['light', 'dark']) {
      await resize(1280)
      await click('Settings')
      const themeButton = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await themeButton.scrollIntoView()
      await themeButton.waitForClickable()
      await themeButton.click()
      await click('Back')
      await (await sessionTab('Testware')).click()
      if (editing) await click('Edit')
      for (const width of [1280, 640]) {
        await resize(width)
        await $(selector).scrollIntoView()
        const value = await waitRich(selector, attachmentId)
        evidence.layouts.push({ phase, requestedWidth: width, requestedTheme: theme, ...value })
        await browser.saveScreenshot(join(artifacts, `testware-${phase}-${theme}-${width}.png`))
        assertRich(value, attachmentId, phase === 'live')
        assertLayout(value, width, theme)
        assert.ok(value.tasks[1].labelBox.height > 40, 'Long checklist text must actually wrap in every lifecycle state')
        assert.ok(value.links.some((link) => link.href === safeLink), 'Safe long link must appear in every lifecycle state')
        assert.equal(evidence.requests.length, 0)
      }
      await resize(1280)
      if (editing) await click('Save')
    }
  }
  try {
    assert.equal(existsSync(join(directory, 'codex-exec-1.started')), false, 'This isolated scenario owns invocations 1 and 2')
    await createSessionFixture(title, 'Generate deterministic rich Testware from this Note.')
    await browser.waitUntil(async () => (await native('list_sessions')).some((session) => session.title === title))
    sessionId = (await native('list_sessions')).find((session) => session.title === title).id
    await browser.execute((dataUrl) => {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (character) => character.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'streamdown-evidence.png', { type: 'image/png' }))
      const note = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
      note.focus()
      note.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, pixel)
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('[aria-label="Note body"] img[data-attachment-id]'))))
    const attachment = { id: await browser.execute(() => document.querySelector('[aria-label="Note body"] img[data-attachment-id]').dataset.attachmentId) }
    await browser.waitUntil(async () => (await native('open_session_note_state', { id: sessionId })).noteEntry.body.includes(attachment.id))
    evidence.sessionId = sessionId
    evidence.attachmentId = attachment.id
    const remoteUrl = `http://127.0.0.1:${server.address().port}/hostile-evidence.png`
    writeFileSync(join(directory, 'testware-streamdown.json'), JSON.stringify({ attachmentId: attachment.id, remoteUrl,
      wrappedTask, safeLink }))

    await generate()
    await waitForFixtureFile('codex-exec-1.partial')
    assertRich(await waitRich(preview, attachment.id), attachment.id, true)
    assert.equal(existsSync(join(directory, 'codex-exec-1.release')), false, 'Preview must be observed before provider completion')
    assert.deepEqual(await records(), [], 'Streaming preview must not create a saved record')
    evidence.checkpoints.push({ phase: 'held-partial', recordCount: 0, requests: evidence.requests.length })
    assert.equal(evidence.requests.length, 0, 'Hostile image must never reach the local HTTP observer')

    await captureLayouts('live', preview, attachment.id)
    await resize(1280)
    await releaseFixtureInvocation(1)
    await $(preview).waitForExist({ reverse: true, timeout: 15_000 })
    await browser.waitUntil(async () => (await records()).length === 1
      && (await $('body').getText()).includes('Testware generated'), { timeout: 15_000 })
    const generated = (await records())[0]
    assert.equal(generated.kind, 'testware')
    assert.ok(generated.aiRunId)
    assertRich(await waitRich(savedPreview, attachment.id), attachment.id)
    await captureLayouts('saved', savedPreview, attachment.id)
    assert.deepEqual(await records(), [generated], 'Reading, resizing and changing themes must not write saved Testware')
    await captureLayouts('editing', editor, attachment.id, true)
    evidence.checkpoints.push({ phase: 'completed', recordId: generated.id, recordCount: 1 })
    await click('Edit')
    await $(editor).waitForDisplayed()
    assert.ok(await browser.execute((selector, text) => {
      const root = document.querySelector(selector)
      root.focus()
      const paragraph = Array.from(root.querySelectorAll('li p')).find((node) => node.textContent.startsWith('Pending'))
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      range.collapse(false)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      return document.execCommand('insertText', false, text)
    }, editor, edit), 'Real WebView editing command must append Testware text')
    assert.ok((await $(editor).getText()).includes(edit.trim()))
    await click('Save')
    await browser.waitUntil(async () => (await records())[0]?.body.includes(edit.trim()))
    await createSessionFixture('E2E Streamdown isolation Session', 'Independent Note for reopen verification.')
    await (await sessionOption(title)).click()
    await browser.waitUntil(async () => (await $('[aria-label="Session title"]')).getValue().then((value) => value === title))
    await (await sessionTab('Testware')).click()
    const reopened = await waitRich(savedPreview, attachment.id)
    assertRich(reopened, attachment.id)
    assert.ok(reopened.text.includes(edit.trim()))
    const beforeReading = await records()
    await captureLayouts('reopened', savedPreview, attachment.id)
    assert.deepEqual(await records(), beforeReading, 'Reopened reading matrix must not mutate canonical persisted values')
    const persisted = await records()
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].id, generated.id)
    assert.equal(persisted[0].bodyFormat, 'tiptap_json')
    assert.ok(persisted[0].bodyJson.includes(attachment.id), 'Saved canonical rich structure must retain managed image identity')
    evidence.persisted = persisted[0]

    await generate()
    await waitForFixtureFile('codex-exec-2.partial')
    assertRich(await waitRich(preview, attachment.id), attachment.id, true)
    assert.equal((await records()).length, 1)
    await click('Cancel')
    await $(preview).waitForExist({ reverse: true, timeout: 10_000 })
    await browser.waitUntil(async () => (await native('list_active_ai_action_jobs')).length === 0,
      { timeout: 10_000, timeoutMsg: 'Cancelled generation remained active in the native job registry' })
    assert.match(await $('body').getText(), /Generation cancelled/)
    assert.deepEqual(await records(), persisted, 'Cancelling a held partial must not change saved Testware')
    assert.equal(existsSync(join(directory, 'codex-exec-2.release')), false)
    assert.equal(evidence.requests.length, 0, 'No hostile image requests across preview, completion, editing, reopening or cancellation')
    assert.equal(await browser.execute(() => typeof window.__streamdownHostile), 'undefined')
    evidence.checkpoints.push({ phase: 'cancelled', recordCount: 1, activeJobs: 0, requests: 0 })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    writeFileSync(join(artifacts, 'testware-streamdown-evidence.json'), JSON.stringify(evidence, null, 2))
  }
}
