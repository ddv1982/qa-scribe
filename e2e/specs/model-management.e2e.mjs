import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const evidenceRoot = process.env.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? '/tmp/qa-models/M01'
const configurationPath = join(directory, 'model-management.json')
const journalPath = join(directory, 'model-management-journal.jsonl')
const ids = { claude: 'claude_code', codex: 'codex_cli', copilot: 'copilot_cli' }
const picker = '[role="combobox"][aria-label="Model"]'
const catalogDescription = '#model-catalog-description'
const results = []
assert.ok(directory && existsSync(configurationPath), 'Use scripts/run-e2e.mjs to prepare isolated model fixtures before app startup')
assert.equal(process.env.QA_SCRIBE_E2E_MODEL_MANAGEMENT, '1')
assert.equal(process.env.QA_SCRIBE_PROVIDER_CATALOG_MODE, 'selector')

function journal() {
  return existsSync(journalPath) ? readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
}

function configure(provider, mode) {
  const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'))
  configuration[provider] = mode
  writeFileSync(configurationPath, JSON.stringify(configuration))
}

async function click(label) {
  const target = await $(`button=${label}`)
  await target.waitForClickable()
  await target.click()
}

async function read(command, args = {}) {
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

async function selectProvider(provider) {
  const selection = await $('[aria-label="Default AI provider"]')
  await selection.waitForEnabled()
  assert.ok(await browser.execute((value) => {
    const select = document.querySelector('[aria-label="Default AI provider"]')
    const option = Array.from(select.options).find((entry) => entry.value === value)
    if (!option || option.disabled || select.disabled) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === value
  }, ids[provider]), 'Native provider control must have the requested enabled option')
  await browser.waitUntil(async () => await selection.getValue() === ids[provider])
}

async function refresh(provider, method = provider === 'claude' ? undefined : 'models.list') {
  const before = journal().length
  await $('[aria-label="Refresh CLI configuration"]').click()
  await $('.execution-overview.refreshing').waitForExist({ timeout: 5_000 })
  await browser.waitUntil(async () => {
    const observations = journal().slice(before).filter((entry) => entry.provider === provider && entry.event === 'request')
    const reached = provider === 'claude' ? observations.some((entry) => entry.request.type === 'control_request')
      : observations.some((entry) => entry.request.method === (provider === 'codex' ? 'model/list' : method))
    return reached && !await $('.execution-overview.refreshing').isExisting()
  }, { timeout: 25_000, timeoutMsg: `Native ${provider} refresh did not finish` })
  return journal().slice(before)
}

async function choices() {
  if (await $(picker).getAttribute('aria-expanded') !== 'true') await $('[aria-label="Open model choices"]').click()
  await $('[role="listbox"][aria-label="AI models"]').waitForDisplayed()
  return browser.execute(() => Array.from(document.querySelectorAll('[aria-label="AI models"] [role="option"]'), (node) => ({
    label: node.querySelector('strong')?.textContent,
    detail: node.querySelector('small')?.textContent,
    disabled: node.getAttribute('aria-disabled') === 'true',
    source: node.querySelector('em')?.textContent,
  })))
}

async function closeChoices() {
  if (await $(picker).getAttribute('aria-expanded') === 'true') await $('[aria-label="Open model choices"]').click()
}

async function optionNamed(label) {
  for (const option of await $$('[aria-label="AI models"] [role="option"]')) {
    if (await (await option.$('strong')).getText() === label) return option
  }
  assert.fail(`No rendered model option named ${label}`)
}

async function choose(label) {
  await choices()
  const option = await optionNamed(label)
  await option.waitForClickable()
  await option.click()
}

async function save(provider, model) {
  const button = await $('.settings-header-actions button.primary-button')
  await button.waitForDisplayed()
  await browser.waitUntil(async () => await button.getText() !== 'Saving...',
    { timeout: 7_000, timeoutMsg: 'Previous Settings save did not settle' })
  if (await button.isEnabled()) {
    await button.click()
    await browser.waitUntil(async () => await button.getText() === 'Saved' && !await button.isEnabled(),
      { timeout: 7_000, timeoutMsg: 'Settings controller did not confirm its saved draft' })
  }
  await browser.waitUntil(async () => {
    const current = await read('get_settings')
    return current.selectedAiProvider === ids[provider]
      && (current.selectedAiModelsByProvider?.[ids[provider]] ?? null) === model
      && !await $('.settings-header-actions button.secondary-button').isExisting()
  }, { timeout: 7_000, timeoutMsg: 'Literal provider model selection did not reach clean saved Settings' })
}

async function lane(number, name, run) {
  const output = join(evidenceRoot, `lane-${number}`)
  mkdirSync(output, { recursive: true })
  const before = journal().length
  try {
    if (!await $('[aria-label="Refresh CLI configuration"]').isExisting()) {
      await click('Settings')
      const pending = await $('#pending-changes-title')
      if (await pending.isExisting()) {
        assert.equal(await pending.getText(), 'Save before leaving?')
        await click('Save and continue')
      }
      await $('[aria-label="Refresh CLI configuration"]').waitForDisplayed()
    }
    const details = await run()
    const screenshot = join(output, `${name}.png`)
    await browser.saveScreenshot(screenshot)
    results.push({ lane: number, status: 'passed', screenshot, details: details ?? null, observations: journal().slice(before) })
  } catch (error) {
    await browser.saveScreenshot(join(output, 'failed.png'))
    results.push({ lane: number, status: 'failed', error: error.message, observations: journal().slice(before) })
    throw error
  } finally {
    writeFileSync(join(evidenceRoot, 'lane-results.json'), `${JSON.stringify({ phase: 'M01', completed: results.length === 10,
      passed: results.filter((result) => result.status === 'passed').length, results }, null, 2)}\n`)
  }
}

function assertCatalogOnly(observations) {
  for (const entry of observations.filter((entry) => entry.event === 'request')) {
    const allowed = { claude: [undefined], codex: ['initialize', 'initialized', 'config/read', 'model/list'],
      copilot: ['connect', 'status.get', 'auth.getStatus', 'models.list', 'runtime.shutdown'] }
    assert.ok(allowed[entry.provider].includes(entry.request.method), 'Discovery must never send a prompt or create a session')
    if (entry.provider === 'claude') assert.deepEqual(entry.request,
      { type: 'control_request', request_id: 'qa-scribe-model-catalog', request: { subtype: 'initialize' } })
  }
  assert.equal(observations.some((entry) => entry.event === 'prompt'), false)
}

async function copilotChat(model) {
  await selectProvider('copilot')
  await choose(model === 'auto' ? 'CLI automatic' : 'CLI default')
  await save('copilot', model === 'default' ? null : model)
  await click('Back')
  await click('New Session')
  const title = `M01 Copilot ${model} Chat`
  await $('[aria-label="Session title"]').setValue(title)
  await browser.waitUntil(async () => (await read('list_sessions')).some((session) => session.title === title))
  const sessionId = (await read('list_sessions')).find((session) => session.title === title).id
  await click('Chat')
  const before = journal().length
  await $('[aria-label="Session chat"] textarea').setValue(`Verify ${model} request in a synthetic fixture.`)
  await click('Send')
  await browser.waitUntil(async () => (await read('get_chat', { sessionId })).messages.at(-1)?.text === 'Model selection fixture completed.',
    { timeout: 15_000, timeoutMsg: 'Synthetic Copilot Chat did not complete' })
  const spawn = journal().slice(before).find((entry) => entry.provider === 'copilot' && entry.argv?.includes('--acp'))
  assert.deepEqual(spawn?.argv, model === 'auto' ? ['--acp', '--model', 'auto'] : ['--acp'])
  await click('Settings')
  return spawn
}

async function copilotGeneration(model) {
  await choose(model === 'auto' ? 'CLI automatic' : 'CLI default')
  await save('copilot', model === 'default' ? null : model)
  await click('Back')
  await click('Write note')
  const note = await $('[aria-label="Note body"][contenteditable="true"]')
  await note.waitForDisplayed()
  assert.ok(await browser.execute((value) => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return document.execCommand('insertText', false, value)
  }, `Synthetic source for Copilot ${model} generation.`), 'Native editing must insert the synthetic source note')
  await browser.waitUntil(async () => await $('p.status-pill.saved').getText().then((text) => text.includes('Note saved')))
  const before = journal().length
  await click('Summarize notes')
  const confirm = await (await $('dialog.generation-preflight[open]')).$('button=Summarize note')
  await confirm.waitForClickable()
  await confirm.click()
  await browser.waitUntil(() => journal().slice(before).some((entry) => entry.provider === 'copilot' && entry.event === 'prompt'),
    { timeout: 15_000, timeoutMsg: 'Synthetic Copilot generation did not start' })
  await $('button=Summarize notes').waitForClickable({ timeout: 15_000 })
  const spawn = journal().slice(before).find((entry) => entry.provider === 'copilot' && entry.argv?.includes('-s'))
  assert.ok(spawn)
  const index = spawn.argv.indexOf('--model')
  if (model === 'auto') assert.equal(spawn.argv[index + 1], 'auto')
  else assert.equal(index, -1)
  await click('Settings')
  return spawn
}

