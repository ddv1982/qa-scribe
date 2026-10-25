import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { layoutViewport, wideLayoutViewport, minimumLayoutViewport } from './chat-layout-geometry.mjs'
import { permissionGeometry, reachPermission, reviewPermission } from './chat-permission-geometry.mjs'

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

async function start(mode, caseName, text = `Check the marker tool authorization for ${caseName}. Retain this testing context.`) {
  writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode, caseName }))
  const title = `E2E ${provider} ${caseName} ${Date.now()}`
  const sessionId = await create(title)
  assert.equal((await read('get_settings')).selectedAiProvider, providerIds[provider],
    'Every authorization case must use the provider saved through Settings')
  const index = files('.started').length + 1
  const before = files('.executed.json').length
  await $(composer).setValue(text)
  await click('Send')
  await markerFile(index, 'started')
  const prompt = JSON.parse(readFileSync(await markerFile(index, 'prompt.json'), 'utf8'))
  assert.ok(prompt.prompt.includes(JSON.stringify(text)), 'The actual provider must receive the original user message')
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
      const saved = await $('.settings-save-feedback [role="status"]')
      await browser.waitUntil(async () => await saved.getText() === 'Saved')
      assert.equal(await saved.isDisplayed(), true)
      assert.equal(await save.getText(), 'Save settings')
      assert.equal(await save.isEnabled(), false, 'A clean Settings Save must be disabled')
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

  it('approves a burst and later request for only this response, with independent child executions', async () => {
    const current = await start('bulk', 'bulk')
    await markerFile(current.index, 'request-3.json')
    const bulkMarkers = () => files('.executed.json')
      .filter((name) => name.startsWith(`${provider}-auth-${current.index}.tool-`))
    assert.equal(bulkMarkers().length, 0, 'The initial burst cannot execute before consent')
    assert.equal(existsSync(join(directory, `${provider}-auth-${current.index}.request-4.json`)), false,
      'The later request must not be emitted with the initial burst')
    // This real UI action deliberately fails against the previous once-only UI.
    await click('Approve all for this response')
    const chat = await settled(current.sessionId, 'completed', 2)
    assert.equal(chat.messages[1].text, 'Four independent marker children executed after response approval.')
    assert.equal(bulkMarkers().length, 4, 'One click must execute all three queued children and the later child')
    assert.equal(files('.executed.json').length, current.before + 4)
    const parent = Number(readFileSync(await markerFile(current.index, 'started'), 'utf8').trim())
    const children = []
    const ids = []
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const request = JSON.parse(readFileSync(await markerFile(current.index, `request-${ordinal}.json`), 'utf8'))
      const decision = JSON.parse(readFileSync(await markerFile(current.index, `decision-${ordinal}.json`), 'utf8'))
      const marker = JSON.parse(readFileSync(request.marker, 'utf8'))
      assert.equal(request.id, `fixture-permission-${current.index}-${ordinal}`)
      assert.equal(decision.approved, true)
      assert.equal(provider === 'claude' ? decision.wire.response.request_id : decision.wire.id, request.id)
      // The fixture rejects any reply differing from its full, ordinary once-only wire payload.
      assert.equal(marker.parent, parent)
      assert.notEqual(marker.pid, parent, 'Each side effect must run in an actual child process')
      children.push(marker.pid)
      ids.push(request.id)
    }
    assert.equal(new Set(children).size, 4, 'Four separate marker child processes must execute')
    assert.equal(new Set(ids).size, 4, 'Every permission must retain its distinct provider request ID')

    // A new prompt in the same Session must not inherit the completed response's consent.
    writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode: 'permission', caseName: 'after-bulk' }))
    const text = 'Check a new marker tool request after the bulk-approved response.'
    await $(composer).setValue(text)
    await click('Send')
    await markerFile(current.index + 1, 'started')
    await $(permission).waitForDisplayed()
    await $('button=Approve all for this response').waitForDisplayed()
    const followUpPrompt = JSON.parse(readFileSync(await markerFile(current.index + 1, 'prompt.json'), 'utf8'))
    assert.ok(followUpPrompt.prompt.includes(JSON.stringify(text)), 'The new response must receive the follow-up user prompt')
    assertChild(current.index + 1, 0)
    assert.equal(files('.executed.json').length, current.before + 4,
      'Response-wide approval must not authorize the next response')
    await click('Deny')
    const followUp = await settled(current.sessionId, 'completed', 4)
    assert.equal(followUp.messages[2].text, text)
    assert.equal(followUp.messages[3].text, 'Marker tool denied. No child executed.')
    assertChild(current.index + 1, 0)
    assert.equal(files('.executed.json').length, current.before + 4)
    await assertReopened(current.title, current.sessionId, followUp)
  }).timeout(60_000)

  it('reveals a new permission above long scrolled history with reachable context and decisions', async () => {
    await browser.setWindowSize(1280, 720)
    const longText = 'Checkout history: preserve cart and discount after declined payment. '.repeat(100)
    const current = await start('policy', 'scrolled-history', longText)
    const history = await settled(current.sessionId, 'completed', 2)
    assert.equal(history.messages[0].text, longText)
    assert.equal(history.messages[1].text, 'Provider policy denied the marker tool. No child executed.')
    assertChild(current.index, 0)
    const text = 'Request the marker tool permission while I read the latest response.'
    await $(composer).setValue(text)
    await browser.execute(() => { const region = document.querySelector('.chat-scroll-region'); region.scrollTop = region.scrollHeight })
    const before = await browser.execute(() => {
      const region = document.querySelector('.chat-scroll-region')
      return { top: region.scrollTop, height: region.clientHeight, total: region.scrollHeight }
    })
    assert.ok(before.top > before.height, 'The actual completed transcript must already be scrolled beyond its first viewport')
    writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode: 'permission', caseName: 'scrolled-permission' }))
    await click('Send')
    await markerFile(current.index + 1, 'started')
    await $(permission).waitForDisplayed()
    assertChild(current.index + 1, 0)
    const prompt = JSON.parse(readFileSync(await markerFile(current.index + 1, 'prompt.json'), 'utf8'))
    assert.ok(prompt.prompt.includes(JSON.stringify(text)))
    const geometry = []
    const wide = await wideLayoutViewport()
    const short = await minimumLayoutViewport()
    for (const [width, height] of [[1280, wide.height], [1280, 645], [640, short.height], [360, 645], [320, 645]]) {
      assert.deepEqual(await layoutViewport(width, height), { width, height })
      await $('button=Review permission').scrollIntoView()
      await reviewPermission()
      assert.ok(await browser.execute(() => document.activeElement?.matches('.chat-permission h3')), 'Explicit review must focus the non-interactive permission heading')
      const actual = await permissionGeometry()
      geometry.push({ requested: { width, height }, ...actual })
      writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'permission-geometry.json'), JSON.stringify({ before, geometry }, null, 2))
      await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, `permission-${width}.png`))
      const fits = actual.panel.rect.height <= actual.owner.clip.bottom - actual.owner.clip.top
      if (fits) {
        assert.ok(actual.panel.visible && actual.identity.visible && actual.identity.hit, 'A fitting permission panel must remain fully visible')
        assert.ok(actual.context.visible && actual.context.hit, 'A fitting permission context must be fully visible and unobstructed')
        for (const control of actual.controls) assert.ok(control.visible && control.hit, JSON.stringify(control))
      } else {
        const identity = await reachPermission(`${permission} header`)
        assert.ok(identity.visible && identity.hit, JSON.stringify(identity))
      }
      const readable = await reachPermission(`${permission} [aria-label="Permission context"]`)
      assert.ok(readable.rect.height >= 96 && readable.readableLines >= 3, `Actual arguments must have readable lines: ${JSON.stringify(readable)}`)
      const argumentsView = await reachPermission(`${permission} .chat-permission-input`)
      assert.ok(argumentsView.readableLines >= 1 && argumentsView.label.includes(`${provider}-auth-${current.index + 1}.executed.json`),
        `The actual tool arguments must be readable: ${JSON.stringify(argumentsView)}`)
      const scopeView = await reachPermission(`${permission} [id$="-permission-scope"]`)
      assert.ok(scopeView.readableLines >= 1, `The actual approval scope must be readable: ${JSON.stringify(scopeView)}`)
      const reached = []
      for (const label of ['Approve once', 'Approve all for this response', 'Deny', 'Cancel response']) {
        const control = await reachPermission(`button=${label}`)
        assert.ok(control.visible && control.hit, `Permission control must be fully reachable: ${JSON.stringify(control)}`)
        reached.push(control)
      }
      geometry.at(-1).fit = fits
      geometry.at(-1).readable = readable
      geometry.at(-1).argumentsView = argumentsView
      geometry.at(-1).scopeView = scopeView
      geometry.at(-1).reached = reached
      writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'permission-geometry.json'), JSON.stringify({ before, geometry }, null, 2))
      assert.deepEqual(actual.controls.map((control) => control.label), ['Approve once', 'Approve all for this response', 'Deny', 'Cancel response'])
      assert.equal(actual.historyOwnsPermission, false, 'Permission attention must not share the transcript scroller')
      assert.equal(actual.approvalFocused, false, 'Arrival or review must never focus approval')
      assert.ok(actual.contextText.includes('Approve once applies to this tool call only.'))
      assert.ok(actual.contextText.includes(`${provider}-auth-${current.index + 1}.executed.json`), 'Full native request arguments must remain readable')
      assertChild(current.index + 1, 0)
    }
    await click('Deny')
    const denied = await settled(current.sessionId, 'completed', 4)
    assert.deepEqual(denied.messages.slice(0, 2), history.messages)
    assert.equal(denied.messages[2].text, text)
    assert.equal(denied.messages[3].text, 'Marker tool denied. No child executed.')
    assertChild(current.index + 1, 0)
    assert.equal(files('.executed.json').length, current.before)
    await browser.setWindowSize(1280, 860)
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
    assert.ok(retried.prompt.endsWith(`\nMESSAGE ${cancelled.messages[0].id} User\n${JSON.stringify(current.text)}`), 'Retry must replay the exact cancelled user message under its stable identity')
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
