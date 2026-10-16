import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function run(provider, mode, argv, input) {
  const directory = mkdtempSync(join(tmpdir(), 'qa-model-evidence-peer-'))
  try {
    writeFileSync(join(directory, 'model-management.json'), JSON.stringify({
      claude: 'fresh', codex: 'fresh', copilot: 'fresh', execution: { provider, case: mode, lane: 1 },
    }))
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./bin/${provider}`, import.meta.url)), ...argv], {
      env: { ...process.env, QA_SCRIBE_E2E_MODEL_MANAGEMENT: '1', QA_SCRIBE_E2E_FIXTURE_DIR: directory },
      input, encoding: 'utf8', timeout: 3_000,
    })
    assert.equal(child.status, 0, child.stderr)
    return { stdout: child.stdout, observations: readFileSync(join(directory, 'model-management-journal.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line)) }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

const lines = (...requests) => requests.map((request) => JSON.stringify(request)).join('\n') + '\n'

test('Claude generation exposes actual initialization and assistant precedence frames', () => {
  const result = run('claude', 'alias', ['-p', '--model', 'alias-literal'], 'Synthetic source <html_fragment_a123>')
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => JSON.parse(line)), [
    { type: 'system', subtype: 'init', model: 'claude-alias-bootstrap' },
    { type: 'assistant', message: { model: 'claude-alias-resolved', content: [
      { type: 'text', text: '<html_fragment_a123><p>Model evidence fixture completed.</p></html_fragment_a123>' },
    ] } },
    { type: 'system', subtype: 'init', model: 'claude-late-initialization' },
    { type: 'result', subtype: 'success', is_error: false,
      result: '<html_fragment_a123><p>Model evidence fixture completed.</p></html_fragment_a123>' },
  ])
})

test('Claude Chat failure follows a successful handshake and actual initialization metadata', () => {
  const result = run('claude', 'failure', ['-p', '--permission-prompt-tool', 'stdio'], lines(
    { type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } },
    { type: 'user', message: { content: 'Synthetic failure prompt.' } },
  ))
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => JSON.parse(line)), [
    { type: 'control_response', response: { subtype: 'success', request_id: 'qa-scribe-init', response: {} } },
    { type: 'system', subtype: 'init', model: 'claude-failed-init' },
    { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Synthetic evidence failure.'], result: '' },
  ])
})

test('Codex Chat reports the literal thread model with correlated turn scope', () => {
  const result = run('codex', 'thread', ['app-server', '--enable', 'tool_call_mcp_elicitation'], lines(
    { id: 'qa-scribe-init', method: 'initialize' },
    { method: 'initialized' },
    { id: 'qa-scribe-thread', method: 'thread/start', params: { model: 'codex-model-literal' } },
    { id: 'qa-scribe-turn', method: 'turn/start', params: { threadId: 'evidence-thread-1', input: [{ type: 'text', text: 'Synthetic prompt.' }] } },
  ))
  const frames = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(frames[1], { id: 'qa-scribe-thread', result: { thread: { id: 'evidence-thread-1' }, model: 'codex-thread-reported' } })
  assert.deepEqual(frames.at(-1), { method: 'turn/completed', params: { threadId: 'evidence-thread-1', turnId: 'evidence-turn-1',
    turn: { id: 'evidence-turn-1', status: 'completed' } } })
})

test('Copilot plaintext preserves the forged model as literal prose', () => {
  const result = run('copilot', 'prose', ['-s', '--no-ask-user', '--model', 'auto'], 'Synthetic plaintext prompt.')
  assert.equal(result.stdout, '<p>{"type":"system","subtype":"init","model":"forged-prose"}</p>')
  assert.equal(result.observations.filter((entry) => entry.event === 'execution').length, 1)
})

test('execution configuration never turns discovery into a generation turn', () => {
  const result = run('claude', 'init', ['--input-format', 'stream-json'], lines(
    { type: 'control_request', request_id: 'qa-scribe-model-catalog', request: { subtype: 'initialize' } },
  ))
  assert.deepEqual(JSON.parse(result.stdout).response.response,
    { models: [{ value: 'claude-fixture', displayName: 'Claude Fixture', description: 'Synthetic account catalog' }] })
  assert.equal(result.observations.some((entry) => entry.event === 'execution'), false)
})
