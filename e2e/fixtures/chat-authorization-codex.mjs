import { join } from 'node:path'
import { emit, jsonLines, parseTranscript, record, reserveInvocation, waitForFile } from './chat-authorization-common.mjs'
import { authorizationTurn } from './chat-authorization-providers.mjs'
import { catalogObservation } from './chat-authorization-catalog.mjs'
import { inspectImageInput } from './chat-images-provider.mjs'

export function codexAppServer(argv) {
  let threadId
  let turnId
  let active = false
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const images = process.env.QA_SCRIBE_E2E_CHAT_IMAGES === '1'
  const scope = () => ({ threadId, turnId })
  const complete = (text) => {
    emit({ method: 'item/agentMessage/delta', params: { ...scope(), itemId: 'assistant', delta: text } })
    emit({ method: 'item/completed', params: { ...scope(), item: { type: 'agentMessage', id: 'assistant', text } } })
    emit({ method: 'turn/completed', params: { ...scope(), turn: { id: turnId, status: 'completed' } } })
  }
  let authorize
  jsonLines(async (request) => {
    if (request.method === 'initialize') emit({ id: request.id, result: {} })
    else if (request.method === 'config/read') emit({ id: request.id, result: { config: images ? { model: 'chat-image-fixture' } : {}, layers: [] } })
    else if (request.method === 'model/list') {
      catalogObservation('codex', 'model/list')
      emit({ id: request.id, result: { data: images ? [{ model: 'chat-image-fixture',
        displayName: 'Synthetic image transport fixture', isDefault: true, hidden: false, vision: true }] : [] } })
    }
    else if (request.method === 'initialized') { /* notification */ }
    else if (request.method === 'thread/start') {
      if (request.params.ephemeral !== true || active) throw new Error('Chat requires one ephemeral thread')
      threadId = `fixture-thread-${process.pid}`
      emit({ id: request.id, result: { thread: { id: threadId } } })
    } else if (request.method === 'turn/start') {
      if (!threadId || request.params.threadId !== threadId || active) throw new Error('Invalid Chat turn scope')
      active = true
      const imageInput = images ? inspectImageInput(request.params.input) : null
      const prompt = imageInput ? null : request.params.input.map((input) => {
        if (input.type !== 'text') throw new Error('Only text Chat input supported')
        return input.text
      }).join('')
      turnId = `fixture-turn-${process.pid}`
      if (process.env.QA_SCRIBE_E2E_AUTH_PROVIDER) {
        emit({ id: request.id, result: { turn: { id: turnId, status: 'inProgress' } } })
        authorize = authorizationTurn('codex', prompt, complete, (marker, id) => {
          emit({ id, method: 'mcpServer/elicitation/request', params: {
            ...scope(), serverName: 'fixture-marker', mode: 'form', message: 'Execute the marker child once',
            requestedSchema: { type: 'object', properties: {} },
            _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { marker } },
          } })
        })
      } else {
        const index = reserveInvocation(directory)
        const chat = imageInput ?? parseTranscript(prompt, argv)
        record(directory, `codex-exec-${index}.chat.json`, chat)
        if (!imageInput) record(directory, `codex-exec-${index}.prompt.json`, { prompt, thread: request.params })
        // Write coordination markers before acknowledging the native turn start.
        record(directory, `codex-exec-${index}.started`, process.pid)
        emit({ id: request.id, result: { turn: { id: turnId, status: 'inProgress' } } })
        await waitForFile(join(directory, `codex-exec-${index}.release`))
        complete(chat.response)
      }
    } else if (request.result && authorize) {
      authorize(request.result?.action === 'accept', request)
    } else throw new Error(`Unsupported fixture request: ${JSON.stringify(request)}`)
  })
}
