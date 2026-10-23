import { createRequire } from 'node:module'
import { nativeKeySender } from './preflight-native-keys.mjs'
import assert from 'node:assert/strict'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertClipboardHtml, readClipboardText } from '../fixtures/clipboard-readback.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))

export async function runClipboardWorkflow() {
  const out = process.env.QA_SCRIBE_E2E_ARTIFACTS
  const receipts = []
  const save = (name, value) => {
    receipts.push({ name, ...value })
    writeFileSync(join(out, 'clipboard-outcomes.json'), JSON.stringify(receipts, null, 2))
  }
  const click = async (selector) => { const item = await $(selector); await item.waitForClickable(); await item.click() }
  const rail = async (label) => { await (await $('nav[aria-label="Workspace sections"]')).$(`button*=${label}`).click() }
  const tab = async (label) => { await (await $('[role="tablist"]')).$(`[role="tab"]*=${label}`).click() }
  const capture = (name) => browser.saveScreenshot(join(out, `${name}.png`))
  await $('button=New Session').waitForClickable()
  const fixtures = await browser.tauri.execute(async ({ core }) => {
    const result = []
    for (const title of ['UX4 Alpha', 'UX4 Beta']) {
      const session = await core.invoke('create_session', { draft: { title } })
      const note = await core.invoke('open_session_note_state', { id: session.id })
      await core.invoke('update_entry', { id: note.noteEntry.id, patch: { body: '<p><strong>Note</strong> exact source.</p>', bodyJson: null, bodyFormat: 'html' } })
      const draft = await core.invoke('create_draft', { draft: { sessionId: session.id, aiRunId: null, kind: 'testware', title: 'Duplicate case', body: `<p><strong>${title}</strong> saved body.</p>` } })
      const finding = await core.invoke('create_finding', { draft: { sessionId: session.id, kind: 'bug', title: 'Duplicate finding', body: `<p><em>${title}</em> finding body.</p>` } })
      result.push({ session, draft, finding })
    }
    return result
  })
  const readSaved = () => browser.tauri.execute(async ({ core }, ids) => {
    const sessions = await core.invoke('list_sessions')
    return Promise.all(ids.map(async (id) => ({ session: sessions.find((item) => item.id === id), entries: await core.invoke('list_entries', { sessionId: id }), drafts: await core.invoke('list_drafts', { sessionId: id }), findings: await core.invoke('list_findings', { sessionId: id }) })))
  }, fixtures.map((item) => item.session.id))
  const audit = (mode) => execFileSync('python3', [fileURLToPath(new URL('../fixtures/clipboard-database.py', import.meta.url)), mode, join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')], { encoding: 'utf8', timeout: 5_000 })
  await browser.refresh()
  await $('[role="option"]*=UX4 Alpha').waitForClickable()
  await $('[role="option"]*=UX4 Alpha').click()
  await $('[aria-label="Copy note UX4 Alpha"]').waitForClickable()
  await click('[aria-label="Copy note UX4 Alpha"]')
  await $('[aria-label="note UX4 Alpha copied"]').waitForDisplayed()
  let payload = readClipboardText()
  assert.equal(payload.plain, '## UX4 Alpha\n\n**Note** exact source.')
  assertClipboardHtml(payload.html, '<h2>UX4 Alpha</h2><p><strong>Note</strong> exact source.</p>')
  save('Lane 1. Copy a Note with formatting', payload)
  await capture('copy-note')

  await tab('Test cases')
  await click('[aria-label="Copy Duplicate case"]')
  await $('[aria-label="Duplicate case copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Duplicate case\n\n**UX4 Alpha** saved body.')
  assertClipboardHtml(payload.html, '<h2>Duplicate case</h2><p><strong>UX4 Alpha</strong> saved body.</p>')
  save('Lane 2. Copy a saved test case', { ...payload, id: fixtures[0].draft.id })
  await capture('copy-test-case')

  const beforeEditCopy = await readSaved()
  await click('button=Edit')
  await $('[aria-label="Test case title"]').setValue('Unsaved copied case')
  await $('.editable-record [contenteditable="true"]').setValue('Unsaved current body.')
  audit('start')
  const editUrl = await browser.getUrl()
  await click('[aria-label="Copy Unsaved copied case"]')
  await $('[aria-label="Unsaved copied case copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Unsaved copied case\n\nUnsaved current body.')
  assertClipboardHtml(payload.html, '<h2>Unsaved copied case</h2><p>Unsaved current body.</p>')
  assert.deepEqual(await readSaved(), beforeEditCopy)
  assert.deepEqual(JSON.parse(audit('read')), [])
  audit('stop')
  assert.equal(await browser.getUrl(), editUrl)
  assert.equal(await $('[aria-label="Test case title"]').getValue(), 'Unsaved copied case')
  assert.equal(await $('.editable-record [contenteditable="true"]').getText(), 'Unsaved current body.')
  await capture('copy-actions')
  await tab('Note')
  const pendingChanges = await $('dialog[aria-labelledby="pending-changes-title"]')
  await pendingChanges.waitForDisplayed()
  assert.equal(await pendingChanges.$('#pending-changes-title').getText(), 'Save before leaving?')
  assert.match(await pendingChanges.getText(), /unsaved|changes/i)
  await pendingChanges.$('button=Keep editing').click()
  assert.equal(await $('[aria-label="Test case title"]').getValue(), 'Unsaved copied case')
  save('Copy visible current edits', { ...payload, copyCausedWrites: 0, urlUnchanged: true, dirtyGuardRetained: true, storedStateUnchanged: true })
  await click('button=Discard')

  await tab('Findings')
  await click('[aria-label="Copy Duplicate finding"]')
  await $('[aria-label="Duplicate finding copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Duplicate finding\n\n*UX4 Alpha* finding body.')
  assertClipboardHtml(payload.html, '<h2>Duplicate finding</h2><p><em>UX4 Alpha</em> finding body.</p>')
  save('Lane 3. Copy a Finding', { ...payload, id: fixtures[0].finding.id })
  await capture('copy-finding')

  await rail('Test cases library')
  await $('h1=Test cases library').waitForDisplayed()
  const list = await $('.library-sidebar .record-master-list')
  await (await list.$('button*=UX4 Beta')).click()
  await $('h2=Duplicate case').waitForDisplayed()
  const before = await readSaved()
  const beforeUrl = await browser.getUrl()
  audit('start')
  await browser.execute(() => {
    window.__ux4Activations = 0
    document.addEventListener('click', (event) => {
      if (event.target.closest('button[aria-label="Copy Duplicate case"]')) window.__ux4Activations += 1
    }, { capture: true })
  })
  await click('[aria-label="Copy Duplicate case"]')
  await $('[aria-label="Duplicate case copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Duplicate case\n\n**UX4 Beta** saved body.')
  assertClipboardHtml(payload.html, '<h2>Duplicate case</h2><p><strong>UX4 Beta</strong> saved body.</p>')
  assert.equal(await browser.getUrl(), beforeUrl)
  assert.deepEqual(await readSaved(), before)
  const activations = await browser.execute(() => window.__ux4Activations)
  const writes = JSON.parse(audit('read'))
  audit('stop')
  assert.equal(activations, 1)
  assert.deepEqual(writes, [])
  save('Lane 4. Copy from the test-case library', { ...payload, target: fixtures[1].draft, activations, sessionSwitches: 0, copyCausedWrites: writes.length, writeReadback: 'SQLite AFTER INSERT/UPDATE/DELETE triggers in disposable fixture DB for sessions, entries, drafts and findings.', beforeUrl, afterUrl: await browser.getUrl() })
  await capture('copy-library')
  await (await list.$('button*=UX4 Alpha')).click()
  await click('[aria-label="Copy Duplicate case"]')
  await $('[aria-label="Duplicate case copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Duplicate case\n\n**UX4 Alpha** saved body.')
  assertClipboardHtml(payload.html, '<h2>Duplicate case</h2><p><strong>UX4 Alpha</strong> saved body.</p>')
  save('Lane 5. Select duplicate titles from different Sessions', { ...payload, target: fixtures[0].draft })
  await capture('copy-identity')

  await rail('Findings library')
  await $('h1=Findings library').waitForDisplayed()
  await (await $('.library-sidebar .record-master-list')).$('button*=UX4 Beta').click()
  await click('[aria-label="Copy Duplicate finding"]')
  await $('[aria-label="Duplicate finding copied"]').waitForDisplayed()
  payload = readClipboardText()
  assert.equal(payload.plain, '## Duplicate finding\n\n*UX4 Beta* finding body.')
  assertClipboardHtml(payload.html, '<h2>Duplicate finding</h2><p><em>UX4 Beta</em> finding body.</p>')
  save('Finding library direct copy', { ...payload, id: fixtures[1].finding.id })

  await click('button=Open in Session')
  await $('button=Edit').waitForClickable()
  await click('button=Edit')
  await $('[aria-label="Finding title"]').setValue('Dirty local finding')
  await rail('Test cases library')
  await $('dialog').waitForDisplayed()
  assert.match(await $('dialog').getText(), /unsaved|changes/i)
  save('Lane 6. Copy while another Session has dirty edits', { qualification: 'Single-window library navigation is guarded. This native lane proves the guard. The real-controller test separately proves direct Copy preserves dirty Note, Draft and Finding state and causes zero writes.' })
  await capture('copy-dirty-other-session')
  await (await $('dialog')).$('button=Discard changes').click()
  await browser.waitUntil(async () => {
    const heading = await $('h1=Test cases library')
    return heading.isDisplayed()
  }, { timeout: 10_000, timeoutMsg: 'Discard must reveal the Test cases library' })

  const images = await browser.execute(() => [
    [255, 0, 0, 255], [0, 255, 0, 255],
  ].map((pixel) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixel), 1, 1), 0, 0)
    return canvas.toDataURL('image/png')
  }))
  const imageFixture = await browser.tauri.execute(async ({ core }, input) => {
    const attachments = []
    for (const [index, dataUrl] of input.images.entries()) {
      const attachment = await core.invoke('import_clipboard_screenshot', { sessionId: input.sessionId, entryId: null, filename: `pixel-${index}.png`, dataUrl })
      attachments.push(attachment)
    }
    const draft = await core.invoke('create_draft', { draft: { sessionId: input.sessionId, aiRunId: null, kind: 'testware', title: 'Screenshot case', body: attachments.map(({ id }) => `<img src="qa-scribe-attachment://${id}" data-attachment-id="${id}" alt="Pixel">`).join('') } })
    return { attachments, draft }
  }, { images, sessionId: fixtures[0].session.id })
  await rail('Findings library')
  await $('h1=Findings library').waitForDisplayed()
  await rail('Test cases library')
  await $('h1=Test cases library').waitForDisplayed()
  await (await $('.library-sidebar .record-master-list')).$('button*=Screenshot case').click()
  await click('button=Open in Session')
  await $('[aria-label="Copy first Screenshot case screenshot"]').waitForClickable()
  assert.equal(await $('[aria-label="Copy first Screenshot case screenshot"]').getText(), 'Copy first screenshot')
  const firstPath = join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, imageFixture.attachments[0].relativePath)
  const hiddenPath = `${firstPath}.ux4-held`
  renameSync(firstPath, hiddenPath)
  try {
    await click('[aria-label="Copy first Screenshot case screenshot"]')
    await $('.copy-error[role="alert"]').waitForDisplayed()
    assert.equal(await $('[aria-label="Screenshot case screenshot copied"]').isExisting(), false)
    assert.match(await $('.copy-error').getText(), /Copy first screenshot failed/)
    assert.equal(await $('[aria-label="Copy first Screenshot case screenshot"]').isEnabled(), true)
    assert.equal(await browser.tauri.execute(({ core }) => core.invoke('read_clipboard_image_data_url')), null)
    save('Lane 7. Inject a clipboard failure', { injection: 'Temporarily rename only the first managed fixture image file. The actual native command fails; the second image is never copied.', successShown: false, retryEnabled: true })
    await capture('copy-failed')
  } finally {
    renameSync(hiddenPath, firstPath)
  }
  if (process.platform === 'linux') {
    const keyboard = {}
    const sendKey = nativeKeySender(keyboard, () => save('Screenshot keyboard', keyboard), Key)
    await browser.execute(() => document.querySelector('[aria-label="Copy Screenshot case"]').focus())
    await sendKey(Key.Tab)
    assert.equal(await browser.execute(() => document.activeElement?.getAttribute('aria-label')), 'Copy first Screenshot case screenshot')
    await capture('copy-screenshot-keyboard')
    await sendKey(Key.Enter)
  } else {
    await click('[aria-label="Copy first Screenshot case screenshot"]')
  }
  await $('[aria-label="Screenshot case screenshot copied"]').waitForDisplayed()
  const actualImage = await browser.tauri.execute(({ core }) => core.invoke('read_clipboard_image_data_url'))
  const actualPixels = await browser.execute(async (dataUrl) => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, rgba: Array.from(context.getImageData(0, 0, image.width, image.height).data) }
  }, actualImage)
  assert.deepEqual(actualPixels, { width: 1, height: 1, rgba: [255, 0, 0, 255] })
  save('Lane 8. Copy a record with several screenshots', { firstAttachmentId: imageFixture.attachments[0].id, secondAttachmentId: imageFixture.attachments[1].id, actualPixels, readback: 'Existing read_clipboard_image_data_url reads actual OS image; browser canvas decodes RGBA pixels.' })
  await capture('copy-screenshot')
  return { receipts, fixtures }
}
