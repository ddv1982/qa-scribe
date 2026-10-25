import assert from 'node:assert/strict'
import { inspectLayout } from './chat-layout-geometry.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, database, directory, execution, finishChat, journal, providerIds, read, settings } from './model-evidence-ui.mjs'

export const quickSection = '[aria-label="Next invocation model"]'
export const quickInput = `${quickSection} [role="combobox"][aria-label="Model"]`
export const outputRoot = process.env.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? '/tmp/qa-models/M03'

export async function modelPreference(provider, model) {
  const section = await quickScope()
  const input = await $(`${section} [role="combobox"][aria-label="Model"]`)
  await input.waitForEnabled()
  if (await input.getAttribute('aria-expanded') !== 'true') await $(`${section} [aria-label="Open model choices"]`).click()
  if (model !== null && model !== 'auto') await input.setValue(model)
  const label = model === null ? 'CLI default' : model === 'auto' ? 'CLI automatic' : 'Use custom model'
  let target
  await browser.waitUntil(async () => {
    for (const option of await quickOptions()) {
      if (await (await option.$('strong')).getText() === label) { target = option; return true }
    }
    return false
  }, { timeout: 5_000, timeoutMsg: `Missing quick model choice ${label}` })
  await target.click()
  await browser.waitUntil(async () => {
    const current = await read('get_settings')
    return (current.selectedAiModelsByProvider?.[providerIds[provider]] ?? null) === model
      && await input.isEnabled()
      && !(await $(section).getText()).includes('Saving model preference…')
  }, { timeout: 7_000, timeoutMsg: 'Quick model selection did not persist through the shared Settings owner' })
  assert.match(await $(section).getText(), /Saved for this provider across QA Scribe\. Changes affect the next invocation\./)
}

export async function send(sessionId, provider, mode, marker) {
  execution(provider, mode, marker)
  const before = journal().length
  const runCount = database(sessionId).runs.length
  await $('[aria-label="Session chat"] textarea').setValue(`Synthetic selection check ${marker}.`)
  await click('Send')
  await browser.waitUntil(() => database(sessionId).runs.length > runCount, { timeout: 15_000 })
  const terminal = await finishChat(sessionId)
  const observations = journal().slice(before)
  const starts = observations.filter((entry) => entry.event === 'execution')
  assert.equal(starts.length, 1)
  const ids = [...new Set(terminal.chat.messages.flatMap((message) => message.aiRunId ? [message.aiRunId] : []))].sort()
  assert.deepEqual(terminal.chat.aiRuns.map((run) => run.id).sort(), ids,
    'Historical projection must contain exactly the current draft linked AI Runs')
  assert.deepEqual(terminal.chat.aiRuns.find((run) => run.id === terminal.row.id)?.modelSelection, terminal.row.selection)
  return { ...terminal, observations, argv: starts[0].argv }
}

