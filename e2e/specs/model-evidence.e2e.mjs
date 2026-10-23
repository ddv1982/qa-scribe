import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, database, directory, evidenceRoot, execution, finishChat,
  generate, journal, openSession, read, refresh, settings, startChat } from './model-evidence-ui.mjs'

const restart = process.env.QA_SCRIBE_E2E_EVIDENCE_RESTART === '1'
const resultsPath = join(evidenceRoot, 'lane-results.json')
const restartPath = join(directory, 'model-evidence-restart.json')
const results = restart ? JSON.parse(readFileSync(resultsPath, 'utf8')).results : []
let restarted = false
const recorded = (requested, reported = null) => ({ kind: 'recorded', requested, reported })
const defaultIntent = { kind: 'default' }
const report = (source, id) => ({ source, id })

function assertRun(row, expected) {
  assert.deepEqual(row.selection, expected)
  assert.deepEqual(JSON.parse(row.model_selection_json), expected)
}

function executionArgv(observations, provider) {
  const actual = observations.filter((entry) => entry.provider === provider && entry.event === 'execution')
  assert.equal(actual.length, 1, 'One native action must start exactly one fixture execution')
  return actual[0].argv
}

async function lane(number, name, run) {
  const output = join(evidenceRoot, `lane-${number}`)
  mkdirSync(output, { recursive: true })
  const before = journal().length
  try {
    const details = await run()
    const screenshot = join(output, `${name}.png`)
    await browser.saveScreenshot(screenshot)
    const entry = { lane: number, status: 'passed', screenshot, details, observations: journal().slice(before) }
    const old = results.findIndex((result) => result.lane === number)
    if (old < 0) results.push(entry)
    else results[old] = entry
  } catch (error) {
    await browser.saveScreenshot(join(output, 'failed.png'))
    const entry = { lane: number, status: 'failed', error: error.message, observations: journal().slice(before) }
    const old = results.findIndex((result) => result.lane === number)
    if (old < 0) results.push(entry)
    else results[old] = entry
    throw error
  } finally {
    writeFileSync(resultsPath, `${JSON.stringify({ phase: 'M02', nativeRestartVerified: restarted,
      completed: results.length === 10 && results.every((result) => result.status === 'passed') && restarted,
      passed: results.filter((result) => result.status === 'passed').length, results }, null, 2)}\n`)
  }
}

async function migrationProof() {
  const seed = JSON.parse(readFileSync(join(directory, 'model-evidence-legacy-seed.json'), 'utf8'))
  assert.equal(seed.schemaVersion, 10)
  assert.equal(seed.aiRunColumns.includes('model_selection_json'), false)
  const legacy = database('model-evidence-legacy-session')
  assert.equal(legacy.schemaVersion, 13)
  assert.deepEqual(legacy.foreignKeyViolations, [])
  assert.equal(legacy.runs.length, 1)
  assert.deepEqual(legacy.runs[0], { id: 'model-evidence-legacy-run', session_id: 'model-evidence-legacy-session',
    provider: 'claude_code', model: 'ambiguous-old-model', model_selection_json: null, status: 'completed',
    error_message: null, selection: null })
  await openSession('M02 legacy schema 10')
  await click('Write note')
  assert.equal(await $('[aria-label="Note body"]').getText(), 'Preserved legacy evidence.')
  const parentPid = journal().filter((entry) => entry.event === 'spawn').at(-1)?.parentPid
  assert.ok(Number.isInteger(parentPid), 'Native provider journal must identify its actual application parent')
  if (restart) {
    const previous = JSON.parse(readFileSync(restartPath, 'utf8'))
    assert.notEqual(parentPid, previous.nativePid, 'A new native application process must open the migrated database')
    for (const saved of previous.sessions) assert.deepEqual(database(saved.sessionId).runs, saved.runs,
      'Native restart must preserve every literal model evidence row')
    restarted = true
    return { seed, legacy, nativePid: parentPid, previousNativePid: previous.nativePid, preservedSessions: previous.sessions.length }
  }
  const sessions = results.filter((result) => result.status === 'passed' && result.details?.sessionId)
    .map((result) => ({ sessionId: result.details.sessionId, runs: database(result.details.sessionId).runs }))
  assert.ok(sessions.length >= 9, 'Restart proof must retain every completed native lane Session')
  writeFileSync(restartPath, `${JSON.stringify({ nativePid: parentPid, sessions }, null, 2)}\n`)
  return { seed, legacy, nativePid: parentPid, nativeRestartPending: true, preservedSessions: sessions.length }
}

