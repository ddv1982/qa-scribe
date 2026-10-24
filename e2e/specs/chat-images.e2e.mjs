import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { proveChatImagesVisual } from './chat-images-visual-proof.mjs'
import { imageFixture, imageResponse } from '../fixtures/chat-images-provider.mjs'

const composer = '[aria-label="Session chat"] textarea'
const attached = '[aria-label="Attached images"]'
const note = '[aria-label="Note body"][contenteditable="true"]'
const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const authored = 'Tester changed this text.\n雪 <literal> & evidence [keep](unchanged).'
const followup = 'Retain the original screenshot on this later turn.'
const originalNote = 'Existing Note before the image conversation.'

async function read(command, args = {}) {
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

async function click(label) {
  const button = await $(`button=${label}`)
  await button.waitForClickable()
  await button.click()
}

function invocationCount() {
  return readdirSync(directory).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
}

async function saved(sessionId, text, filenames) {
  await browser.waitUntil(async () => {
    const chat = await read('get_chat', { sessionId })
    return chat.composer === text && JSON.stringify(chat.composerImages.map(image => image.filename)) === JSON.stringify(filenames)
      && await browser.execute(() => document.querySelector('.chat-meta [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 7_000, timeoutMsg: 'Chat text and ordered image references must become durable' })
  return read('get_chat', { sessionId })
}

async function stageDomImage(filename, paste) {
  return browser.execute((selector, bytes, filename, paste) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], filename, { type: 'image/png' }))
    const target = document.querySelector(paste ? selector : 'input[aria-label="Choose chat images"]')
    if (paste) {
      target.focus()
      return !target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }
    target.files = transfer.files
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, composer, [...readFileSync(imageFixture.path)], filename, paste)
}

async function previewPixels(selector) {
  await browser.waitUntil(async () => browser.execute((selector) => {
    const image = document.querySelector(selector)
    return Boolean(image?.complete && image.naturalWidth)
  }, selector), { timeout: 5_000, timeoutMsg: 'Managed image pixels must load in the WebView' })
  assert.deepEqual(await browser.execute((selector) => {
    const image = document.querySelector(selector)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return { width: canvas.width, height: canvas.height, rgba: [...context.getImageData(0, 0, canvas.width, canvas.height).data] }
  }, selector), { width: 2, height: 2, rgba: imageFixture.rgba })
}

async function reopen(title) {
  await browser.refresh()
  const option = await $(`[role="option"]*=${title}`)
  await option.waitForClickable()
  await option.click()
  await click('Chat')
  await $(composer).waitForDisplayed()
}

async function complete(sessionId, index, expectedMessages) {
  const path = join(directory, `codex-exec-${index}.started`)
  await browser.waitUntil(() => existsSync(path), { timeout: 10_000, timeoutMsg: 'Send must reach the deterministic app-server fixture' })
  const receipt = JSON.parse(readFileSync(join(directory, `codex-exec-${index}.chat.json`), 'utf8'))
  assert.equal(receipt.realVision, false)
  assert.equal(receipt.transport, 'app-server')
  const image = receipt.messages[0].images[0]
  assert.equal(image.type, 'localImage')
  assert.equal(image.sha256, imageFixture.sha256)
  assert.equal(image.sizeBytes, 77)
  const pathWithinData = relative(realpathSync(process.env.QA_SCRIBE_E2E_APP_DATA_DIR), image.path)
  assert.ok(pathWithinData && pathWithinData !== '..' && !pathWithinData.startsWith('../') && !isAbsolute(pathWithinData),
    'Provider must read the managed app-data file rather than the source fixture')
  const running = await read('get_chat', { sessionId })
  assert.deepEqual(receipt.messages.map(({ id, role, text, images }) => ({ id, role, text, images: images.length })),
    running.messages.map(({ id, role, text, images }) => ({ id, role, text, images: images.length })),
    'Wire content must preserve each durable message and its image association')
  writeFileSync(join(directory, `codex-exec-${index}.release`), 'Release the deterministic image response.\n', { flag: 'wx' })
  await browser.waitUntil(async () => {
    const chat = await read('get_chat', { sessionId })
    return chat.messages.length === expectedMessages && chat.messages.every(message => message.status === 'completed')
  }, { timeout: 10_000, timeoutMsg: 'Image response must reach durable Chat storage' })
  await $('button=Send').waitForExist()
  return receipt
}

describe('Built application Chat image transport fixtures, without real vision or OS clipboard proof', () => {
  it('imports images, preserves edited text, sends image-only content, replays pixels, and hands them to the Note', async () => {
    assert.ok(directory && artifacts && process.env.QA_SCRIBE_E2E_APP_DATA_DIR)
    assert.equal(process.env.QA_SCRIBE_E2E_CHAT_IMAGES, '1', 'Run through scripts/run-e2e.mjs')
    const evidence = { status: 'failed', provider: 'deterministic-codex-fixture', realVision: false,
      osClipboard: 'not-exercised', nativeFileDialog: 'not-exercised', fileInputSelection: 'not-attempted',
      domPasteContract: false, webviewReload: false, nativeProcessRestart: 'not-exercised' }
    try {
      await click('New Session')
      const title = 'E2E deterministic Chat images'
      await $('[aria-label="Session title"]').setValue(title)
      await browser.waitUntil(async () => (await read('list_sessions')).some(session => session.title === title))
      const sessionId = (await read('list_sessions')).find(session => session.title === title).id
      await click('Write note')
      await $(note).waitForDisplayed()
      assert.equal(await browser.execute((selector, text) => {
        const editor = document.querySelector(selector)
        editor.focus()
        const range = document.createRange()
        range.selectNodeContents(editor)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        return document.execCommand('insertText', false, text)
      }, note, originalNote), true)
      await browser.waitUntil(async () => (await read('list_entries', { sessionId })).some(entry => entry.entryType === 'note' && entry.body.includes(originalNote)))
      const original = (await read('list_entries', { sessionId })).find(entry => entry.entryType === 'note')
      await click('Chat')
      await click('Configure AI')
      await $('[aria-label="Refresh CLI configuration"]').waitForClickable()
      await $('[aria-label="Refresh CLI configuration"]').click()
      const provider = (await read('refresh_provider_status')).providers.find(provider => provider.id === 'codex_cli')
      evidence.providerCatalog = provider
      assert.ok(provider?.available && provider.defaultSnapshot?.model.value === 'chat-image-fixture'
        && provider.models.some(model => model.id === 'chat-image-fixture' && model.capabilities.vision === true),
      'The synthetic Codex image-capable catalog must become ready')
      assert.equal((await read('get_settings')).selectedAiProvider, 'codex_cli')
      await click('Back')
      await saved(sessionId, '', [])
      assert.equal(invocationCount(), 0)
      assert.equal(await $('button=Send').isEnabled(), false)
      assert.deepEqual(await browser.execute(() => {
        const input = document.querySelector('input[aria-label="Choose chat images"]')
        const attach = document.querySelector('button[aria-label="Attach images"]')
        const send = attach.nextElementSibling
        const a = attach.getBoundingClientRect(), s = send.getBoundingClientRect()
        return { type: input.type, multiple: input.multiple, accept: input.accept.split(',').sort(),
          next: send.textContent.trim(), leftOfSend: a.right <= s.left, sameRow: Math.abs(a.top - s.top) < 2 }
      }), { type: 'file', multiple: true, accept: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
        next: 'Send', leftOfSend: true, sameRow: true })
      await browser.execute(() => {
        const input = document.querySelector('input[aria-label="Choose chat images"]')
        input.addEventListener('click', event => {
          event.preventDefault()
          input.dataset.e2ePickerClicked = 'true'
        }, { once: true })
      })
      await $('[aria-label="Attach images"]').click()
      assert.equal(await browser.execute(() => {
        const input = document.querySelector('input[aria-label="Choose chat images"]')
        const clicked = input.dataset.e2ePickerClicked === 'true'
        delete input.dataset.e2ePickerClicked
        return clicked
      }), true, 'The real paperclip must activate the file input; this probe suppresses the native dialog')
      evidence.paperclipActivation = 'file-input-click-observed-with-native-dialog-suppressed'
      await $(composer).setValue('Initial text that the tester will edit.')
      try {
        await $('input[aria-label="Choose chat images"]').setValue(imageFixture.path)
        evidence.fileInputSelection = 'webdriver-file-input'
      } catch (error) {
        if (!/unsupported|not implemented|invalid element state|not interactable|only.*text|file.*upload|JavaScript exception occurred/i.test(String(error.message))) throw error
        evidence.fileInputSelection = 'unsupported-driver; DOM-file-input-contract-only'
        assert.equal(await stageDomImage(imageFixture.filename, false), true)
      }
      await saved(sessionId, 'Initial text that the tester will edit.', [imageFixture.filename])
      await previewPixels(`${attached} img`)
      await $(composer).setValue(authored)
      assert.equal(await stageDomImage('dom-paste-contract.png', true), true, 'Synthetic image paste must be handled by the DOM paste contract')
      await saved(sessionId, authored, [imageFixture.filename, 'dom-paste-contract.png'])
      evidence.domPasteContract = true
      await $(`${attached} button[aria-label="Remove dom-paste-contract.png"]`).click()
      await saved(sessionId, authored, [imageFixture.filename])
      assert.equal(await $(composer).getValue(), authored)
      const beforeReload = await read('get_chat', { sessionId })
      assert.deepEqual(beforeReload.composerImages.map(({ filename, mimeType, sizeBytes }) => ({ filename, mimeType, sizeBytes })),
        [{ filename: imageFixture.filename, mimeType: 'image/png', sizeBytes: 77 }])
      await reopen(title)
      await saved(sessionId, authored, [imageFixture.filename])
      assert.deepEqual((await read('get_chat', { sessionId })).composerImages, beforeReload.composerImages)
      assert.equal(await $(composer).getValue(), authored)
      evidence.webviewReload = true
      await $(`${attached} button[aria-label="Preview ${imageFixture.filename}"]`).waitForClickable()
      await $(`${attached} button[aria-label="Preview ${imageFixture.filename}"]`).click()
      await $('dialog[open]').waitForDisplayed()
      assert.equal(await $('dialog[open] h2').getText(), imageFixture.filename)
      await previewPixels('dialog[open] img')
      await $('[aria-label="Close image preview"]').click()
      await $('dialog[open]').waitForExist({ reverse: true })
      await $(composer).setValue('')
      await saved(sessionId, '', [imageFixture.filename])
      await $('button=Send').waitForEnabled()
      await click('Send')
      evidence.initialPayload = await complete(sessionId, 1, 2)
      assert.equal(evidence.initialPayload.messages[0].text, '')
      await saved(sessionId, '', [])
      assert.equal(await $('button=Send').isEnabled(), false)
      await previewPixels('[aria-label="Conversation transcript"] [aria-label="Message images"] img')
      const sent = await read('get_chat', { sessionId })
      assert.deepEqual(sent.messages[0].images, beforeReload.composerImages)
      evidence.visual = await proveChatImagesVisual({ sessionId })
      await reopen(title)
      await saved(sessionId, '', [])
      assert.deepEqual((await read('get_chat', { sessionId })).messages, sent.messages)
      await previewPixels('[aria-label="Conversation transcript"] [aria-label="Message images"] img')
      assert.equal(invocationCount(), 1, 'Reload must not start another provider')
      await $(composer).setValue(followup)
      await $(composer).click()
      assert.equal(await browser.execute(selector => {
        const textarea = document.querySelector(selector)
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        const allowed = textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        return allowed && document.execCommand('insertText', false, '\n')
      }, composer), true, 'The DOM Enter contract must permit the WebView to insert a newline')
      assert.equal(await $(composer).getValue(), `${followup}\n`)
      await saved(sessionId, `${followup}\n`, [])
      assert.equal(invocationCount(), 1)
      assert.equal(await browser.execute((selector, macos) => !document.querySelector(selector).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: macos, ctrlKey: !macos, bubbles: true, cancelable: true })),
      composer, process.platform === 'darwin'), true)
      evidence.keyboard = 'DOM key contract; native OS keys require separate proof'
      evidence.replayPayload = await complete(sessionId, 2, 4)
      assert.deepEqual(evidence.replayPayload.messages[0], evidence.initialPayload.messages[0])
      assert.equal(evidence.replayPayload.messages[1].text, imageResponse)
      assert.equal(evidence.replayPayload.messages[2].text, `${followup}\n`)
      await saved(sessionId, '', [])
      await click('Add conversation to note')
      await $(note).waitForDisplayed()
      await browser.waitUntil(async () => Boolean((await read('get_chat', { sessionId })).submission))
      const notes = (await read('list_entries', { sessionId })).filter(entry => entry.entryType === 'note')
      assert.equal(notes.length, 1)
      assert.equal(notes[0].id, original.id)
      const nodes = JSON.parse(notes[0].bodyJson).doc.content
      const originalNodes = JSON.parse(original.bodyJson).doc.content
      assert.deepEqual(nodes.slice(0, originalNodes.length), originalNodes)
      const images = nodes.filter(node => node.type === 'image')
      assert.equal(images.length, 1)
      assert.equal(images[0].attrs.attachmentId, beforeReload.composerImages[0].attachmentId)
      assert.equal(images[0].attrs.src, `qa-scribe-attachment://${images[0].attrs.attachmentId}`)
      assert.ok(notes[0].body.includes(imageResponse) && notes[0].body.includes(followup))
      await previewPixels(`${note} img`)
      const handedOff = await read('get_chat', { sessionId })
      await reopen(title)
      await saved(sessionId, '', [])
      assert.deepEqual((await read('get_chat', { sessionId })).submission, handedOff.submission)
      assert.deepEqual((await read('get_chat', { sessionId })).messages, handedOff.messages)
      assert.equal(invocationCount(), 2, 'Handoff and reload must not invoke a provider')
      await click('Open updated Note')
      await previewPixels(`${note} img`)
      assert.equal((await read('list_entries', { sessionId })).find(entry => entry.id === original.id).bodyJson, notes[0].bodyJson)
      await browser.saveScreenshot(join(artifacts, 'chat-images-note.png'))
      evidence.status = 'passed'
    } finally {
      try { if (await $('button=Cancel response').isExisting()) await click('Cancel response') } catch {}
      writeFileSync(join(artifacts, 'chat-images-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    }
  }).timeout(180_000)
})
