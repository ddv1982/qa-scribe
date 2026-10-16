import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { click, createSession, database, directory, execution, finishChat, insertNote, journal, openSession,
  preference, read, refresh, settings } from './model-evidence-ui.mjs'
import { configureCatalog, generation, historyText, menuGeometry, modelPreference, outputRoot,
  quickInput, quickSection, send, switchProviderOnly } from './model-selection-ui.mjs'
import { nativeKeySender } from './preflight-native-keys.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))
const restart = process.env.QA_SCRIBE_E2E_SELECTION_RESTART === '1'
const resultsPath = join(outputRoot, 'lane-results.json')
const restartPath = join(directory, 'model-selection-restart.json')
const results = restart ? JSON.parse(readFileSync(resultsPath, 'utf8')).results : []
let restarted = false
let historical
const recorded = (id, reported = null) => ({ kind: 'recorded', requested: id === null ? { kind: 'default' }
  : id === 'auto' ? { kind: 'copilotAutomatic' } : { kind: 'explicit', id }, reported })

async function lane(number, name, run) {
  const output = join(outputRoot, `lane-${number}`)
  mkdirSync(output, { recursive: true })
  const before = journal().length
  try {
    const details = await run(output)
    const screenshot = join(output, `${name}.png`)
    await browser.saveScreenshot(screenshot)
    const entry = { lane: number, status: 'passed', screenshot, details, observations: journal().slice(before) }
    const prior = results.findIndex((result) => result.lane === number)
    if (prior < 0) results.push(entry)
    else results[prior] = entry
  } catch (error) {
    await browser.saveScreenshot(join(output, 'failed.png'))
    const entry = { lane: number, status: 'failed', error: error.message, observations: journal().slice(before) }
    const prior = results.findIndex((result) => result.lane === number)
    if (prior < 0) results.push(entry)
    else results[prior] = entry
    throw error
  } finally {
    writeFileSync(resultsPath, `${JSON.stringify({ phase: 'M03', nativeRestartVerified: restarted,
      completed: results.length === 10 && results.every((result) => result.status === 'passed') && restarted,
      passed: results.filter((result) => result.status === 'passed').length, results }, null, 2)}\n`)
  }
}

async function fresh(provider, title) {
  await preference(provider, null)
  const sessionId = await createSession(title)
  await click('Chat')
  await $(quickInput).waitForEnabled()
  return sessionId
}

async function restartProof() {
  const expected = { claude_code: 'restart-claude-literal', codex_cli: 'restart-codex-literal', copilot_cli: 'restart-copilot-literal' }
  if (!restart) {
    for (const [provider, id] of [['claude', 'claude_code'], ['codex', 'codex_cli'], ['copilot', 'copilot_cli']]) {
      await preference(provider, null)
      await click('Chat')
      await modelPreference(provider, expected[id])
    }
    const saved = await read('get_settings')
    assert.deepEqual(saved.selectedAiModelsByProvider, expected)
    writeFileSync(restartPath, JSON.stringify({ nativePid: journal().filter((entry) => entry.event === 'spawn').at(-1).parentPid,
      expected, historicalSession: historical.sessionId, historicalRows: database(historical.sessionId).runs }))
    return { expected, nativeRestartPending: true }
  }
  const previous = JSON.parse(readFileSync(restartPath, 'utf8'))
  const restoredSettings = await read('get_settings')
  assert.deepEqual(restoredSettings.selectedAiModelsByProvider, previous.expected)
  await click('Chat')
  await $(quickInput).waitForEnabled()
  assert.equal(await $(quickInput).getValue(), previous.expected[restoredSettings.selectedAiProvider],
    'The first restored quick selection must be correct before any Settings write')
  const nativePid = journal().filter((entry) => entry.event === 'spawn').at(-1).parentPid
  assert.notEqual(nativePid, previous.nativePid)
  for (const provider of ['claude', 'codex', 'copilot']) {
    const model = previous.expected[{ claude: 'claude_code', codex: 'codex_cli', copilot: 'copilot_cli' }[provider]]
    await switchProviderOnly(provider, previous.expected)
    await click('Chat')
    assert.equal(await $(quickInput).getValue(), model)
    await $(`${quickSection} [aria-label="Open model choices"]`).click()
    const labels = []
    for (const entry of await $$(`${quickSection} [role="option"] strong`)) labels.push(await entry.getText())
    assert.equal(labels.some((label) => ['Claude Fixture', 'Codex Page One', 'Codex Page Two', 'Copilot Fixture'].includes(label)), false)
    await $(`${quickSection} [aria-label="Open model choices"]`).click()
  }
  assert.deepEqual(database(previous.historicalSession).runs, previous.historicalRows)
  restarted = true
  return { expected: previous.expected, nativePid, previousNativePid: previous.nativePid, initialRestoredProvider: restoredSettings.selectedAiProvider, offlineCatalogsContainPriorAccountRows: false }
}

