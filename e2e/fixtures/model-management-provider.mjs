import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsonLines, emit } from './chat-authorization-common.mjs'
import { modelEvidenceExecution } from './model-evidence-execution.mjs'

const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const configurationPath = directory && join(directory, 'model-management.json')
export const modelManagementEnabled = process.env.QA_SCRIBE_E2E_MODEL_MANAGEMENT === '1'
  && Boolean(configurationPath && existsSync(configurationPath))

export function modelManagementFixture(provider, argv) {
  assert.ok(modelManagementEnabled, 'Model fixture requires its explicit isolated configuration')
  const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'))
  const mode = configuration[provider] ?? 'fresh'
  const record = (event) => appendFileSync(join(directory, 'model-management-journal.jsonl'),
    `${JSON.stringify({ provider, mode, pid: process.pid, parentPid: process.ppid, ...event })}\n`)
  record({ event: 'spawn', argv })
  const rpc = (id, result, error, framed = false) => {
    const response = JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })
    process.stdout.write(framed ? `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}` : `${response}\n`)
  }
  if (argv.includes('--version') || argv[0] === 'version') {
    process.stdout.write({ claude: '2.1.50 (Claude Code)\n', codex: 'codex-cli 0.163.0\n', copilot: '1.0.70\n' }[provider])
    return
  }
  if (argv.includes('--help')) {
    process.stdout.write(provider === 'copilot'
      ? 'Usage: copilot --prompt <prompt> --model <model> --acp\n'
      : 'Usage: claude --model <model> --input-format stream-json\n')
    return
  }
  if (argv[0] === 'auth' || argv[0] === 'login') {
    process.stdout.write(provider === 'codex' ? 'Logged in using ChatGPT\n' : '{"loggedIn":true}\n')
    return
  }
  if (provider === 'codex' && argv[0] === 'debug') { emit({ models: [] }); return }
  if (modelEvidenceExecution(provider, argv, configuration.execution, record)) return
  if (provider === 'claude') {
    jsonLines((request) => {
      record({ event: 'request', request })
      assert.deepEqual(request, { type: 'control_request', request_id: 'qa-scribe-model-catalog', request: { subtype: 'initialize' } },
        'Claude discovery cannot send a prompt or create a session')
      emit({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id,
        response: { models: [{ value: 'claude-fixture', displayName: 'Claude Fixture', description: 'Synthetic account catalog' }] } } })
    })
    return
  }
  if (provider === 'codex' && argv[0] === 'app-server') {
    jsonLines((request) => {
      record({ event: 'request', request })
      switch (request.method) {
        case 'initialize': rpc(request.id, {}); break
        case 'initialized': break
        case 'config/read': rpc(request.id, { config: { model: 'codex-page-one' }, layers: [] }); break
        case 'model/list': {
          assert.deepEqual(request.params, request.params.cursor
            ? { limit: 100, cursor: 'fixture-page-2' } : { limit: 100 })
          rpc(request.id, request.params.cursor
            ? { data: [{ model: 'codex-page-two', displayName: 'Codex Page Two', hidden: false }], nextCursor: null }
            : { data: [{ model: 'codex-page-one', displayName: 'Codex Page One', hidden: false },
              { model: 'codex-hidden', displayName: 'Codex Hidden', hidden: true }], nextCursor: 'fixture-page-2' })
          break
        }
        default: throw new Error(`Catalog cannot issue ${request.method}`)
      }
    })
    return
  }
  if (provider === 'copilot' && argv.includes('--server')) {
    contentLengthFrames((request) => {
      record({ event: 'request', request })
      const respond = (result, error) => rpc(request.id, result, error, true)
      switch (request.method) {
        case 'connect': respond({ ok: true, protocolVersion: mode === 'unsupported' ? 99 : 3, version: '1.0.70' }); break
        case 'status.get': respond({ protocolVersion: 3, version: '1.0.70' }); break
        case 'auth.getStatus': respond({ isAuthenticated: mode !== 'signed-out' }); break
        case 'models.list':
          if (mode === 'timeout') {
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
            record({ event: 'stalled', childPid: child.pid })
            setInterval(() => {}, 1000)
          } else if (mode === 'denial') {
            respond(undefined, { code: -32603, message: 'Request models.list failed with message: 403 "unauthorized: not authorized to use this copilot feature\\n"' })
          } else if (mode === 'unavailable') {
            respond(undefined, { code: -32000, message: 'Request unavailable', data: { statusCode: 503 } })
          } else {
            respond({ models: [{ id: 'copilot-fixture', name: 'Copilot Fixture', policy: { state: 'enabled' } },
              ...(mode === 'policy' ? [
                { id: 'copilot-blocked', name: 'Copilot Blocked', policy: { state: 'disabled' } },
                { id: 'copilot-unconfigured', name: 'Copilot Unconfigured', policy: { state: 'unconfigured' } },
              ] : [])] })
          }
          break
        case 'runtime.shutdown': respond({}); break
        default: throw new Error(`Catalog cannot issue ${request.method}`)
      }
    })
    return
  }
  if (provider === 'copilot' && argv.includes('--acp')) {
    let sessionId
    jsonLines((request) => {
      record({ event: 'request', request })
      if (request.method === 'initialize') rpc(request.id, { protocolVersion: 1, agentCapabilities: {} })
      else if (request.method === 'session/new') {
        sessionId = `model-fixture-${process.pid}`
        rpc(request.id, { sessionId })
      } else if (request.method === 'session/prompt') {
        assert.equal(request.params.sessionId, sessionId)
        emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Model selection fixture completed.' } } } })
        rpc(request.id, { stopReason: 'end_turn' })
      } else throw new Error(`Unexpected Copilot execution request ${request.method}`)
    })
    return
  }
  if (provider === 'copilot' && argv.includes('-s')) {
    let prompt = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { prompt += chunk })
    process.stdin.on('end', () => {
      record({ event: 'prompt', prompt })
      const marker = prompt.match(/<html_fragment_[a-f0-9]+>/i)?.[0]?.slice(1, -1)
      const html = '<h2>Model fixture finding</h2><p>Model selection fixture completed.</p>'
      process.stdout.write(marker ? `<${marker}>${html}</${marker}>` : html)
    })
    return
  }
  throw new Error(`Unsupported model fixture ${provider} invocation ${argv.join(' ')}`)
}

function contentLengthFrames(handle) {
  let buffered = Buffer.alloc(0)
  process.stdin.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    for (;;) {
      const separator = buffered.indexOf('\r\n\r\n')
      if (separator < 0) return
      const length = Number(buffered.subarray(0, separator).toString().match(/Content-Length:\s*(\d+)/i)?.[1])
      assert.ok(Number.isInteger(length) && length > 0 && length <= 1024 * 1024, 'Bounded valid discovery frame')
      if (buffered.length < separator + 4 + length) return
      const request = JSON.parse(buffered.subarray(separator + 4, separator + 4 + length).toString())
      buffered = buffered.subarray(separator + 4 + length)
      handle(request)
    }
  })
}