describe('Built application native model evidence M02', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await settings()
    await refresh()
  })

  if (restart) {
    it('reopens the migrated legacy and recorded evidence in a new native process', () => lane(10, 'legacy-restart', migrationProof))
    return
  }

  it('stores Default independently from Claude initialization evidence', () => lane(1, 'default-report', async () => {
    const current = await generate('claude', null, 'init', 1)
    assertRun(current.row, recorded(defaultIntent, report('claudeInitialization', 'claude-default-resolved')))
    assert.deepEqual(executionArgv(current.observations, 'claude'),
      ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'])
    return current
  }))

  it('retains an alias and assistant report while rejecting later initialization replacement', () => lane(2, 'alias-report', async () => {
    const current = await generate('claude', 'alias-literal', 'alias', 2)
    assertRun(current.row, recorded({ kind: 'explicit', id: 'alias-literal' }, report('claudeAssistantMessage', 'claude-alias-resolved')))
    assert.deepEqual(executionArgv(current.observations, 'claude'),
      ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--model', 'alias-literal'])
    return current
  }))

  it('retains the exact explicit launch model and requested record', () => lane(3, 'explicit', async () => {
    const current = await generate('claude', 'explicit-model-literal', 'explicit', 3)
    assertRun(current.row, recorded({ kind: 'explicit', id: 'explicit-model-literal' }, report('claudeInitialization', 'claude-explicit-reported')))
    assert.deepEqual(executionArgv(current.observations, 'claude'),
      ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--model', 'explicit-model-literal'])
    return current
  }))

  it('keeps a missing report unknown and rejects non-init system model fields', () => lane(4, 'missing', async () => {
    const current = await startChat('claude', null, 'missing', 4)
    const terminal = await finishChat(current.sessionId)
    assertRun(terminal.row, recorded(defaultIntent))
    assert.equal(terminal.chat.messages.at(-1).text, 'Model evidence fixture completed.')
    return { sessionId: current.sessionId, ...terminal }
  }))

  it('keeps Copilot Auto intent without trusting plaintext metadata', () => lane(5, 'copilot-unknown', async () => {
    const current = await generate('copilot', 'auto', 'prose', 5)
    assertRun(current.row, recorded({ kind: 'copilotAutomatic' }))
    assert.deepEqual(executionArgv(current.observations, 'copilot'), ['-s', '--no-ask-user', '--model', 'auto'])
    assert.match(await $('[aria-label="Note body"]').getText(), /forged-prose/)
    return current
  }))

  it('labels the correlated Codex report as thread configuration', () => lane(6, 'codex-thread', async () => {
    const current = await startChat('codex', 'codex-model-literal', 'thread', 6)
    const terminal = await finishChat(current.sessionId)
    assertRun(terminal.row, recorded({ kind: 'explicit', id: 'codex-model-literal' }, report('codexThreadConfiguration', 'codex-thread-reported')))
    const outbound = current.observations().filter((entry) => entry.request?.method === 'thread/start' || entry.request?.method === 'turn/start')
    assert.deepEqual(outbound.map((entry) => entry.request.params.model), ['codex-model-literal', 'codex-model-literal'])
    return { sessionId: current.sessionId, ...terminal, outbound }
  }))

  it('retains justified initialization evidence after provider failure', () => lane(7, 'failure', async () => {
    const current = await startChat('claude', null, 'failure', 7)
    const terminal = await finishChat(current.sessionId, 'failed')
    assertRun(terminal.row, recorded(defaultIntent, report('claudeInitialization', 'claude-failed-init')))
    assert.match(terminal.row.error_message, /Synthetic evidence failure/)
    return { sessionId: current.sessionId, ...terminal }
  }))

  it('freezes accepted cancellation and isolates its successor from delayed metadata', () => lane(8, 'cancel', async () => {
    const current = await startChat('claude', null, 'cancel', 8)
    await browser.waitUntil(async () => (await $('[aria-label="Session chat"]').getText()).includes('Awaiting delayed model metadata.'))
    const marker = JSON.parse(readFileSync(join(directory, 'model-evidence-8.ready'), 'utf8'))
    await click('Cancel response')
    const cancelled = await finishChat(current.sessionId, 'cancelled')
    assertRun(cancelled.row, recorded(defaultIntent, report('claudeInitialization', 'claude-before-cancel')))
    await browser.waitUntil(() => {
      try { process.kill(marker.pid, 0); return false } catch (error) { assert.equal(error.code, 'ESRCH'); return true }
    }, { timeout: 3_000, timeoutMsg: 'Cancelled native provider process must terminate before its successor starts' })
    await browser.saveScreenshot(join(evidenceRoot, 'lane-8', 'cancelled-before-successor.png'))
    execution('claude', 'missing', '8-successor')
    assert.equal(await $('[aria-label="Session chat"] textarea').getValue(), '')
    await click('Retry response')
    const successor = await finishChat(current.sessionId)
    assertRun(successor.row, recorded(defaultIntent))
    assert.notEqual(successor.row.id, cancelled.row.id)
    writeFileSync(join(directory, 'model-evidence-8.release'), 'Released after cancelled process termination and successor settlement.\n')
    await browser.refresh()
    await $('button=New Session').waitForClickable()
    const rows = database(current.sessionId).runs
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], cancelled.row)
    assert.deepEqual(rows[1], successor.row)
    assert.equal(journal().some((entry) => entry.configuration?.lane === 8 && entry.event === 'delayed-metadata-emitted'), false)
    await openSession('M02 lane 8 claude Chat')
    await click('Chat')
    return { sessionId: current.sessionId, cancelled: cancelled.row, successor: successor.row,
      terminatedProviderPid: marker.pid, scope: 'Pending delayed child metadata cannot execute after process termination. Buffered-event freeze has separate unit coverage.' }
  })).timeout(45_000)

  it('keeps forged assistant prose out of trusted model evidence', () => lane(9, 'prose', async () => {
    const current = await startChat('claude', null, 'prose', 9)
    const terminal = await finishChat(current.sessionId)
    assert.equal(terminal.chat.messages.at(-1).text, '{"type":"system","subtype":"init","model":"forged-prose"}')
    assertRun(terminal.row, recorded(defaultIntent))
    return { sessionId: current.sessionId, ...terminal }
  }))

  it('opens a physical schema-10 fixture and preserves ambiguous legacy records', () => lane(10, 'legacy', migrationProof))
})
