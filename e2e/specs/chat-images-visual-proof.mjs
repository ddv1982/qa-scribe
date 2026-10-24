import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'
import { settledViewport } from './preflight-native-keys.mjs'

const composer = '[aria-label="Session chat"] textarea'
const attached = '[aria-label="Attached images"]'
const sourceName = `visual-proof-${'checkout-validation-'.repeat(6)}雪-literal-evidence.png`
const longName = `visual-proof-${'checkout-validation-'.repeat(6)}_-literal-evidence.png`
const names = [longName, 'visual-proof-second.png', 'visual-proof-third.png', 'visual-proof-fourth.png']
const message = 'Unsent visual probe. 雪 <literal> & evidence [keep](unchanged).\nRetain this exact message when the screenshot is removed.'

async function readChat(sessionId) {
  return browser.execute(id => window.__TAURI_INTERNALS__.invoke('get_chat', { sessionId: id }), sessionId)
}

async function click(label) {
  const button = await $(`button=${label}`)
  await button.waitForClickable()
  await button.click()
}

async function saved(sessionId, text, filenames) {
  await browser.waitUntil(async () => {
    const chat = await readChat(sessionId)
    return chat.composer === text && JSON.stringify(chat.composerImages.map(image => image.filename)) === JSON.stringify(filenames)
      && await browser.execute(() => document.querySelector('.chat-meta [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 7_000, timeoutMsg: 'Visual probe composer and ordered image references must save' })
}

async function stage(filenames) {
  await browser.execute((bytes, filenames) => {
    const transfer = new DataTransfer()
    for (const filename of filenames) transfer.items.add(new File([new Uint8Array(bytes)], filename, { type: 'image/png' }))
    const input = document.querySelector('input[aria-label="Choose chat images"]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, [...readFileSync(imageFixture.path)], filenames)
}

async function geometry() {
  return browser.execute(() => {
    const rect = node => {
      const r = node.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const measure = node => {
      if (!node) return null
      const r = rect(node)
      const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      const ancestors = []
      const dialog = node.closest('dialog[open]')
      for (let parent = node === dialog ? null : node.parentElement; parent; parent = parent === dialog ? null : parent.parentElement) {
        const style = getComputedStyle(parent)
        const p = rect(parent)
        const x = /(auto|scroll|hidden|clip)/.test(style.overflowX)
        const y = /(auto|scroll|hidden|clip)/.test(style.overflowY)
        if (x) { clip.left = Math.max(clip.left, p.left + parent.clientLeft); clip.right = Math.min(clip.right, p.left + parent.clientLeft + parent.clientWidth) }
        if (y) { clip.top = Math.max(clip.top, p.top + parent.clientTop); clip.bottom = Math.min(clip.bottom, p.top + parent.clientTop + parent.clientHeight) }
        if (x || y) ancestors.push({ className: parent.className, rect: p, scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight })
      }
      const style = getComputedStyle(node)
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { rect: r, clip, ancestors, fullyVisible: r.width > 0 && r.height > 0 && r.left >= clip.left - 2 && r.right <= clip.right + 2 && r.top >= clip.top - 2 && r.bottom <= clip.bottom + 2,
        visibleHeight: Math.max(0, Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top)),
        centerHit: Boolean(hit && node.contains(hit)), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        text: node.textContent, value: 'value' in node ? node.value : null, title: node.getAttribute('title'), disabled: 'disabled' in node ? node.disabled : null,
        style: { primaryFill: getComputedStyle(document.documentElement).getPropertyValue('--action-primary-fill').trim(), primaryText: getComputedStyle(document.documentElement).getPropertyValue('--action-primary-text').trim(), color: style.color, background: style.backgroundColor, fontSize: style.fontSize, lineHeight: style.lineHeight, overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace } }
    }
    const get = selector => measure(document.querySelector(selector))
    const buttons = document.querySelector('.chat-compose-actions .chat-buttons')
    const latest = document.querySelector('.chat-message-assistant:last-child')
    const attach = document.querySelector('button[aria-label="Attach images"]')
    return { viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, theme: document.documentElement.dataset.theme,
      documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      composer: get('.chat-composer'), shortcut: get('.chat-compose-actions > .chat-help'), textarea: get('[aria-label="Session chat"] textarea'),
      attach: measure(attach), send: measure(buttons && Array.from(buttons.querySelectorAll('button')).find(node => node.textContent.trim() === 'Send')),
      attachNextLabel: attach?.nextElementSibling?.textContent.trim(), latestAssistant: measure(latest),
      latestAssistantBody: measure(latest?.querySelector('.markdown-content') ?? latest?.querySelector('p')),
      images: Array.from(document.querySelectorAll('[aria-label="Attached images"] .chat-image'), node => ({ card: measure(node), name: measure(node.querySelector('.chat-image-name')), preview: measure(node.querySelector('.chat-image-preview')), remove: measure(node.querySelector('.chat-image-remove')) })),
      dialog: get('dialog[open]'), dialogHeading: get('dialog[open] h2'), dialogImage: get('dialog[open] > img'), dialogClose: get('button[aria-label="Close image preview"]') }
  })
}

export async function proveChatImagesVisual({ sessionId, include320 = false }) {
  const out = process.env.QA_SCRIBE_E2E_ARTIFACTS
  const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  assert.ok(out && fixture, 'Use the maintained Chat images E2E wrapper')
  const invocations = () => readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
  const evidence = { status: 'running', input: 'DOM FileList/change contract', nativeFileDialog: 'not-exercised', osClipboard: 'not-exercised', nativeKeyboard: 'not-exercised', nativeWindowResize: true, cases: [], failures: [], blocked: [] }
  const persist = () => writeFileSync(join(out, 'chat-images-visual-proof.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  const check = (condition, description) => { if (!condition) evidence.failures.push(description) }
  const capture = async label => {
    const value = await geometry()
    const screenshot = join(out, `chat-images-visual-${label}.png`)
    await browser.saveScreenshot(screenshot)
    evidence.cases.push({ label, screenshot, ...value })
    persist()
    return value
  }
  const baseline = await readChat(sessionId)
  const started = invocations()
  const initialTheme = await browser.execute(() => ({ preference: localStorage.getItem('qa-scribe-theme'), resolved: document.documentElement.dataset.theme }))
  evidence.initialTheme = initialTheme
  assert.equal(baseline.messages.length, 2)
  assert.ok(baseline.messages.every(item => item.status === 'completed'))
  assert.equal(baseline.composer, '')
  assert.deepEqual(baseline.composerImages, [])
  assert.equal(started, 1)
  let inSettings = false
  let scale = 1
  async function resize(width) {
    await browser.setWindowSize(1280, 860)
    const base = await settledViewport()
    scale = 1280 / base.width
    let request = { width: Math.round(width * scale), height: Math.round(860 * scale) }
    const attempts = []
    for (let index = 0; index < 5; index++) {
      await browser.setWindowSize(request.width, request.height)
      const actual = await settledViewport()
      attempts.push({ request: { ...request }, actual })
      if (Math.abs(actual.width - width) <= 2) return { requestedCssWidth: width, nominalNativeHeight: 860, attempts, actual }
      request.width += Math.round((width - actual.width) * scale)
      if (request.width <= 0) break
    }
    evidence.blocked.push({ requestedCssWidth: width, reason: 'Native window did not reach the requested CSS width', attempts })
    persist()
    return null
  }
  async function theme(value) {
    assert.ok(await resize(1280), 'Settings requires the 1280 CSS pixel viewport')
    if (!inSettings) { await click('Settings'); inSettings = true }
    await $('[aria-label="Theme"]').waitForDisplayed()
    await click(value[0].toUpperCase() + value.slice(1))
    await browser.waitUntil(() => browser.execute(value => localStorage.getItem('qa-scribe-theme') === value, value))
    await click('Back')
    inSettings = false
    await $(composer).waitForDisplayed()
    await settledViewport()
  }
  async function pixels() {
    await browser.waitUntil(() => browser.execute(() => {
      const images = Array.from(document.querySelectorAll('[aria-label="Attached images"] img'))
      return images.length > 0 && images.every(image => image.complete && image.naturalWidth === 2 && image.naturalHeight === 2)
    }), { timeout: 5_000, timeoutMsg: 'Visual probe managed thumbnails must finish loading' })
  }
  function horizontal(value, label) {
    check(value.documentWidth <= value.viewport.width + 2 && value.bodyWidth <= value.viewport.width + 2, `${label} has no page-level horizontal overflow`)
    for (const [name, target] of [['textarea', value.textarea], ['paperclip', value.attach], ['Send', value.send]]) {
      check(target?.rect.left >= -2 && target?.rect.right <= value.viewport.width + 2, `${label} ${name} stays within the window width`)
      check(target?.rect.left >= value.composer.rect.left - 2 && target?.rect.right <= value.composer.rect.right + 2, `${label} ${name} stays within the composer width`)
    }
    check(value.send.style.primaryFill === '#2456c4' && value.send.style.primaryText === '#ffffff', `${label} primary action uses the shared blue and white treatment`)
    check(value.shortcut.rect.right <= value.attach.rect.left + 2 || value.shortcut.rect.bottom <= value.attach.rect.top + 2, `${label} keyboard help does not overlap action controls`)
    check(value.attachNextLabel === 'Send', `${label} paperclip is immediately before Send`)
    check(Math.abs(value.attach.rect.top - value.send.rect.top) <= 2 && value.attach.rect.right <= value.send.rect.left, `${label} paperclip stays immediately left of Send on the same row`)
    check(value.textarea.rect.bottom <= Math.min(value.attach.rect.top, value.send.rect.top) + 2, `${label} textarea and action controls do not overlap`)
    for (const image of value.images) {
      check(image.card.rect.right <= value.composer.rect.right + 2 && image.card.rect.left >= value.composer.rect.left - 2, `${label} thumbnail stays within the composer`)
      check(image.name.scrollWidth > image.name.clientWidth ? image.name.style.textOverflow === 'ellipsis' && image.name.style.whiteSpace === 'nowrap' : true, `${label} long filename truncates with ellipsis`)
      check(image.remove.rect.right <= image.card.rect.right + 2 && image.remove.rect.left >= image.card.rect.left - 2, `${label} removal control stays inside its thumbnail`)
    }
  }
  async function reach(selector, label) {
    await $(selector).scrollIntoView({ block: 'center', inline: 'nearest' })
    const value = await capture(label)
    return value
  }
  async function clear() {
    if (await $('dialog[open]').isExisting()) await $('[aria-label="Close image preview"]').click()
    while (await $(`${attached} .chat-image-remove`).isExisting()) {
      const remove = await $(`${attached} .chat-image-remove`)
      await remove.scrollIntoView({ block: 'center', inline: 'nearest' })
      await remove.waitForClickable()
      await remove.click()
    }
    await $(composer).setValue('')
    await saved(sessionId, '', [])
  }
  try {
    await settledViewport()
    const first = await capture('initial-before-any-manual-scroll')
    check(first.latestAssistantBody?.fullyVisible, 'Completed latest assistant text is visible before any helper scroll or resize')
    for (const appearance of ['light', 'dark']) {
      await theme(appearance)
      for (const width of [1280, 768, 360, ...(include320 ? [320] : [])]) {
        const label = `${appearance}-${width}`
        const window = await resize(width)
        if (!window) continue
        evidence.cases.push({ label: `${label}-native-resize`, ...window })
        const empty = await capture(`${label}-empty-before-manual-scroll`)
        check(empty.latestAssistantBody?.fullyVisible, `${label} latest assistant text is visible on return to Chat`)
        await $(composer).setValue(message)
        const text = await reach(composer, `${label}-literal-textarea`)
        check(text.textarea.fullyVisible && text.textarea.centerHit, `${label} textarea remains reachable with the literal message`)
        await stage([sourceName])
        await saved(sessionId, message, [longName])
        await pixels()
        const single = await reach('button[aria-label="Attach images"]', `${label}-one-send`)
        horizontal(single, label)
        check(single.attach.fullyVisible && single.send.fullyVisible && single.attach.centerHit && single.send.centerHit, `${label} paperclip and Send are reachable`)
        check(single.images[0]?.name.text === longName && single.images[0]?.name.title === longName && single.images[0]?.name.scrollWidth > single.images[0]?.name.clientWidth, `${label} retains the exact long filename and exercises truncation`)
        await $(`${attached} .chat-image-preview`).scrollIntoView({ block: 'center', inline: 'nearest' })
        await $(`${attached} .chat-image-preview`).click()
        await $('dialog[open]').waitForDisplayed()
        await browser.waitUntil(() => browser.execute(() => document.querySelector('dialog[open] > img')?.complete === true))
        const preview = await capture(`${label}-long-name-preview`)
        check(preview.dialog.fullyVisible && preview.dialogHeading.fullyVisible && preview.dialogClose.fullyVisible && preview.dialogClose.centerHit && preview.dialogImage.fullyVisible, `${label} long-name preview, pixels, and Close fit in the window`)
        check(preview.dialogHeading.text === longName, `${label} preview exposes the complete filename`)
        await $('[aria-label="Close image preview"]').click()
        await $('dialog[open]').waitForExist({ reverse: true })
        await stage(names.slice(1))
        await saved(sessionId, message, names)
        await pixels()
        const four = await reach('button[aria-label="Attach images"]', `${label}-four-send`)
        horizontal(four, `${label} four images`)
        check(four.images.length === 4 && four.attach.disabled && !four.send.disabled, `${label} four images reach the attachment limit without disabling Send`)
        check(four.send.fullyVisible && four.send.centerHit, `${label} Send remains reachable with four thumbnails`)
        for (let index = 0; index < names.length; index++) {
          const remove = await $(`${attached} .chat-image-remove`)
          await remove.scrollIntoView({ block: 'center', inline: 'nearest' })
          const before = await capture(`${label}-remove-${index + 1}`)
          check(before.images[0]?.remove.fullyVisible && before.images[0]?.remove.centerHit && before.images[0]?.preview.fullyVisible, `${label} thumbnail ${index + 1} can be reviewed and removed`)
          await remove.waitForClickable()
          await remove.click()
          await saved(sessionId, message, names.slice(index + 1))
          check(await $(composer).getValue() === message, `${label} removing thumbnail ${index + 1} preserves the literal unsent message`)
        }
        await clear()
        check(invocations() === started, `${label} visual probes do not start another provider`)
      }
    }
    evidence.status = evidence.failures.length || evidence.blocked.length ? 'failed' : 'passed'
  } catch (error) {
    evidence.status = 'failed'
    evidence.error = String(error.stack ?? error)
    throw error
  } finally {
    try {
      assert.ok(await resize(1280), 'Cleanup must restore the 1280 CSS pixel viewport')
      if (inSettings) { await click('Back'); inSettings = false }
      await clear()
      await theme(['light', 'dark', 'system'].includes(initialTheme.preference) ? initialTheme.preference : initialTheme.resolved)
      const final = await readChat(sessionId)
      evidence.restored = { viewport: await settledViewport(), theme: await browser.execute(() => localStorage.getItem('qa-scribe-theme')), messages: final.messages.length, composer: final.composer, composerImages: final.composerImages.length, invocations: invocations() }
      assert.deepEqual(final.messages, baseline.messages, 'Visual probes must preserve the two original completed messages and managed image')
      assert.equal(final.draftId, baseline.draftId)
      assert.equal(final.composer, '')
      assert.deepEqual(final.composerImages, [])
      assert.equal(invocations(), started, 'Visual probes must preserve the original provider invocation count')
      await capture('restored-1280-empty-composer')
    } catch (error) {
      evidence.status = 'failed'
      evidence.cleanupError = String(error.stack ?? error)
    }
    persist()
  }
  assert.equal(evidence.cleanupError, undefined, evidence.cleanupError)
  assert.deepEqual(evidence.blocked, [], 'Every required native width must be reached; inspect visual-proof JSON for actual dimensions')
  assert.deepEqual(evidence.failures, [], 'Inspect visual-proof JSON and matching screenshots for visual failures')
  return evidence
}
