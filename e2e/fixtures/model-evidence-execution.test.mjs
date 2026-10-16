import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      input: typeof input === 'function' ? input(directory) : input, encoding: 'utf8', timeout: 3_000,
    })
    assert.equal(child.status, 0, child.stderr)
    const markerPath = join(directory, 'model-evidence-1.executed.json')
    return { stdout: child.stdout, marker: existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null, observations: readFileSync(join(directory, 'model-management-journal.jsonl'), 'utf8')
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


test('Copilot execution peer completes its real ACP session without fabricating model evidence', () => {
  const result = run('copilot', 'missing', ['--acp', '--model', 'auto'], lines(
    { id: 'init', method: 'initialize' }, { id: 'session', method: 'session/new' },
    { id: 'prompt', method: 'session/prompt', params: { sessionId: 'model-selection-copilot-1', prompt: [{ text: 'Synthetic Copilot prompt.' }] } },
  ))
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => JSON.parse(line)), [
    { jsonrpc: '2.0', id: 'init', result: { protocolVersion: 1, agentCapabilities: {} } },
    { jsonrpc: '2.0', id: 'session', result: { sessionId: 'model-selection-copilot-1' } },
    { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'model-selection-copilot-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Model evidence fixture completed.' } } } },
    { jsonrpc: '2.0', id: 'prompt', result: { stopReason: 'end_turn' } },
  ])
})

test('held Claude permission keeps its correlation and runs one actual marker child after approval', () => {
  const result = run('claude', 'permission', ['-p', '--permission-prompt-tool', 'stdio'], (directory) => lines(
    { type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } },
    { type: 'user', message: { content: 'Synthetic held Chat prompt.' } },
    { type: 'control_response', response: { subtype: 'success', request_id: 'model-selection-permission-1',
      response: { behavior: 'allow', updatedInput: { command: 'fixture-marker-child', marker: join(directory, 'model-evidence-1.executed.json') } } } },
  ))
  const frames = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(frames.find((event) => event.type === 'control_request').request_id, 'model-selection-permission-1')
  assert.ok(frames.find((event) => event.type === 'stream_event').event.delta.text.length >= 512)
  assert.equal(frames.find((event) => event.type === 'assistant').message.model, 'claude-active-reported')
  const peer = result.observations.find((entry) => entry.event === 'execution')
  assert.equal(result.marker.parent, peer.pid)
  assert.notEqual(result.marker.pid, peer.pid)
  assert.equal(result.observations.filter((entry) => entry.event === 'permission-decision').length, 1)
})


const terminalCases = [
  { name: 'Claude generation', provider: 'claude', mode: 'init', argv: ['-p'], input: 'Synthetic scheduling source.',
    terminal: { type: 'result', subtype: 'success', is_error: false, result: '<p>Model evidence fixture completed.</p>' } },
  { name: 'Claude Chat', provider: 'claude', mode: 'init', argv: ['-p', '--permission-prompt-tool', 'stdio'], input: lines(
    { type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } },
    { type: 'user', message: { content: 'Synthetic scheduling Chat prompt.' } },
  ), terminal: { type: 'result', subtype: 'success', is_error: false, result: 'Model evidence fixture completed.' } },
  { name: 'Codex Chat', provider: 'codex', mode: 'thread', argv: ['app-server', '--enable', 'tool_call_mcp_elicitation'], input: lines(
    { id: 'qa-scribe-init', method: 'initialize' }, { method: 'initialized' },
    { id: 'qa-scribe-thread', method: 'thread/start', params: { model: 'codex-model-literal' } },
    { id: 'qa-scribe-turn', method: 'turn/start', params: { threadId: 'evidence-thread-1', input: [{ type: 'text', text: 'Synthetic scheduling prompt.' }] } },
  ), terminal: { method: 'turn/completed', params: { threadId: 'evidence-thread-1', turnId: 'evidence-turn-1',
    turn: { id: 'evidence-turn-1', status: 'completed' } } } },
  { name: 'Copilot Chat', provider: 'copilot', mode: 'missing', argv: ['--acp', '--model', 'auto'], input: lines(
    { id: 'init', method: 'initialize' }, { id: 'session', method: 'session/new' },
    { id: 'prompt', method: 'session/prompt', params: { sessionId: 'model-selection-copilot-1', prompt: [{ text: 'Synthetic scheduling prompt.' }] } },
  ), terminal: { jsonrpc: '2.0', id: 'prompt', result: { stopReason: 'end_turn' } } },
  { name: 'Claude failed Chat', provider: 'claude', mode: 'failure', argv: ['-p', '--permission-prompt-tool', 'stdio'], input: lines(
    { type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } },
    { type: 'user', message: { content: 'Synthetic scheduling failure.' } },
  ), terminal: { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Synthetic evidence failure.'], result: '' } },
]

for (const scenario of terminalCases) {
  test(`terminal readiness is committed before ${scenario.name} can be terminated`, { timeout: 5_000 }, async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'qa-model-evidence-terminal-'))
    const hook = join(directory, 'pause-after-terminal.cjs')
    writeFileSync(hook, `const { writeSync } = require('node:fs')
const original = process.stdout.write.bind(process.stdout)
process.stdout.write = function(chunk, ...args) {
  let frame
  try { frame = JSON.parse(String(chunk)) } catch { return original(chunk, ...args) }
  if (frame.type === 'result' || frame.method === 'turn/completed' || frame.result?.stopReason === 'end_turn') {
    writeSync(1, chunk)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
  }
  return original(chunk, ...args)
}
`)
    writeFileSync(join(directory, 'model-management.json'), JSON.stringify({ execution: {
      provider: scenario.provider, case: scenario.mode, lane: 1,
    } }))
    const child = spawn(process.execPath, ['--require', hook,
      fileURLToPath(new URL(`./bin/${scenario.provider}`, import.meta.url)), ...scenario.argv], {
      env: { ...process.env, QA_SCRIBE_E2E_MODEL_MANAGEMENT: '1', QA_SCRIBE_E2E_FIXTURE_DIR: directory },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const closed = once(child, 'close')
    const output = createInterface({ input: child.stdout })
    let diagnostic = ''
    child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(0, 4096) })
    const terminal = new Promise((resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
      child.once('error', reject)
      output.on('line', (line) => {
        try {
          const frame = JSON.parse(line)
          if (frame.type === 'result' || frame.method === 'turn/completed' || frame.result?.stopReason === 'end_turn') resolve(frame)
        } catch (error) { reject(error) }
      })
      child.once('close', () => reject(new Error(`Fixture exited before terminal frame: ${diagnostic}`)))
    })
    try {
      child.stdin.end(scenario.input)
      const received = await terminal
      const markerPath = join(directory, 'model-evidence-1.ready')
      const markerAtTerminal = existsSync(markerPath)
      child.kill('SIGKILL')
      const [code, signal] = await closed
      const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null
      context.diagnostic(JSON.stringify({ provider: scenario.provider, case: scenario.name, received,
        markerAtTerminal, marker, childPid: child.pid, code, signal }))
      assert.deepEqual(received, scenario.terminal)
      assert.equal(signal, 'SIGKILL', 'The parent must terminate the real blocked fixture at terminal receipt')
      assert.equal(markerAtTerminal, true, 'Readiness must exist when the parent receives the terminal frame')
      assert.deepEqual(marker, { pid: child.pid, parentPid: process.pid, argv: scenario.argv })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
      output.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