describe('Built application native model management M01', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await click('Settings')
    await refresh('claude')
  })

  it('shows the structured Claude CLI source without sending a prompt', () => lane(1, 'claude-catalog', async () => {
    await selectProvider('claude')
    const observations = await refresh('claude')
    assert.match(await $(catalogDescription).getText(), /^Reported by CLI catalog · checked /)
    const rows = await choices()
    assert.deepEqual(rows.map(({ label, source }) => ({ label, source })),
      [{ label: 'CLI default', source: 'Default' }, { label: 'Claude Fixture', source: 'CLI catalog' }])
    await closeChoices()
    assertCatalogOnly(observations)
    return { rows }
  }))

  it('collects both Codex pages once and hides excluded rows', () => lane(2, 'codex-pages', async () => {
    await selectProvider('codex')
    const observations = await refresh('codex')
    const rows = await choices()
    assert.deepEqual(rows.map((row) => row.label), ['CLI default', 'Codex Page One', 'Codex Page Two'])
    const pages = observations.filter((entry) => entry.provider === 'codex' && entry.request?.method === 'model/list')
    assert.deepEqual(pages.map((entry) => entry.request.params), [{ limit: 100 }, { limit: 100, cursor: 'fixture-page-2' }])
    assert.equal(new Set(pages.map((entry) => entry.pid)).size, 1)
    assertCatalogOnly(observations)
    return { rows, pages }
  }))

  it('separates a string-only catalog denial from successful local authentication', () => lane(3, 'copilot-denial', async () => {
    await closeChoices()
    await selectProvider('copilot')
    configure('copilot', 'denial')
    const observations = await refresh('copilot')
    assert.equal(await $(catalogDescription).getText(), 'The CLI denied catalog access. Check CLI sign-in, account access, and organization settings, then retry.')
    assert.ok(await $('[aria-label="GitHub Copilot CLI: Ready"]').isExisting())
    assertCatalogOnly(observations)
  }))

  it('shows sign-in guidance for structured signed-out status', () => lane(4, 'signed-out', async () => {
    configure('copilot', 'signed-out')
    const observations = await refresh('copilot', 'auth.getStatus')
    assert.equal(await $(catalogDescription).getText(), 'Sign in with GitHub Copilot CLI, then retry model discovery.')
    assert.ok(await $('[aria-label="GitHub Copilot CLI: Sign-in needed"]').isExisting())
    assert.equal(observations.some((entry) => entry.provider === 'copilot' && entry.argv?.[0] === 'login'), false)
    assertCatalogOnly(observations)
  }))

  it('retains compatibility choices for an incompatible protocol', () => lane(5, 'unsupported', async () => {
    configure('copilot', 'unsupported')
    const observations = await refresh('copilot', 'connect')
    assert.equal(await $(catalogDescription).getText(), 'Update GitHub Copilot CLI to inspect CLI catalog models. Custom model IDs remain available.')
    const rows = await choices()
    assert.ok(rows.some((row) => row.label === 'CLI default'))
    assert.ok(rows.some((row) => row.label === 'CLI automatic'))
    await closeChoices()
    assertCatalogOnly(observations)
    return { rows }
  }))

  it('terminates the stalled catalog process group at its deadline', () => lane(6, 'timeout', async () => {
    configure('copilot', 'timeout')
    const observations = await refresh('copilot')
    const stalled = observations.find((entry) => entry.provider === 'copilot' && entry.event === 'stalled')
    assert.ok(stalled)
    for (const pid of [stalled.pid, stalled.childPid]) {
      await browser.waitUntil(() => {
        try { process.kill(pid, 0); return false } catch (error) { assert.equal(error.code, 'ESRCH'); return true }
      }, { timeout: 3_000, timeoutMsg: `Catalog process ${pid} survived its transaction` })
    }
    assert.match(await $(catalogDescription).getText(), /Refresh to confirm current access\.|CLI catalog is unavailable/)
    assertCatalogOnly(observations)
    return { terminatedPids: [stalled.pid, stalled.childPid] }
  })).timeout(35_000)

  it('keeps last-good rows and the saved selection after a same-identity failure', () => lane(7, 'stale', async () => {
    configure('copilot', 'fresh')
    await refresh('copilot')
    await choose('Copilot Fixture')
    await save('copilot', 'copilot-fixture')
    configure('copilot', 'unavailable')
    const observations = await refresh('copilot')
    assert.match(await $(catalogDescription).getText(), /^Reported by CLI catalog · last checked /)
    assert.equal(await $(picker).getValue(), 'Copilot Fixture')
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, 'copilot-fixture')
    assertCatalogOnly(observations)
  }))

  it('drops last-account rows after fixture identity changes', () => lane(8, 'identity', async () => {
    configure('copilot', 'unavailable')
    const identity = join(process.env.HOME, '.copilot')
    mkdirSync(identity, { recursive: true })
    writeFileSync(join(identity, 'config.json'), JSON.stringify({ model: 'external-fixed', fixtureIdentity: 'account-two' }))
    const observations = await refresh('copilot')
    assert.equal(await $(catalogDescription).getText(), 'The CLI catalog is unavailable. Check sign-in and network access, then retry.')
    const rows = await choices()
    assert.equal(rows.some((row) => row.label === 'Copilot Fixture'), false)
    await closeChoices()
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, 'copilot-fixture')
    assertCatalogOnly(observations)
    return { rows }
  }))

  it('retains a custom ID and distinguishes Auto from Default in actual Chat and generation children', () => lane(9, 'custom', async () => {
    configure('copilot', 'fresh')
    await refresh('copilot')
    await $(picker).click()
    await $(picker).setValue('custom-model-literal')
    await (await optionNamed('Use custom model')).click()
    await save('copilot', 'custom-model-literal')
    await refresh('copilot')
    assert.equal(await $(picker).getValue(), 'custom-model-literal')
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, 'custom-model-literal')
    await browser.saveScreenshot(join(evidenceRoot, 'lane-9', 'custom-retained.png'))
    const invocations = []
    for (const model of ['auto', 'default']) {
      invocations.push(await copilotChat(model))
      invocations.push(await copilotGeneration(model))
    }
    await $(picker).click()
    await $(picker).setValue('custom-model-literal')
    await (await optionNamed('Use custom model')).click()
    await save('copilot', 'custom-model-literal')
    return { customModel: 'custom-model-literal', externalConfiguredModel: 'external-fixed', invocations }
  })).timeout(120_000)

  it('disables policy rows while preserving provider-managed Default', () => lane(10, 'policy', async () => {
    configure('copilot', 'policy')
    await refresh('copilot')
    const rows = await choices()
    assert.deepEqual(rows.filter((row) => row.label.startsWith('Copilot ')).map(({ label, disabled }) => ({ label, disabled })), [
      { label: 'Copilot Fixture', disabled: false }, { label: 'Copilot Blocked', disabled: true },
      { label: 'Copilot Unconfigured', disabled: true },
    ])
    await (await optionNamed('Copilot Blocked')).click()
    assert.equal(await $(picker).getAttribute('aria-expanded'), 'true')
    await (await optionNamed('CLI default')).click()
    await save('copilot', null)
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, null)
    await choices()
    await browser.saveScreenshot(join(evidenceRoot, 'lane-10', 'copilot-policy.png'))
    await closeChoices()
    await selectProvider('claude')
    assert.equal(process.env.CLAUDE_CONFIG_DIR, join(process.env.HOME, '.claude'), 'Policy proof requires its isolated HOME settings source')
    const settingsDirectory = join(process.env.HOME, '.claude')
    mkdirSync(settingsDirectory, { recursive: true })
    const policyPath = join(settingsDirectory, 'settings.json')
    const previous = existsSync(policyPath) ? { bytes: readFileSync(policyPath), mode: statSync(policyPath).mode & 0o777 } : null
    const claudePolicy = []
    try {
      for (const [name, availableModels] of [['empty', []], ['nonmatching', ['not-the-fixture-model']]]) {
        writeFileSync(policyPath, JSON.stringify({ availableModels }), { mode: 0o600 })
        const observations = await refresh('claude')
        assert.match(await $(catalogDescription).getText(), /^Reported by CLI catalog · checked /)
        const restrictedRows = await choices()
        assert.deepEqual(restrictedRows.map(({ label, source, disabled }) => ({ label, source, disabled })),
          [{ label: 'CLI default', source: 'Default', disabled: false }])
        assertCatalogOnly(observations)
        const screenshot = join(evidenceRoot, 'lane-10', `claude-${name}-allowlist.png`)
        await browser.saveScreenshot(screenshot)
        claudePolicy.push({ availableModels, rows: restrictedRows, screenshot })
        await closeChoices()
      }
    } finally {
      if (previous) {
        writeFileSync(policyPath, previous.bytes)
        chmodSync(policyPath, previous.mode)
      } else rmSync(policyPath)
    }
    await refresh('claude')
    await selectProvider('copilot')
    await choices()
    return { rows, claudePolicy }
  }))
})