describe('Built application native quick model selection M03', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await settings()
    await refresh()
    await click('Back')
    if (restart) await openSession('M03 Claude next model')
  })

  if (restart) {
    it('restores each provider choice in a new native process without replaying account catalogs', () => lane(10, 'restart', restartProof))
    return
  }

  it('selects using real native keys, retains focus, and keeps the open menu in the viewport', () => lane(1, 'keyboard', async (output) => {
    const sessionId = await fresh('claude', 'M03 keyboard selection')
    const evidence = {}
    const persist = () => writeFileSync(join(output, 'keyboard.json'), JSON.stringify(evidence, null, 2))
    const key = nativeKeySender(evidence, persist, Key)
    let reached = false
    for (let count = 0; count < 45; count += 1) {
      if (await browser.execute((selector) => document.activeElement === document.querySelector(selector), quickInput)) { reached = true; break }
      await key(Key.Tab)
    }
    assert.ok(reached, 'Native Tab traversal must reach the next invocation picker')
    await key(Key.ArrowDown)
    const geometry = await menuGeometry()
    assert.ok(geometry?.options > 0)
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewportWidth && geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight,
      `Quick model menu must remain visible: ${JSON.stringify(geometry)}`)
    await browser.saveScreenshot(join(output, 'open-keyboard-menu.png'))
    await key(Key.End)
    await key(Key.Enter)
    await browser.waitUntil(async () => (await read('get_settings')).selectedAiModelsByProvider.claude_code === 'claude-fixture')
    await browser.waitUntil(async () => await $(quickInput).isEnabled())
    await key(Key.ArrowDown)
    await key(Key.Escape)
    assert.equal(await $(quickInput).getAttribute('aria-expanded'), 'false')
    assert.ok(await browser.execute((selector) => document.activeElement === document.querySelector(selector), quickInput))
    evidence.nativeKeyboard.status = 'passed'
    persist()
    return { sessionId, geometry, keyboard: evidence }
  })).timeout(45_000)

  it('persists a quick Claude choice and launches the next Chat with the exact model', () => lane(2, 'claude-next', async () => {
    const sessionId = await fresh('claude', 'M03 Claude next model')
    await modelPreference('claude', 'claude-next-literal')
    const current = await send(sessionId, 'claude', 'alias', 'M03-2')
    assert.ok(current.argv.includes('--model'))
    assert.equal(current.argv[current.argv.indexOf('--model') + 1], 'claude-next-literal')
    assert.deepEqual(current.row.selection, recorded('claude-next-literal', { source: 'claudeAssistantMessage', id: 'claude-alias-resolved' }))
    historical = { sessionId, title: 'M03 Claude next model', row: current.row }
    return { sessionId, ...current }
  }))

  it('launches the Codex generation selection displayed in preflight', () => lane(3, 'codex-next', async () => {
    await preference('codex', null)
    const sessionId = await createSession('M03 Codex preflight model')
    await insertNote('Synthetic Codex preflight selection source.')
    const current = await generation(sessionId, 'codex', 'codex-next-literal', 'M03-3')
    assert.deepEqual(current.argv, ['exec', '--skip-git-repo-check', '--json', '--model', 'codex-next-literal', '-'])
    assert.deepEqual(current.row.selection, recorded('codex-next-literal'))
    return current
  }))

  it('keeps Copilot Automatic distinct from a later explicit choice', () => lane(4, 'copilot-next', async () => {
    const sessionId = await fresh('copilot', 'M03 Copilot Automatic and explicit')
    await modelPreference('copilot', 'auto')
    const automatic = await send(sessionId, 'copilot', 'missing', 'M03-4-auto')
    assert.deepEqual(automatic.argv, ['--acp', '--model', 'auto'])
    assert.deepEqual(automatic.row.selection, recorded('auto'))
    await modelPreference('copilot', 'copilot-next-literal')
    const explicit = await send(sessionId, 'copilot', 'missing', 'M03-4-explicit')
    assert.deepEqual(explicit.argv, ['--acp', '--model', 'copilot-next-literal'])
    assert.deepEqual(explicit.row.selection, recorded('copilot-next-literal'))
    return { sessionId, automatic, explicit }
  }))

  it('preserves active model and permission identity while saving the next model', () => lane(5, 'active', async (output) => {
    const sessionId = await fresh('claude', 'M03 active model capture')
    await modelPreference('claude', 'active-first-literal')
    execution('claude', 'permission', 'M03-5')
    const before = journal().length
    await $('[aria-label="Session chat"] textarea').setValue('Hold this synthetic response for permission.')
    await click('Send')
    await $('[aria-label="Tool permission"]').waitForDisplayed()
    const initial = (await read('list_active_ai_action_jobs')).find((job) => job.sessionId === sessionId)
    assert.ok(initial?.pendingPermission)
    await modelPreference('claude', 'active-next-literal')
    const changed = await read('get_ai_action_job_status', { jobId: initial.jobId })
    assert.equal(changed.aiRunId, initial.aiRunId)
    assert.deepEqual(changed.pendingPermission, initial.pendingPermission)
    assert.deepEqual(database(sessionId).runs.at(-1).selection.requested, { kind: 'explicit', id: 'active-first-literal' })
    await browser.saveScreenshot(join(output, 'active-pending-permission.png'))
    await click('Approve once')
    const first = await finishChat(sessionId)
    assert.deepEqual(first.row.selection, recorded('active-first-literal', { source: 'claudeAssistantMessage', id: 'claude-active-reported' }))
    const child = JSON.parse(readFileSync(join(directory, 'model-evidence-M03-5.executed.json'), 'utf8'))
    const peer = journal().slice(before).find((entry) => entry.event === 'execution')
    assert.equal(child.parent, peer.pid)
    assert.notEqual(child.pid, peer.pid)
    const next = await send(sessionId, 'claude', 'missing', 'M03-5-next')
    assert.equal(next.argv[next.argv.indexOf('--model') + 1], 'active-next-literal')
    assert.deepEqual(next.row.selection, recorded('active-next-literal'))
    return { sessionId, initialPermission: initial.pendingPermission, first: first.row, next: next.row, actualMarkerChild: child }
  }))

  it('keeps historical reports and legacy provenance separate from current Settings', () => lane(6, 'history', async (output) => {
    await preference('claude', 'changed-after-history')
    await openSession(historical.title)
    await click('Chat')
    const text = await historyText()
    assert.ok(text.some((entry) => entry.includes('Requested · claude-next-literal') && entry.includes('CLI report · claude-alias-resolved · Response metadata')))
    assert.deepEqual(database(historical.sessionId).runs.at(-1), historical.row)
    await browser.saveScreenshot(join(output, 'reported-history.png'))
    await openSession('M02 legacy schema 10')
    await click('Chat')
    const legacy = await read('get_chat', { sessionId: 'model-evidence-legacy-session' })
    assert.deepEqual(legacy.aiRuns.map((run) => run.modelSelection), [{ kind: 'legacy', value: 'ambiguous-old-model' }])
    assert.ok((await historyText()).some((entry) => entry.includes('Legacy model · ambiguous-old-model · Source unknown')))
    return { historicalSession: historical.sessionId, legacy: legacy.aiRuns, scope: 'Read-only historical projections remain independent from new Settings choices.' }
  }))

  it('shares the saved provider preference with another Session', () => lane(7, 'global-scope', async () => {
    const firstSession = await fresh('claude', 'M03 global first Session')
    await modelPreference('claude', 'global-scope-literal')
    const secondSession = await createSession('M03 global second Session')
    await click('Chat')
    assert.equal(await $(quickInput).getValue(), 'global-scope-literal')
    assert.match(await $(quickSection).getText(), /across QA Scribe/)
    return { firstSession, secondSession, scope: 'Shared per-provider preference. Dirty Settings draft races require rendered-controller coverage.' }
  }))

  it('preserves a newer custom choice when a catalog refresh returns late', () => lane(8, 'refresh-race', async () => {
    const sessionId = await fresh('codex', 'M03 refresh race')
    await modelPreference('codex', 'refresh-before-literal')
    configureCatalog('codex', 'delayed')
    const before = journal().length
    await settings()
    await $('[aria-label="Refresh CLI configuration"]').click()
    await $('.execution-overview.refreshing').waitForExist()
    await browser.waitUntil(() => journal().slice(before).some((entry) => entry.event === 'catalog-held'))
    await click('Back')
    await modelPreference('codex', 'refresh-new-literal')
    writeFileSync(join(directory, 'model-selection-catalog.release'), 'Release the actual catalog after the newer quick preference persisted.\n')
    await settings()
    await $('.execution-overview.refreshing').waitForExist({ reverse: true, timeout: 15_000 })
    await click('Back')
    assert.equal(await $(quickInput).getValue(), 'refresh-new-literal')
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.codex_cli, 'refresh-new-literal')
    configureCatalog('codex', 'fresh')
    return { sessionId, retained: 'refresh-new-literal' }
  }))

  it('delegates to CLI Default after an explicit override and omits the launch argument', () => lane(9, 'default', async () => {
    const sessionId = await fresh('claude', 'M03 return to Default')
    await modelPreference('claude', 'before-default-literal')
    await modelPreference('claude', null)
    assert.match(await $(quickInput).getValue(), /^CLI default/)
    const current = await send(sessionId, 'claude', 'init', 'M03-9')
    assert.equal(current.argv.includes('--model'), false)
    assert.deepEqual(current.row.selection, recorded(null, { source: 'claudeInitialization', id: 'claude-default-resolved' }))
    return { sessionId, ...current }
  }))

  it('saves independent choices before the actual native restart', () => lane(10, 'restart-pending', restartProof))
})