export async function generation(sessionId, provider, model, marker) {
  execution(provider, provider === 'codex' ? 'missing' : 'init', marker)
  await click('Summarize with AI')
  await $('dialog.generation-preflight[open]').waitForDisplayed()
  const details = await $('dialog.generation-preflight .preflight-execution-details')
  if (!await browser.execute(node => node.open, details)) await (await details.$('summary')).click()
  await modelPreference(provider, model)
  const summary = await $('.preflight-execution-summary').getText()
  const modelRow = await browser.execute(() => {
    const row = Array.from(document.querySelectorAll('dialog.generation-preflight[open] .preflight-list > div'))
      .find((element) => element.querySelector('dt')?.textContent === 'Model')
    const value = row?.querySelector('dd')
    return value ? { text: value.textContent.trim(),
      model: Array.from(value.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim() } : null
  })
  assert.ok(modelRow, 'Preflight must expose its Model row')
  if (model) assert.equal(modelRow.model, model, 'Preflight must display the literal model it will launch')
  const before = journal().length
  const runCount = database(sessionId).runs.length
  const confirm = await (await $('dialog.generation-preflight[open]')).$('button=Summarize note')
  await confirm.waitForClickable()
  await confirm.click()
  await browser.waitUntil(() => database(sessionId).runs.length > runCount && database(sessionId).runs.at(-1)?.status === 'completed', { timeout: 20_000 })
  await $('button=Summarize with AI').waitForClickable()
  const observations = journal().slice(before)
  const starts = observations.filter((entry) => entry.event === 'execution')
  assert.equal(starts.length, 1)
  return { sessionId, row: database(sessionId).runs.at(-1), observations, argv: starts[0].argv, summary, modelRow }
}

export async function historyText() {
  const texts = []
  for (const element of await $$('.chat-model-evidence')) texts.push(await element.getText())
  return texts
}

async function quickScope() {
  const modal = `dialog.generation-preflight[open] ${quickSection}`
  return await $(modal).isExisting() ? modal : quickSection
}

export async function quickOptions() {
  const section = await quickScope()
  const id = await $(`${section} [role="combobox"][aria-label="Model"]`).getAttribute('aria-controls')
  return id ? $$(`[id="${id}"] [role="option"]`) : []
}

export async function menuGeometry() {
  const section = await quickScope()
  const id = await $(`${section} [role="combobox"][aria-label="Model"]`).getAttribute('aria-controls')
  if (!id) return null
  const geometry = await browser.execute(inspectLayout, `[id="${id}"]`, '.model-combobox-popover')
  if (!geometry) return null
  const panel = await browser.execute(inspectLayout, '.ask-ai-panel:not([hidden])')
  const rows = []
  for (const option of await quickOptions()) rows.push(await browser.execute(inspectLayout, option))
  const viewport = await browser.execute(() => ({ width: innerWidth, height: innerHeight }))
  return { ...geometry.rect, viewportWidth: viewport.width, viewportHeight: viewport.height, options: rows.length,
    visible: geometry.visible, clip: geometry.clip, rows, panel: panel?.rect ?? null }
}

export function configureCatalog(provider, mode) {
  const path = join(directory, 'model-management.json')
  const configuration = JSON.parse(readFileSync(path, 'utf8'))
  configuration[provider] = mode
  writeFileSync(path, JSON.stringify(configuration))
}


export async function switchProviderOnly(provider, expectedModels) {
  await settings()
  assert.ok(await browser.execute((value) => {
    const select = document.querySelector('[aria-label="Default AI provider"]')
    const option = Array.from(select.options).find((entry) => entry.value === value)
    if (!option || option.disabled || select.disabled) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === value
  }, providerIds[provider]), 'Provider-only restore proof must use the enabled native Settings control')
  const save = await $('button=Save settings')
  await browser.waitUntil(async () => await save.getAttribute('aria-busy') !== 'true')
  if (await save.isEnabled()) {
    assert.equal(await $('button=Discard changes').isDisplayed(), true, 'A dirty Settings draft must offer Discard changes')
    await save.click()
    const saved = await $('.settings-save-feedback [role="status"]')
    await browser.waitUntil(async () => await saved.isDisplayed() && await saved.getText() === 'Saved' && !await save.isEnabled())
  }
  await browser.waitUntil(async () => (await read('get_settings')).selectedAiProvider === providerIds[provider]
    && !await $('button=Discard changes').isExisting())
  assert.equal(await save.getText(), 'Save settings')
  assert.equal(await save.isEnabled(), false, 'A clean Settings Save must be disabled')
  assert.deepEqual((await read('get_settings')).selectedAiModelsByProvider, expectedModels,
    'Changing only the provider must preserve every restored model choice')
  await click('Back')
}

export async function attachPickerDraftImage(sessionId) {
  const bytes = [...readFileSync(new URL('../fixtures/chat-image-pixels.png', import.meta.url))]
  await browser.execute(bytes => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'catalog-draft.png', { type: 'image/png' }))
    const target = document.querySelector('input[aria-label="Choose chat images"]')
    target.files = transfer.files
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, bytes)
  await browser.waitUntil(async () => (await read('get_chat', { sessionId })).composerImages.length === 1,
    { timeout: 7_000, timeoutMsg: 'The local fixture image must become durable before picker checks' })
  await browser.waitUntil(() => browser.execute(() => {
    const image = document.querySelector('[aria-label="Attached images"] img')
    return Boolean(image?.complete && image.naturalWidth)
  }), { timeout: 5_000, timeoutMsg: 'The retained local image must finish loading before geometry checks' })
  return read('get_chat', { sessionId })
}

export async function openQuickPicker() {
  if (await $(quickInput).getAttribute('aria-expanded') !== 'true') await $(`${quickSection} [aria-label="Open model choices"]`).click()
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
}

export async function pickerState() {
  return browser.execute(selector => {
    const input = document.querySelector(selector)
    const list = document.getElementById(input.getAttribute('aria-controls'))
    const popup = list?.closest('.model-combobox-popover')
    const hint = popup?.querySelector('.model-search-hint')
    const owners = []
    for (let node = input.parentElement; node; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) owners.push({ class: node.className, scrollTop: node.scrollTop,
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })
      if (node.matches('.ask-ai-panel')) break
    }
    const rect = node => {
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width }
    }
    const lines = []
    if (hint) {
      const walker = document.createTreeWalker(hint, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(walker.currentNode)
        for (const line of range.getClientRects()) if (line.width > 0 && line.height > 0) lines.push(rect({ getBoundingClientRect: () => line }))
      }
    }
    return { expanded: input.getAttribute('aria-expanded'), focused: document.activeElement === input, query: input.value,
      input: rect(input), panel: rect(input.closest('.ask-ai-panel')), owners, activeId: input.getAttribute('aria-activedescendant'),
      visibility: popup ? getComputedStyle(popup).visibility : null, popup: rect(popup), hint: rect(hint), hintText: hint?.textContent,
      hintLines: lines.length, count: list?.children.length, listScrollTop: list?.scrollTop }
  }, quickInput)
}

export async function activeQuickOption() {
  const id = await $(quickInput).getAttribute('aria-activedescendant')
  assert.ok(id, 'Keyboard navigation must identify an active option')
  return browser.execute(inspectLayout, `[id="${id}"]`)
}

export async function domModelKey(key) {
  await browser.execute((selector, key) => document.querySelector(selector)
    .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })), quickInput, key)
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
}
