import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'
import { settledViewport } from './preflight-native-keys.mjs'

const composer = '[aria-label="Session chat"] textarea'
const failures = '[aria-label="Failed images"]'
const attached = '[aria-label="Attached images"]'
const filename = `uncertain_${'checkoutValidation'.repeat(7)}.png`
const text = 'Keep image A and this exact question.\n雪 <literal> & evidence 4827.'
const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const dataDirectory = process.env.QA_SCRIBE_E2E_APP_DATA_DIR
const results = []
const actionSelector = label => `//button[normalize-space(.)=${JSON.stringify(label)}]`

async function read(command, args = {}) {
  return browser.execute((command, args) => window.__TAURI_INTERNALS__.invoke(command, args), command, args)
}

async function click(label) {
  const button = await $(`button=${label}`)
  await button.waitForClickable()
  await button.click()
}

function database(sessionId, paths = []) {
  return JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../fixtures/chat-image-recovery-database.py', import.meta.url)),
    dataDirectory, sessionId, JSON.stringify(paths)], { encoding: 'utf8', timeout: 10_000 }))
}

function executions() {
  return readdirSync(directory).filter(name => /^codex-exec-\d+\.(started|lock)$/.test(name)).sort()
}

async function stage(name) {
  await browser.execute((bytes, name) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    const input = document.querySelector('input[aria-label="Choose chat images"]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, [...readFileSync(imageFixture.path)], name)
}

async function saved(sessionId, ids) {
  await browser.waitUntil(async () => {
    const chat = await read('get_chat', { sessionId })
    return chat.composer === text && JSON.stringify(chat.composerImages.map(image => image.attachmentId)) === JSON.stringify(ids)
      && await browser.execute(() => document.querySelector('.chat-meta [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 7_000, timeoutMsg: 'The real backend must retain the exact text and ordered intentional images' })
  return read('get_chat', { sessionId })
}

async function installFault() {
  await browser.execute(() => {
    if (window.__qaChatRecovery) throw new Error('A previous recovery interceptor was not restored')
    const internals = window.__TAURI_INTERNALS__
    const bridge = window.webkit?.messageHandlers?.ipc
    if (!bridge || !(internals.callbacks instanceof Map)) throw new Error('This native recovery probe requires the WKWebView IPC bridge and Tauri callback registry')
    const descriptor = Object.getOwnPropertyDescriptor(bridge, 'postMessage')
    const state = { original: internals.invoke, originalPost: bridge.postMessage, bridge, descriptor,
      armed: false, injected: false, ids: [], imports: [], rejectedPreviews: [], saves: [], starts: 0,
      phase: 'setup', removal: null, realCommit: null, interceptorError: null }
    window.__qaChatRecovery = state
    const reject = (message, detail) => internals.runCallback(message.error, { kind: 'Unexpected', message: detail })
    const wrapped = function (raw) {
      const message = JSON.parse(raw)
      const { cmd: command, payload: args } = message
      if (command === 'start_chat_job') ++state.starts
      if (command === 'save_chat_composer') state.saves.push({ phase: state.phase,
        attachmentIds: args.request.attachmentIds, composer: args.request.composer, at: performance.now() })
      if (command === 'get_attachment_preview_data_url' && state.ids.includes(args.attachmentId)) {
        state.rejectedPreviews.push(args.attachmentId)
        reject(message, 'Controlled IPC simulation: preview read unavailable for the committed uncertain image')
        return
      }
      if (command === 'import_chat_image') {
        state.imports.push({ filename: args.filename, at: performance.now() })
        if (state.armed && !state.injected) {
          state.original.call(internals, 'get_chat', { sessionId: args.scope.sessionId }).then(before => {
            internals.callbacks.set(message.callback, saved => {
              const previous = new Set(before.composerImages.map(image => image.attachmentId))
              state.ids = saved.composerImages.filter(image => !previous.has(image.attachmentId)).map(image => image.attachmentId)
              state.realCommit = { draftId: saved.draftId, revision: saved.revision, attachmentIds: saved.composerImages.map(image => image.attachmentId) }
              state.injected = true
              state.phase = 'committed-response-lost'
              internals.unregisterCallback(message.callback)
              reject(message, 'Controlled IPC simulation: success callback replaced after the REAL backend committed this import')
            })
            state.originalPost.call(bridge, raw)
          }).catch(error => {
            state.interceptorError = String(error)
            reject(message, 'The controlled IPC harness could not observe the real import')
          })
          return
        }
      }
      return state.originalPost.call(bridge, raw)
    }
    Object.defineProperty(bridge, 'postMessage', { value: wrapped, configurable: true, writable: true })
    if (window.webkit.messageHandlers.ipc.postMessage !== wrapped) throw new Error('The native message handler did not retain the interceptor')
  })
}

async function faultState(restore = false) {
  return browser.execute(restore => {
    const state = window.__qaChatRecovery
    if (!state) return null
    if (restore) {
      if (state.descriptor) Object.defineProperty(state.bridge, 'postMessage', state.descriptor)
      else delete state.bridge.postMessage
    }
    const receipt = { injected: state.injected, ids: state.ids, imports: state.imports, rejectedPreviews: state.rejectedPreviews,
      saves: state.saves, starts: state.starts, removal: state.removal,
      realCommit: state.realCommit, interceptorError: state.interceptorError, transport: 'WKWebView native IPC success callback replacement',
      invokeUnchanged: window.__TAURI_INTERNALS__.invoke === state.original,
      restored: window.webkit.messageHandlers.ipc.postMessage === state.originalPost && window.__TAURI_INTERNALS__.invoke === state.original }
    if (restore) delete window.__qaChatRecovery
    return receipt
  }, restore)
}

async function resize(width) {
  await browser.setWindowSize(1280, 860)
  const base = await settledViewport()
  const scale = 1280 / base.width
  const request = { width: Math.round(width * scale), height: Math.round(860 * scale) }
  const attempts = []
  for (let index = 0; index < 5; ++index) {
    await browser.setWindowSize(request.width, request.height)
    const actual = await settledViewport()
    attempts.push({ request: { ...request }, actual })
    if (Math.abs(actual.width - width) <= 2) return { requestedCssWidth: width, actual, attempts }
    request.width += Math.round((width - actual.width) * scale)
  }
  assert.fail(`Native viewport could not reach ${width} CSS pixels: ${JSON.stringify(attempts)}`)
}

async function geometry(appearance, width, evidence) {
  const window = await resize(width)
  const targets = await browser.execute(selector => [...document.querySelectorAll(`${selector} button`)].map(node => node.textContent.trim()), failures)
  assert.equal(targets.length, 3)
  for (const [index, label] of targets.entries()) {
    const target = await $(actionSelector(label))
    await target.scrollIntoView({ block: 'center', inline: 'nearest' })
    const measured = await browser.execute(label => {
      const button = [...document.querySelectorAll('[aria-label="Failed images"] button')].find(node => node.textContent.trim() === label)
      const panel = document.querySelector('[aria-label="Failed images"]')
      const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
      const r = rect(button)
      const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      for (let parent = button.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), p = rect(parent)
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clip.left = Math.max(clip.left, p.left + parent.clientLeft); clip.right = Math.min(clip.right, p.left + parent.clientLeft + parent.clientWidth) }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clip.top = Math.max(clip.top, p.top + parent.clientTop); clip.bottom = Math.min(clip.bottom, p.top + parent.clientTop + parent.clientHeight) }
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
        documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        panel: rect(panel), button: r, clip, clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
        text: button.textContent, whiteSpace: getComputedStyle(button).whiteSpace,
        centerHit: Boolean(hit && button.contains(hit)), disabled: button.disabled }
    }, label)
    const screenshot = join(artifacts, `chat-image-recovery-${appearance}-${width}-action-${index}.png`)
    await browser.saveScreenshot(screenshot)
    evidence.geometry.push({ appearance, width, window, label, screenshot, ...measured })
    writeFileSync(join(artifacts, 'chat-image-recovery-evidence.json'), `${JSON.stringify({ status: 'running', results }, null, 2)}\n`)
    assert.equal(measured.theme, appearance)
    assert.ok(measured.documentWidth <= measured.viewport.width + 2 && measured.bodyWidth <= measured.viewport.width + 2, 'Failure panel must not widen the native page')
    assert.ok(measured.button.left >= measured.panel.left - 2 && measured.button.right <= measured.panel.right + 2, 'Long action labels must stay within the failure panel')
    assert.ok(measured.scrollWidth <= measured.clientWidth + 2, 'The complete long action label must wrap without horizontal clipping')
    assert.ok(measured.button.top >= measured.clip.top - 2 && measured.button.bottom <= measured.clip.bottom + 2 && measured.centerHit, 'Each recovery action must be visible and hit-testable after ordinary scrolling')
    assert.equal(measured.disabled, false)
  }
}

async function theme(appearance) {
  await resize(1280)
  await click('Settings')
  await $('[aria-label="Theme"]').waitForDisplayed()
  await click(appearance === 'light' ? 'Light' : 'Dark')
  await browser.waitUntil(() => browser.execute(value => document.documentElement.dataset.theme === value, appearance))
  await click('Back')
}

async function recovery(appearance) {
  assert.ok(directory && artifacts && dataDirectory, 'Run this spec through scripts/run-e2e.mjs with isolated data')
  const evidence = { appearance, status: 'failed', simulation: 'Controlled IPC errors around a real durable backend import',
    fileInput: 'DOM FileList/change contract', osClipboard: 'not-exercised', osIpcFailure: 'not-exercised',
    geometry: [], fault: null, error: null }
  results.push(evidence)
  try {
    await theme(appearance)
    await click('New Session')
    const title = `E2E Chat image recovery ${appearance}`
    await $('[aria-label="Session title"]').setValue(title)
    await browser.waitUntil(async () => (await read('list_sessions')).some(session => session.title === title))
    const sessionId = (await read('list_sessions')).find(session => session.title === title).id
    evidence.sessionId = sessionId
    await click('Chat')
    await click('Configure AI')
    await $('[aria-label="Refresh CLI configuration"]').waitForClickable()
    await $('[aria-label="Refresh CLI configuration"]').click()
    assert.ok((await read('refresh_provider_status')).providers.find(provider => provider.id === 'codex_cli')?.available)
    await click('Back')
    await $(composer).waitForDisplayed()
    await $(composer).setValue(text)
    await installFault()
    await stage('existing-image-a.png')
    await browser.waitUntil(async () => (await read('get_chat', { sessionId })).composerImages.length === 1)
    const imageA = (await read('get_chat', { sessionId })).composerImages[0]
    await saved(sessionId, [imageA.attachmentId])
    assert.equal((await faultState()).imports.length, 1, 'The fault probe must observe real import A before arming simulated response loss')
    await browser.waitUntil(() => browser.execute(selector => document.querySelector(`${selector} img`)?.naturalWidth === 2, attached))
    evidence.before = database(sessionId)
    assert.equal(evidence.before.schemaVersion, 19)
    assert.deepEqual(evidence.before.composerIds, [imageA.attachmentId])
    assert.equal(evidence.before.files[0].sha256, imageFixture.sha256)
    await browser.execute(() => { window.__qaChatRecovery.armed = true })
    await stage(filename)
    await $(failures).waitForDisplayed()
    await browser.waitUntil(async () => (await faultState()).rejectedPreviews.length > 0)
    await $(actionSelector(`Remove unverified ${filename}`)).waitForEnabled()
    const pending = await faultState()
    assert.equal(pending.injected, true)
    assert.equal(pending.invokeUnchanged, true)
    assert.equal(pending.interceptorError, null)
    assert.equal(pending.ids.length, 1)
    const [imageB] = pending.ids
    assert.notEqual(imageB, imageA.attachmentId)
    assert.deepEqual(pending.imports.map(value => value.filename), ['existing-image-a.png', filename])
    evidence.committed = database(sessionId)
    assert.deepEqual(evidence.committed.composerIds, [imageA.attachmentId, imageB])
    assert.deepEqual(pending.realCommit.attachmentIds, evidence.committed.composerIds)
    assert.equal(evidence.committed.attachments.length, 2)
    assert.equal(evidence.committed.pendingImports, 0)
    const bRow = evidence.committed.attachments.find(row => row.id === imageB)
    assert.equal(evidence.committed.files.find(file => file.relativePath === bRow.relative_path).sha256, imageFixture.sha256)
    assert.equal(await $(`${attached} [data-attachment-id="${imageB}"] .chat-image-status`).getText(), 'Verification pending')
    assert.equal(await $(`${attached} [data-attachment-id="${imageA.attachmentId}"] .chat-image-status`).getText(), 'Ready to send')
    assert.equal(await $('button=Send').isEnabled(), false)
    await browser.execute(selector => {
      document.querySelector(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    }, composer)
    await geometry(appearance, 360, evidence)
    await geometry(appearance, 768, evidence)
    const retry = await $(actionSelector(`Retry ${filename}`))
    const rejectedBeforeRetry = (await faultState()).rejectedPreviews.length
    await retry.scrollIntoView({ block: 'center' })
    await retry.click()
    await browser.waitUntil(async () => (await faultState()).rejectedPreviews.length > rejectedBeforeRetry
      && await $(actionSelector(`Remove failed ${filename}`)).isEnabled())
    assert.equal((await faultState()).imports.length, 2, 'Retry must recheck the committed image without importing again')
    assert.equal(await $('button=Send').isEnabled(), false)
    await browser.execute(name => {
      const find = label => [...document.querySelectorAll('[aria-label="Failed images"] button')].find(node => node.textContent.trim() === label)
      const remove = find(`Remove unverified ${name}`), dismiss = find(`Remove failed ${name}`)
      if (!remove || !dismiss || remove.disabled || dismiss.disabled) throw new Error('Explicit recovery removal actions must be enabled')
      const state = window.__qaChatRecovery
      state.phase = 'thumbnail-removal'
      const removedAt = performance.now()
      remove.click()
      state.phase = 'dismiss-clicked'
      dismiss.click()
      state.removal = { removedAt, dismissedAt: performance.now() }
    }, filename)
    await $(failures).waitForExist({ reverse: true })
    evidence.canonical = await saved(sessionId, [imageA.attachmentId])
    assert.equal(await $(composer).getValue(), text)
    await $('button=Send').waitForEnabled()
    const finalFault = await faultState()
    assert.ok(finalFault.removal.dismissedAt - finalFault.removal.removedAt < 500, 'Explicit Remove failed must precede the 500 ms autosave debounce')
    assert.ok(finalFault.saves.some(save => save.phase === 'dismiss-clicked' && save.composer === text
      && JSON.stringify(save.attachmentIds) === JSON.stringify([imageA.attachmentId])), 'The explicit failed-operation removal must persist only the intentional image A')
    assert.equal(finalFault.imports.length, 2)
    assert.equal(finalFault.starts, 0)
    assert.deepEqual([...new Set(finalFault.rejectedPreviews)], [imageB])
    evidence.after = database(sessionId, [bRow.relative_path])
    assert.deepEqual(evidence.after.attachments, evidence.before.attachments)
    assert.deepEqual(evidence.after.composerIds, [imageA.attachmentId])
    assert.equal(evidence.after.files.find(file => file.relativePath === bRow.relative_path).exists, false)
    assert.deepEqual(evidence.after.files.find(file => file.relativePath === evidence.before.attachments[0].relative_path), evidence.before.files[0])
    assert.equal(evidence.after.aiRunCount, 0)
    assert.equal(evidence.after.messageCount, 0)
    assert.equal(evidence.after.pendingImports, 0)
    assert.deepEqual(evidence.after.pendingCleanup, [])
    assert.deepEqual(evidence.after.foreignKeyViolations, [])
    assert.deepEqual(executions(), [])
    evidence.status = 'passed'
  } catch (error) {
    evidence.error = error.stack ?? error.message
    throw error
  } finally {
    evidence.fault = await faultState(true)
    if (evidence.fault) assert.equal(evidence.fault.restored, true, 'Restore the exact native message handler and preserve the original IPC invoke function')
    writeFileSync(join(artifacts, 'chat-image-recovery-evidence.json'), `${JSON.stringify({
      status: results.length === 2 && results.every(result => result.status === 'passed') ? 'passed' : 'incomplete-or-failed', results }, null, 2)}\n`)
  }
}

describe('Built application image recovery with controlled IPC errors, without OS clipboard or OS-failure claims', () => {
  for (const appearance of ['light', 'dark']) {
    it(`resolves the committed uncertain image in ${appearance} theme while preserving image A and exact text`, () => recovery(appearance)).timeout(75_000)
  }
})
