import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
export const dataDirectory = process.env.QA_SCRIBE_E2E_APP_DATA_DIR
export const evidenceRoot = process.env.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? '/tmp/qa-models/M02'
export const providerIds = { claude: 'claude_code', codex: 'codex_cli', copilot: 'copilot_cli' }
const picker = '[role="combobox"][aria-label="Model"]'
const configurationPath = join(directory, 'model-management.json')
assert.ok(directory && dataDirectory && existsSync(configurationPath), 'Model evidence requires isolated native runner setup')

export function journal() {
  const path = join(directory, 'model-management-journal.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
}

export function execution(provider, mode, lane) {
  const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'))
  configuration.execution = { provider, case: mode, lane }
  writeFileSync(configurationPath, JSON.stringify(configuration))
}

export function database(sessionId) {
  const completed = spawnSync('python3', [join(process.cwd(), 'e2e/fixtures/model-evidence-database.py'), 'read',
    join(dataDirectory, 'qa-scribe.sqlite'), sessionId], { encoding: 'utf8', timeout: 5_000 })
  assert.equal(completed.status, 0, `SQLite diagnostic helper failed ${JSON.stringify({
    status: completed.status, signal: completed.signal ?? null, errorCode: completed.error?.code ?? null,
    stderr: String(completed.stderr ?? '').slice(0, 4096),
  })}`)
  return JSON.parse(completed.stdout)
}

export async function click(label) {
  if (['Configure AI', 'Start new conversation'].includes(label)) {
    const options = await $('.ask-ai-panel--notes .chat-options')
    if (await options.isExisting() && !await browser.execute(node => node.open, options)) await (await options.$('summary')).click()
  }
  const target = await $(label === 'Close Ask AI'
    ? '.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]' : `button=${label}`)
  await target.waitForClickable()
  await target.click()
}

export async function read(command, args = {}) {
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

export async function settings() {
  if (!await $('[aria-label="Refresh CLI configuration"]').isExisting()) await click('Settings')
  await $('[aria-label="Default AI provider"]').waitForEnabled()
}

export async function refresh() {
  await $('[aria-label="Refresh CLI configuration"]').click()
  await $('.execution-overview.refreshing').waitForExist({ timeout: 5_000 })
  await $('.execution-overview.refreshing').waitForExist({ reverse: true, timeout: 25_000 })
}

async function optionNamed(label) {
  for (const option of await $$('[aria-label="AI models"] [role="option"]')) {
    if (await (await option.$('strong')).getText() === label) return option
  }
  assert.fail(`No rendered model option named ${label}`)
}

export async function preference(provider, model) {
  await settings()
  assert.ok(await browser.execute((value) => {
    const select = document.querySelector('[aria-label="Default AI provider"]')
    const option = Array.from(select.options).find((entry) => entry.value === value)
    if (!option || option.disabled || select.disabled) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === value
  }, providerIds[provider]), 'Provider preference must use its enabled native option')
  if (await $(picker).getAttribute('aria-expanded') !== 'true') await $('[aria-label="Open model choices"]').click()
  if (model === null || model === 'auto') {
    await (await optionNamed(model === null ? 'CLI default' : 'CLI automatic')).click()
  } else {
    await $(picker).setValue(model)
    await (await optionNamed('Use custom model')).click()
  }
  const save = await $('button=Save settings')
  await browser.waitUntil(async () => await save.getAttribute('aria-busy') !== 'true')
  if (await save.isEnabled()) {
    assert.equal(await $('button=Discard changes').isDisplayed(), true, 'A dirty Settings draft must offer Discard changes')
    await save.click()
    const saved = await $('.settings-save-feedback [role="status"]')
    await browser.waitUntil(async () => await saved.isDisplayed() && await saved.getText() === 'Saved' && !await save.isEnabled(), { timeout: 7_000 })
  }
  await browser.waitUntil(async () => {
    const current = await read('get_settings')
    return current.selectedAiProvider === providerIds[provider]
      && (current.selectedAiModelsByProvider?.[providerIds[provider]] ?? null) === model
      && !await $('button=Discard changes').isExisting()
  }, { timeout: 7_000, timeoutMsg: 'Provider preference must persist and leave a clean Settings draft' })
  assert.equal(await save.getText(), 'Save settings')
  assert.equal(await save.isEnabled(), false, 'A clean Settings Save must be disabled')
  await click('Back')
}

export async function createSession(title) {
  await click('New Session')
  const input = await $('[aria-label="Session title"]')
  await input.waitForDisplayed()
  await input.setValue(title)
  await browser.waitUntil(async () => (await read('list_sessions')).some((session) => session.title === title))
  return (await read('list_sessions')).find((session) => session.title === title).id
}

export async function insertNote(text) {
  if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('Close Ask AI')
  await $('[aria-label="Note body"][contenteditable="true"]').waitForDisplayed()
  assert.ok(await browser.execute((value) => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return document.execCommand('insertText', false, value)
  }, text), 'Native contenteditable insertion must reach the Note')
  await browser.waitUntil(async () => await $('p.status-pill.saved').getText().then((value) => value.includes('Note saved')))
}

export async function generate(provider, model, mode, lane) {
  execution(provider, mode, lane)
  await preference(provider, model)
  const sessionId = await createSession(`M02 lane ${lane} ${provider} generation`)
  await insertNote(`Synthetic model evidence source for lane ${lane}.`)
  const before = journal().length
  await click('Summarize with AI')
  const confirm = await (await $('dialog.generation-preflight[open]')).$('button=Summarize note')
  await confirm.waitForClickable()
  await confirm.click()
  await browser.waitUntil(() => database(sessionId).runs.at(-1)?.status === 'completed',
    { timeout: 20_000, timeoutMsg: `Generation lane ${lane} did not persist its completed AI Run` })
  await $('button=Summarize with AI').waitForClickable({ timeout: 10_000 })
  return { sessionId, row: database(sessionId).runs.at(-1), observations: journal().slice(before) }
}

export async function startChat(provider, model, mode, lane) {
  execution(provider, mode, lane)
  await preference(provider, model)
  const sessionId = await createSession(`M02 lane ${lane} ${provider} Chat`)
  await click('Ask AI')
  const before = journal().length
  await $('[aria-label="Session chat"] textarea').setValue(`Verify native evidence lane ${lane}.`)
  await click('Send')
  await browser.waitUntil(() => existsSync(join(directory, `model-evidence-${lane}.ready`)),
    { timeout: 15_000, timeoutMsg: `Missing actual fixture execution marker for lane ${lane}` })
  return { sessionId, observations: () => journal().slice(before) }
}

export async function finishChat(sessionId, status = 'completed') {
  await browser.waitUntil(async () => {
    const chat = await read('get_chat', { sessionId })
    const last = chat.messages.at(-1)
    return last?.status === status && database(sessionId).runs.at(-1)?.status === (status === 'completed' ? 'completed' : 'failed')
      && await browser.execute(() => document.querySelector('[aria-label="Session chat"] [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 15_000, timeoutMsg: `Chat did not persist terminal ${status}` })
  const chat = await read('get_chat', { sessionId })
  const row = database(sessionId).runs.at(-1)
  assert.ok(chat.messages.some((message) => message.aiRunId === row.id), 'Canonical Chat must associate the exact stored AI Run')
  return { row, chat }
}

export async function openSession(title) {
  if (await $('[aria-label="Refresh CLI configuration"]').isExisting()) await click('Back')
  const loadAll = await $('button=Load All Sessions')
  if (await loadAll.isExisting() && await loadAll.isEnabled()) {
    await loadAll.click()
    await loadAll.waitForExist({ reverse: true })
  }
  const search = await $('[placeholder="Search Sessions…"]')
  await search.waitForDisplayed()
  await search.setValue(title)
  let target
  await browser.waitUntil(async () => {
    for (const option of await $$('[aria-label="Sessions"][role="listbox"] [role="option"]')) {
      if (await (await option.$('.session-picker-title')).getAttribute('title') === title) {
        target = option
        return true
      }
    }
    return false
  }, { timeout: 10_000, timeoutMsg: `Missing searched Session ${title}` })
  await target.waitForClickable()
  await target.click()
  await browser.waitUntil(async () => await $('[aria-label="Session title"]').getValue() === title)
  await search.setValue('')
}
