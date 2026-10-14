import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emit, executeMarker, jsonLines, record, reserveInvocation } from './chat-authorization-common.mjs'
import { catalogObservation, copilotCatalog } from './chat-authorization-catalog.mjs'

export function authorizationTurn(provider, prompt, complete, requestPermission) {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const configuration = JSON.parse(readFileSync(join(directory, 'authorization-case.json'), 'utf8'))
  const index = reserveInvocation(directory, `${provider}-auth`)
  const marker = join(directory, `${provider}-auth-${index}.executed.json`)
  record(directory, `${provider}-auth-${index}.prompt.json`, { prompt, configuration })
  record(directory, `${provider}-auth-${index}.started`, process.pid)
  if (configuration.mode === 'policy') {
    record(directory, `${provider}-auth-${index}.policy.json`, { decision: 'deny', source: 'provider-policy' })
    complete('Provider policy denied the marker tool. No child executed.')
  } else requestPermission(marker)
  let resolved = false
  return (approved, wire) => {
    if (resolved) throw new Error('Permission was resolved twice')
    resolved = true
    record(directory, `${provider}-auth-${index}.decision.json`, { approved, wire })
    if (approved) executeMarker(marker)
    complete(approved ? 'Marker child executed once after approval.' : 'Marker tool denied. No child executed.')
  }
}

export function providerFixture(provider, argv) {
  if (!process.env.QA_SCRIBE_E2E_AUTH_PROVIDER) {
    console.error('Provider fixture is unavailable outside the dedicated authorization workflow')
    process.exitCode = 1
    return
  }
  if (argv.includes('--help')) {
    process.stdout.write(provider === 'copilot'
      ? 'Usage: copilot --prompt <prompt> --model <model> --acp\n'
      : 'Usage: claude --model <model> --input-format stream-json\n')
    return
  }
  if (argv.includes('--version') || argv[0] === 'version') {
    catalogObservation(provider, 'version')
    process.stdout.write(provider === 'claude' ? '2.1.50 (Claude Code)\n' : '1.0.70\n')
    return
  }
  if (argv[0] === 'auth') { catalogObservation(provider, 'auth.status'); emit({ loggedIn: true }); return }
  if (provider === 'claude') claude(argv)
  else if (argv.includes('--server')) copilotCatalog()
  else if (argv.includes('--acp')) copilot()
  else throw new Error(`Unexpected ${provider} fixture probe: ${argv.join(' ')}`)
}

function claude(argv) {
  if (!argv.includes('--input-format') || !argv.includes('stream-json')) throw new Error('Claude requires native duplex stdin')
  let authorize
  jsonLines((message) => {
    if (message.type === 'control_request' && message.request.subtype === 'initialize') {
      const catalog = message.request_id === 'qa-scribe-model-catalog'
      if (catalog) catalogObservation('claude', 'initialize.catalog')
      emit({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id,
        response: catalog ? { models: [{ value: 'fixture-model', displayName: 'Fixture model' }] } : {} } })
    } else if (message.type === 'user') {
      authorize = authorizationTurn('claude', message.message.content,
        (text) => emit({ type: 'result', subtype: 'success', is_error: false, result: text }),
        (marker) => emit({ type: 'control_request', request_id: 'fixture-permission',
          request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'fixture-marker-child', marker } } }))
    } else if (message.type === 'control_response' && authorize) {
      authorize(message.response?.response?.behavior === 'allow', message)
    } else throw new Error(`Unexpected Claude message: ${JSON.stringify(message)}`)
  })
}

function copilot() {
  let sessionId
  let promptId
  let authorize
  const rpc = (id, result) => emit({ jsonrpc: '2.0', id, result })
  jsonLines((message) => {
    if (message.method === 'initialize') rpc(message.id, { protocolVersion: 1, agentCapabilities: {} })
    else if (message.method === 'session/new') {
      sessionId = `fixture-session-${process.pid}`
      rpc(message.id, { sessionId })
    } else if (message.method === 'session/prompt') {
      if (message.params.sessionId !== sessionId) throw new Error('Copilot session mismatch')
      promptId = message.id
      authorize = authorizationTurn('copilot', message.params.prompt.map((part) => part.text).join(''), (text) => {
        emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
        rpc(promptId, { stopReason: 'end_turn' })
      }, (marker) => emit({ jsonrpc: '2.0', id: 'fixture-permission', method: 'session/request_permission',
        params: { sessionId, toolCall: { toolCallId: 'marker-child', title: 'Execute the marker child once', rawInput: { marker } },
          options: [{ optionId: 'approve-marker', name: 'Approve once', kind: 'allow_once' },
            { optionId: 'deny-marker', name: 'Deny', kind: 'reject_once' }] } }))
    } else if (message.id === 'fixture-permission' && authorize) {
      authorize(message.result?.outcome?.optionId === 'approve-marker', message)
    } else throw new Error(`Unexpected Copilot message: ${JSON.stringify(message)}`)
  })
}
