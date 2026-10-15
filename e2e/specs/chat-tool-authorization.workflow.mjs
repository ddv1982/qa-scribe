import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const provider = process.env.QA_SCRIBE_E2E_AUTH_PROVIDER
const providerIds = { codex: 'codex_cli', claude: 'claude_code', copilot: 'copilot_cli' }
const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const composer = '[aria-label="Session chat"] textarea'
const permission = '[aria-label="Tool permission"]'
assert.ok(providerIds[provider], 'Authorization workflow requires a dedicated provider selection')
assert.ok(directory, 'Authorization workflow requires an isolated fixture directory')

async function click(label) {
  const button = await $(`button=${label}`)
  await button.waitForClickable()
  await button.click()
}

// These public commands only read canonical persisted state. All mutations use UI controls.
async function read(command, args = {}) {
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

function files(suffix) {
  return readdirSync(directory).filter((name) => name.startsWith(`${provider}-auth-`) && name.endsWith(suffix))
}

async function markerFile(index, suffix) {
  const path = join(directory, `${provider}-auth-${index}.${suffix}`)
  await browser.waitUntil(() => existsSync(path), { timeout: 10_000, timeoutMsg: `Missing provider marker ${path}` })
  return path
}

async function create(title) {
  await click('New Session')
  const field = await $('[aria-label="Session title"]')
  await field.waitForDisplayed()
  await field.setValue(title)
  await browser.waitUntil(async () => (await read('list_sessions')).some((session) => session.title === title),
    { timeout: 5_000, timeoutMsg: 'Authorization Session title did not persist' })
  const session = (await read('list_sessions')).find((session) => session.title === title)
  await click('Chat')
  await $(composer).waitForEnabled()
  return session.id
}

async function reopen(title) {
  // Substring text selection also matches the newer "<title> isolation" Session.
  // Resolve the exact, full title exposed by the real Session picker instead.
  let option
  await browser.waitUntil(async () => {
    for (const candidate of await $$('[aria-label="Sessions"][role="listbox"] [role="option"]')) {
      if (await (await candidate.$('.session-picker-title')).getAttribute('title') === title) {
        option = candidate
        return true
      }
    }
    return false
  }, { timeout: 10_000, timeoutMsg: `Exact Session picker option not found: ${title}` })
  await option.waitForClickable()
  await option.click()
  await browser.waitUntil(async () => await option.getAttribute('aria-selected') === 'true'
    && (await $('[aria-label="Session title"]')).getValue().then((value) => value === title),
  { timeout: 10_000, timeoutMsg: `Exact Session did not reopen: ${title}` })
  await click('Chat')
  await $(composer).waitForEnabled()
}

async function settled(sessionId, status, count) {
  await browser.waitUntil(async () => {
    const chat = await read('get_chat', { sessionId })
    return chat.messages.length === count && chat.messages.at(-1)?.status === status
      && await browser.execute(() => document.querySelector('[aria-label="Session chat"] [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 15_000, timeoutMsg: `Authorization transcript did not persist ${status}` })
  return read('get_chat', { sessionId })
}

async function assertReopened(title, sessionId, expected) {
  // Navigate away and reopen the Session, then reload the WebView and reopen again.
  await create(`${title} isolation`)
  await reopen(title)
  assert.deepEqual((await read('get_chat', { sessionId })).messages, expected.messages)
  await browser.refresh()
  await $('button=New Session').waitForDisplayed()
  await reopen(title)
  await browser.waitUntil(async () => (await $$('.chat-messages > li')).length === expected.messages.length)
  assert.deepEqual((await read('get_chat', { sessionId })).messages, expected.messages,
    'Canonical messages, IDs, statuses and text must survive Session reopen and WebView reload')
}

async function start(mode, caseName) {
  writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode, caseName }))
  const title = `E2E ${provider} ${caseName} ${Date.now()}`
  const sessionId = await create(title)
  assert.equal((await read('get_settings')).selectedAiProvider, providerIds[provider],
    'Every authorization case must use the provider saved through Settings')
  const index = files('.started').length + 1
  const before = files('.executed.json').length
  const text = `Check the marker tool authorization for ${caseName}. Retain this testing context.`
  await $(composer).setValue(text)
  await click('Send')
  await markerFile(index, 'started')
  const prompt = JSON.parse(readFileSync(await markerFile(index, 'prompt.json'), 'utf8'))
  assert.ok(prompt.prompt.includes(text), 'The actual provider must receive the original user message')
  if (mode !== 'policy') {
    await $(permission).waitForDisplayed()
    assert.equal(files('.executed.json').length, before, 'A permission request must not execute a child before approval')
    assert.match(await $(permission).getText(), /this tool call only/i)
  }
  return { title, sessionId, index, before, text }
}

function executionCount(index) {
  return existsSync(join(directory, `${provider}-auth-${index}.executed.json`)) ? 1 : 0
}

function assertChild(index, count) {
  assert.equal(executionCount(index), count, 'Actual child marker execution count must match the authorization decision')
  if (count) {
    const marker = JSON.parse(readFileSync(join(directory, `${provider}-auth-${index}.executed.json`), 'utf8'))
    const parent = Number(readFileSync(join(directory, `${provider}-auth-${index}.started`), 'utf8').trim())
    assert.equal(marker.parent, parent)
    assert.notEqual(marker.pid, parent, 'The tool marker must be written by a distinct child process')
  }
}

describe(`Built application native ${provider} Chat tool authorization`, () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    // Configure the real Settings UI. No application state or write commands are injected.
    await click('Settings')
    const selection = await $('[aria-label="Default AI provider"]')
    await selection.waitForEnabled()
    await $('[aria-label="Refresh CLI configuration"]').click()
    const catalogPath = join(directory, 'authorization-catalog.jsonl')
    const methods = { codex: 'model/list', claude: 'initialize.catalog', copilot: 'models.list' }
    await browser.waitUntil(() => existsSync(catalogPath)
      && readFileSync(catalogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        .some((event) => event.provider === provider && event.method === methods[provider]),
    { timeout: 25_000, timeoutMsg: 'Normal provider catalog discovery did not complete' })
    await browser.waitUntil(async () => (await selection.$(`option[value="${providerIds[provider]}"]`)).isExisting(),
      { timeout: 20_000, timeoutMsg: 'Dedicated provider did not pass ordinary CLI readiness' })
    await selection.selectByAttribute('value', providerIds[provider])
    // The embedded driver's option-click transport does not commit a React
    // controlled select change. Use the browser's native form-control setter
    // and bubbled DOM events, never a React setter or application write command.
    assert.ok(await browser.execute((value) => {
      const select = document.querySelector('[aria-label="Default AI provider"]')
      const option = Array.from(select.options).find((entry) => entry.value === value)
      if (!option || option.disabled || select.disabled) return false
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value === value
    }, providerIds[provider]), 'Native provider select must commit the matching enabled option')
    await browser.waitUntil(async () => (await selection.getValue()) === providerIds[provider],
      { timeout: 5_000, timeoutMsg: 'Settings provider selection did not reflect the rendered option' })
    const save = await $('button=Save settings')
    if ((await read('get_settings')).selectedAiProvider !== providerIds[provider]) {
      await save.waitForEnabled()
      await save.click()
      await $('button=Saved').waitForDisplayed()
    }
    await browser.waitUntil(async () => (await read('get_settings')).selectedAiProvider === providerIds[provider],
      { timeout: 5_000, timeoutMsg: 'Selected authorization provider did not reach canonical Settings storage' })
    await click('Back')
    assert.equal(files('.started').length, 0, 'Readiness and catalog discovery must not send a model request')
    const catalog = readFileSync(catalogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.ok(catalog.some((event) => event.provider === provider && event.method === methods[provider]),
      'Normal provider catalog discovery must complete without a model request')
  })

  it('approves once and executes exactly one actual marker child', async () => {
    const current = await start('permission', 'approve')
    await click('Approve once')
    const chat = await settled(current.sessionId, 'completed', 2)
    assert.equal(chat.messages[0].text, current.text)
    assert.equal(chat.messages[1].text, 'Marker child executed once after approval.')
    assertChild(current.index, 1)
    assert.equal(files('.executed.json').length, current.before + 1)
    await assertReopened(current.title, current.sessionId, chat)
    assertChild(current.index, 1)
  }).timeout(60_000)

  it('denies the tool without executing a child and persists the completed denial', async () => {
    const current = await start('permission', 'deny')
    await click('Deny')
    const chat = await settled(current.sessionId, 'completed', 2)
    assert.equal(chat.messages[1].text, 'Marker tool denied. No child executed.')
    assertChild(current.index, 0)
    assert.equal(files('.executed.json').length, current.before)
    await assertReopened(current.title, current.sessionId, chat)
    assertChild(current.index, 0)
  }).timeout(60_000)

  it('cancels a pending permission without executing a child and persists cancellation', async () => {
    const current = await start('permission', 'cancel')
    await click('Cancel response')
    const chat = await settled(current.sessionId, 'cancelled', 1)
    assert.equal(chat.messages[0].text, current.text)
    assertChild(current.index, 0)
    assert.equal(existsSync(join(directory, `${provider}-auth-${current.index}.decision.json`)), false)
    await assertReopened(current.title, current.sessionId, chat)
    assertChild(current.index, 0)
  }).timeout(60_000)

  it('respects provider policy denial without offering an approval or executing a child', async () => {
    const current = await start('policy', 'policy')
    const chat = await settled(current.sessionId, 'completed', 2)
    assert.equal(chat.messages[1].text, 'Provider policy denied the marker tool. No child executed.')
    assert.equal(await $(permission).isExisting(), false)
    assertChild(current.index, 0)
    assert.equal(files('.executed.json').length, current.before)
    assert.deepEqual(JSON.parse(readFileSync(await markerFile(current.index, 'policy.json'), 'utf8')),
      { decision: 'deny', source: 'provider-policy' })
    await assertReopened(current.title, current.sessionId, chat)
  }).timeout(60_000)

  it('requires a fresh once-only approval on explicit retry and reuses the cancelled user message', async () => {
    const current = await start('permission', 'retry')
    await click('Cancel response')
    const cancelled = await settled(current.sessionId, 'cancelled', 1)
    assertChild(current.index, 0)
    await click('Retry response')
    await markerFile(current.index + 1, 'started')
    await $(permission).waitForDisplayed()
    assertChild(current.index + 1, 0)
    const retried = JSON.parse(readFileSync(await markerFile(current.index + 1, 'prompt.json'), 'utf8'))
    const transcript = JSON.parse(retried.prompt.split('\nTRANSCRIPT_JSON\n')[1])
    assert.deepEqual(transcript.messages, [{ role: 'user', text: current.text }])
    await click('Approve once')
    const chat = await settled(current.sessionId, 'completed', 2)
    assert.equal(chat.messages[0].id, cancelled.messages[0].id)
    assertChild(current.index, 0)
    assertChild(current.index + 1, 1)
    assert.equal(files('.executed.json').length, current.before + 1)
    await assertReopened(current.title, current.sessionId, chat)
    assertChild(current.index + 1, 1)
  }).timeout(60_000)
})
