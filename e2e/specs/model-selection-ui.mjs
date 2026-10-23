import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, database, directory, execution, finishChat, journal, providerIds, read, settings } from './model-evidence-ui.mjs'

export const quickSection = '[aria-label="Next invocation model"]'
export const quickInput = `${quickSection} [role="combobox"][aria-label="Model"]`
export const outputRoot = process.env.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? '/tmp/qa-models/M03'

export async function modelPreference(provider, model) {
  const input = await $(quickInput)
  await input.waitForEnabled()
  if (await input.getAttribute('aria-expanded') !== 'true') await $(`${quickSection} [aria-label="Open model choices"]`).click()
  if (model !== null && model !== 'auto') await input.setValue(model)
  const label = model === null ? 'CLI default' : model === 'auto' ? 'CLI automatic' : 'Use custom model'
  let target
  await browser.waitUntil(async () => {
    for (const option of await $$(`${quickSection} [role="option"]`)) {
      if (await (await option.$('strong')).getText() === label) { target = option; return true }
    }
    return false
  }, { timeout: 5_000, timeoutMsg: `Missing quick model choice ${label}` })
  await target.click()
  await browser.waitUntil(async () => {
    const current = await read('get_settings')
    return (current.selectedAiModelsByProvider?.[providerIds[provider]] ?? null) === model
      && await $(quickInput).isEnabled()
      && !(await $(quickSection).getText()).includes('Saving model preference…')
  }, { timeout: 7_000, timeoutMsg: 'Quick model selection did not persist through the shared Settings owner' })
  assert.match(await $(quickSection).getText(), /Saved for this provider across QA Scribe\. Changes affect the next invocation\./)
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
  await click('Summarize notes')
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
  await $('button=Summarize notes').waitForClickable()
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

export async function menuGeometry() {
  return browser.execute((section) => {
    const menu = document.querySelector(`${section} .model-combobox-popover`)
    const bounds = menu?.getBoundingClientRect()
    return bounds ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
      width: bounds.width, height: bounds.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
      options: menu.querySelectorAll('[role="option"]').length } : null
  }, quickSection)
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
