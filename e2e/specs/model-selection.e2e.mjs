import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { click, createSession, database, directory, execution, finishChat, insertNote, journal, openSession,
  preference, read, refresh, settings } from './model-evidence-ui.mjs'
import { configureCatalog, generation, historyText, menuGeometry, modelPreference, outputRoot,
  quickInput, quickOptions, quickSection, send, switchProviderOnly, attachPickerDraftImage, openQuickPicker, pickerState, activeQuickOption, domModelKey } from './model-selection-ui.mjs'
import { inspectLayout, layoutViewport, wideLayoutViewport, minimumLayoutViewport } from './chat-layout-geometry.mjs'
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
  await click('Ask AI')
  const options = await $('.chat-options')
  if (!await browser.execute(node => node.open, options)) await (await options.$('summary')).click()
  await $(quickInput).waitForEnabled()
  return sessionId
}

async function restartProof() {
  const expected = { claude_code: 'restart-claude-literal', codex_cli: 'restart-codex-literal', copilot_cli: 'restart-copilot-literal' }
  if (!restart) {
    for (const [provider, id] of [['claude', 'claude_code'], ['codex', 'codex_cli'], ['copilot', 'copilot_cli']]) {
      await preference(provider, null)
      await click('Ask AI')
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
  await click('Ask AI')
  const options = await $('.chat-options')
  if (!await browser.execute(node => node.open, options)) await (await options.$('summary')).click()
  await $(quickInput).waitForEnabled()
  assert.equal(await $(quickInput).getValue(), previous.expected[restoredSettings.selectedAiProvider],
    'The first restored quick selection must be correct before any Settings write')
  const nativePid = journal().filter((entry) => entry.event === 'spawn').at(-1).parentPid
  assert.notEqual(nativePid, previous.nativePid)
  for (const provider of ['claude', 'codex', 'copilot']) {
    const model = previous.expected[{ claude: 'claude_code', codex: 'codex_cli', copilot: 'copilot_cli' }[provider]]
    await switchProviderOnly(provider, previous.expected)
    await click('Ask AI')
    assert.equal(await $(quickInput).getValue(), model)
    await $(`${quickSection} [aria-label="Open model choices"]`).click()
    const labels = []
    for (const entry of await quickOptions()) labels.push(await (await entry.$('strong')).getText())
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

  it('opens pointer choices outside transcript clipping and preserves the draft across narrow resize', async () => {
    await fresh('claude', 'M03 pointer geometry')
    const wide = await wideLayoutViewport()
    const short = await minimumLayoutViewport()
    try {
      const draft = 'Retained literal model layout draft'
      await $('[aria-label="Session chat"] textarea').setValue(draft)
      const samples = []
      for (const [width, height] of [[1280, wide.height], [360, 645], [320, 645], [640, short.height]]) {
        const actual = await layoutViewport(width, height)
        assert.deepEqual(actual, { width, height })
        const input = await $(quickInput)
        await input.scrollIntoView({ block: 'center', inline: 'nearest' })
        if (await input.getAttribute('aria-expanded') !== 'true') await input.click()
        await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
        const geometry = await menuGeometry()
        samples.push({ actual, geometry })
        writeFileSync(join(outputRoot, 'pointer-geometry.json'), JSON.stringify(samples, null, 2))
        await browser.saveScreenshot(join(outputRoot, `pointer-${width}-${height}.png`))
        assert.ok(geometry?.visible && geometry.options > 0, JSON.stringify(geometry))
        assert.ok(geometry.left >= geometry.panel.left && geometry.right <= geometry.panel.right
          && geometry.top >= geometry.panel.top && geometry.bottom <= geometry.panel.bottom, JSON.stringify(geometry))
        if (width === 1280) for (const row of geometry.rows) assert.ok(row.visible && row.hit, JSON.stringify(row))
        const reached = []
        for (const option of await quickOptions()) {
          await browser.execute(node => {
            const list = node.closest('[role="listbox"]')
            const r = node.getBoundingClientRect(), port = list.getBoundingClientRect()
            if (r.top < port.top) list.scrollTop += r.top - port.top
            else if (r.bottom > port.bottom) list.scrollTop += r.bottom - port.bottom
          }, option)
          await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
          const row = await browser.execute(inspectLayout, option)
          assert.ok(row.visible && row.hit, `Every option must be fully reachable through internal scrolling: ${JSON.stringify(row)}`)
          reached.push(row)
        }
        samples.at(-1).reached = reached
        writeFileSync(join(outputRoot, 'pointer-geometry.json'), JSON.stringify(samples, null, 2))
        assert.equal(await $('[aria-label="Session chat"] textarea').getValue(), draft)
        await $(`${quickSection} [aria-label="Open model choices"]`).click()
      }
      await layoutViewport(1280, wide.height)
      await $(quickInput).click()
      const queryStates = []
      const queryState = async stage => {
        queryStates.push({ stage, state: await browser.execute(selector => {
          const input = document.querySelector(selector)
          return { value: input.value, open: input.getAttribute('aria-expanded'), focused: document.activeElement === input,
            input: { top: input.getBoundingClientRect().top, bottom: input.getBoundingClientRect().bottom },
            owners: [input.closest('.chat-scroll-region'), input.closest('.session-chat')].map(node => ({ top: node.getBoundingClientRect().top,
              bottom: node.getBoundingClientRect().bottom, scrollTop: node.scrollTop, height: node.clientHeight })) }
        }, quickInput) })
        writeFileSync(join(outputRoot, 'query-resize.json'), JSON.stringify(queryStates, null, 2))
      }
      await queryState('before-query')
      await $(quickInput).setValue('fixture')
      await queryState('before-resize')
      assert.equal(await $(quickInput).getValue(), 'fixture', 'Typing must establish the searched query before resize')
      await layoutViewport(1100, wide.height)
      await queryState('after-resize')
      assert.equal(await $(quickInput).getValue(), 'fixture', 'An open query must survive viewport resize')
      await browser.execute(selector => {
        const owner = document.querySelector(selector).closest('.chat-scroll-region')
        owner.scrollTop = Math.max(0, owner.scrollTop - 8)
      }, quickInput)
      await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
      assert.equal((await menuGeometry()).visible, true, 'The open popup must track ancestor scrolling')
      await $(quickInput).setValue('')
      const selected = (await quickOptions()).at(-1)
      await selected.click()
      await browser.waitUntil(async () => (await read('get_settings')).selectedAiModelsByProvider.claude_code === 'claude-fixture')
      assert.equal(await $('[aria-label="Session chat"] textarea').getValue(), draft)
    } finally {
      await layoutViewport(1280, wide.height)
    }
  })

  it('keeps a wrapped 40-model catalog visible, navigable, and draft-safe at the short supported viewport', async () => {
    const wide = await wideLayoutViewport()
    const short = await minimumLayoutViewport()
    const samples = []
    const keyboard = { method: 'DOM-key diagnostic; not OS delivery proof', imageInput: 'DOM file-input fixture; not OS dialog proof' }
    const persist = () => writeFileSync(join(outputRoot, 'long-catalog.json'), JSON.stringify({ keyboard, samples }, null, 2))
    const key = domModelKey
    try {
      configureCatalog('claude', 'long-catalog')
      await settings(); await refresh(); await click('Back')
      const sessionId = await fresh('claude', 'M03 long catalog geometry')
      const draft = 'Retained long catalog draft with a local image'
      await $('[aria-label="Session chat"] textarea').waitForEnabled()
      await $('[aria-label="Session chat"] textarea').setValue(draft)
      const held = await attachPickerDraftImage(sessionId)
      assert.equal(held.composer, draft)
      for (const [width, height] of [[640, short.height], [1280, wide.height], [360, 645], [320, 645]]) {
        assert.deepEqual(await layoutViewport(width, height), { width, height })
        await $(quickInput).scrollIntoView({ block: 'center', inline: 'nearest' })
        if (await $(quickInput).getAttribute('aria-expanded') === 'true') await $(`${quickSection} [aria-label="Open model choices"]`).click()
        const before = await pickerState()
        await openQuickPicker()
        const sample = { viewport: { width, height }, before, state: await pickerState(), geometry: await menuGeometry(), navigation: [] }
        samples.push(sample); persist()
        await browser.saveScreenshot(join(outputRoot, `long-catalog-${width}-${height}.png`))
        assert.equal(sample.state.expanded, 'true')
        assert.equal(sample.state.visibility, 'visible', JSON.stringify(sample.state))
        assert.equal(sample.state.count, 41)
        assert.ok(sample.geometry.visible, JSON.stringify(sample.geometry))
        const input = await browser.execute(inspectLayout, await $(quickInput))
        assert.ok(input.visible && input.hit, 'The aligned query must remain fully visible and hit-testable')
        assert.match(sample.state.hintText, /40 models reported by CLI catalog/)
        if (width === 640) assert.ok(sample.state.hintLines >= 2, 'The regression must retain the wrapped hint')
        await browser.execute(selector => document.querySelector(selector).focus({ preventScroll: true }), quickInput)
        await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
        const owners = (await pickerState()).owners
        for (const [name, index] of [['Home', 0], ['End', 40], ['ArrowUp', 39], ['ArrowDown', 40]]) {
          await key(name)
          const state = await pickerState(), active = await activeQuickOption()
          sample.navigation.push({ key: name, state, active }); persist()
          assert.ok(state.activeId.endsWith(`-option-${index}`), JSON.stringify(state))
          assert.ok(active.visible && active.hit, `The entire active option must be reachable: ${JSON.stringify(active)}`)
          assert.deepEqual(state.owners, owners, 'Option traversal must scroll only the owned list')
          assert.equal(state.focused, true)
          assert.equal(state.visibility, 'visible')
        }
        await key('Escape')
        assert.equal(await $(quickInput).getAttribute('aria-expanded'), 'false')
        assert.deepEqual((await read('get_chat', { sessionId })).composerImages, held.composerImages)
        assert.equal(await $('[aria-label="Session chat"] textarea').getValue(), draft)
      }
      await openQuickPicker()
      await browser.execute(selector => document.querySelector(selector).focus({ preventScroll: true }), quickInput)
      samples.push({ stage: 'before-exact-query', state: await pickerState() }); persist()
      await $(quickInput).setValue('literal-model-39')
      samples.push({ stage: 'exact-query', state: await pickerState() }); persist()
      assert.equal((await quickOptions()).length, 1)
      await $(quickInput).setValue('synthetic-custom-catalog-id')
      samples.push({ stage: 'custom-query', state: await pickerState() }); persist()
      assert.deepEqual(await layoutViewport(640, short.height), { width: 640, height: short.height })
      const custom = await pickerState(); samples.push({ stage: 'custom-resize', state: custom }); persist()
      assert.equal(custom.query, 'synthetic-custom-catalog-id')
      assert.ok(custom.focused && custom.visibility === 'visible')
      assert.equal((await quickOptions()).length, 1)
      await (await quickOptions())[0].click()
      await browser.waitUntil(async () => (await read('get_settings')).selectedAiModelsByProvider.claude_code === 'synthetic-custom-catalog-id' && await $(quickInput).isEnabled())
      await openQuickPicker(); await key('End')
      await (await quickOptions()).at(-1).click()
      await browser.waitUntil(async () => (await read('get_settings')).selectedAiModelsByProvider.claude_code === 'literal-model-39' && await $(quickInput).isEnabled())
      const focus = { stage: 'saved-literal-focus', state: null }
      samples.push(focus)
      await browser.waitUntil(async () => {
        focus.state = await pickerState(); persist()
        return focus.state.focused
      }, { timeout: 2000, timeoutMsg: 'The saved model choice must return focus to the Model input' })
      assert.equal(focus.state.focused, true)
      await openQuickPicker(); await $('[aria-label="Session chat"] textarea').click()
      assert.equal((await pickerState()).expanded, 'false')
      await openQuickPicker(); await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').click()
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('.model-combobox-popover--chat')))
      const retained = await read('get_chat', { sessionId })
      assert.equal(retained.composer, draft)
      assert.deepEqual(retained.composerImages, held.composerImages)
      assert.equal(database(sessionId).runs.length, 0, 'Picker use cannot launch a provider response')
      samples.push({ stage: 'closed', composer: retained.composer, images: retained.composerImages }); persist()
    } finally {
      await layoutViewport(1280, wide.height)
      configureCatalog('claude', 'fresh')
      await settings(); await refresh(); await click('Back')
    }
  }).timeout(60_000)

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
    assert.equal(geometry.visible, true, `Clipping ancestors must expose the entire menu: ${JSON.stringify(geometry)}`)
    await browser.saveScreenshot(join(output, 'open-keyboard-menu.png'))
    await key(Key.End)
    const activeId = await $(quickInput).getAttribute('aria-activedescendant')
    const active = await browser.execute(() => {
      const input = document.querySelector('[aria-label="Next invocation model"] [role="combobox"]')
      const row = document.getElementById(input.getAttribute('aria-activedescendant'))
      const list = row.closest('[role="listbox"]')
      const r = row.getBoundingClientRect(), port = list.getBoundingClientRect()
      return { id: row.id, visible: r.top >= port.top - 1 && r.bottom <= port.bottom + 1,
        hit: row.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)) }
    })
    assert.equal(active.id, activeId)
    assert.ok(active.visible && active.hit, JSON.stringify(active))
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
    await click('Ask AI')
    const text = await historyText()
    assert.ok(text.some((entry) => entry.includes('Requested · claude-next-literal') && entry.includes('CLI report · claude-alias-resolved · Response metadata')))
    assert.deepEqual(database(historical.sessionId).runs.at(-1), historical.row)
    await browser.saveScreenshot(join(output, 'reported-history.png'))
    await openSession('M02 legacy schema 10')
    await click('Ask AI')
    const legacy = await read('get_chat', { sessionId: 'model-evidence-legacy-session' })
    assert.deepEqual(legacy.aiRuns.map((run) => run.modelSelection), [{ kind: 'legacy', value: 'ambiguous-old-model' }])
    assert.ok((await historyText()).some((entry) => entry.includes('Legacy model · ambiguous-old-model · Source unknown')))
    return { historicalSession: historical.sessionId, legacy: legacy.aiRuns, scope: 'Read-only historical projections remain independent from new Settings choices.' }
  }))

  it('shares the saved provider preference with another Session', () => lane(7, 'global-scope', async () => {
    const firstSession = await fresh('claude', 'M03 global first Session')
    await modelPreference('claude', 'global-scope-literal')
    const secondSession = await createSession('M03 global second Session')
    await click('Ask AI')
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
