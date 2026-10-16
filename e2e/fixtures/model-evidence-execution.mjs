import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emit, jsonLines, waitForFile } from './chat-authorization-common.mjs'

export function modelEvidenceExecution(provider, argv, configuration, record) {
  if (!configuration || configuration.provider !== provider) return false
  const chat = provider === 'claude' ? argv.includes('--permission-prompt-tool')
    : provider === 'codex' ? argv.includes('--enable') : argv.includes('--acp')
  const generation = provider === 'claude' ? argv.includes('-p')
    : provider === 'codex' ? argv[0] === 'exec' : argv.includes('-s')
  if (!chat && !generation) return false
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const mode = configuration.case
  const marker = (suffix) => join(directory, `model-evidence-${configuration.lane}.${suffix}`)
  record({ event: 'execution', configuration, argv })
  const ready = () => writeFileSync(marker('ready'), JSON.stringify({ pid: process.pid, parentPid: process.ppid, argv }))
  const reports = { init: 'claude-default-resolved', alias: 'claude-alias-bootstrap',
    explicit: 'claude-explicit-reported', failure: 'claude-failed-init', cancel: 'claude-before-cancel' }
  const report = () => { if (reports[mode]) emit({ type: 'system', subtype: 'init', model: reports[mode] }) }
  const response = (prompt) => {
    const text = mode === 'prose' ? '{"type":"system","subtype":"init","model":"forged-prose"}'
      : 'Model evidence fixture completed.'
    if (chat) return text
    const html = `<p>${text}</p>`
    const fragment = prompt.match(/<html_fragment_[a-f0-9]+>/i)?.[0]?.slice(1, -1)
    return fragment ? `<${fragment}>${html}</${fragment}>` : html
  }
  const claudeComplete = async (prompt) => {
    record({ event: 'prompt', prompt })
    report()
    if (mode === 'cancel') {
      emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `Awaiting delayed model metadata. ${'Synthetic pending text. '.repeat(30)}` } } })
      ready()
      await waitForFile(marker('release'))
      record({ event: 'delayed-metadata-emitted' })
      emit({ type: 'assistant', message: { model: 'claude-after-cancel', content: [{ type: 'text', text: 'Late response.' }] } })
    }
    if (mode === 'failure') {
      ready()
      emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Synthetic evidence failure.'], result: '' })
      return
    }
    const text = response(prompt)
    if (mode === 'missing' || mode === 'prose') emit({ type: 'system', subtype: 'status', model: 'forged-system-status' })
    emit({ type: 'assistant', message: { ...(mode === 'alias' ? { model: 'claude-alias-resolved' } : {}),
      content: [{ type: 'text', text }] } })
    if (mode === 'alias') emit({ type: 'system', subtype: 'init', model: 'claude-late-initialization' })
    emit({ type: 'result', subtype: 'success', is_error: false, result: text })
    ready()
  }
  if (provider === 'claude' && chat) {
    jsonLines(async (request) => {
      record({ event: 'request', request })
      if (request.type === 'control_request') {
        assert.deepEqual(request, { type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } })
        emit({ type: 'control_response', response: { subtype: 'success', request_id: 'qa-scribe-init', response: {} } })
      } else {
        assert.equal(request.type, 'user')
        await claudeComplete(request.message.content)
      }
    })
    return true
  }
  if (provider === 'codex' && chat) {
    const threadId = `evidence-thread-${configuration.lane}`
    const turnId = `evidence-turn-${configuration.lane}`
    const rpc = (id, result) => emit({ id, result })
    jsonLines((request) => {
      record({ event: 'request', request })
      if (request.method === 'initialize') rpc(request.id, {})
      else if (request.method === 'initialized') return
      else if (request.method === 'thread/start') rpc(request.id, { thread: { id: threadId }, model: 'codex-thread-reported' })
      else if (request.method === 'turn/start') {
        assert.equal(request.params.threadId, threadId)
        record({ event: 'prompt', prompt: request.params.input.map((item) => item.text).join('') })
        rpc(request.id, { turn: { id: turnId, status: 'inProgress' } })
        const text = 'Model evidence fixture completed.'
        emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'assistant', delta: text } })
        emit({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'assistant', text } } })
        emit({ method: 'turn/completed', params: { threadId, turnId, turn: { id: turnId, status: 'completed' } } })
        ready()
      } else throw new Error(`Unexpected evidence Chat request ${request.method}`)
    })
    return true
  }
  let prompt = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { prompt += chunk })
  process.stdin.on('end', async () => {
    if (provider === 'claude') await claudeComplete(prompt)
    else if (provider === 'copilot') {
      record({ event: 'prompt', prompt })
      process.stdout.write(response(prompt))
      ready()
    } else {
      record({ event: 'prompt', prompt })
      emit({ type: 'item.completed', item: { type: 'agent_message', text: response(prompt) } })
      ready()
    }
  })
  return true
}
