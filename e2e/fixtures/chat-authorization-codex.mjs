import { inspectRoutingInput } from './ask-ai-routing-provider.mjs'
import { inspectJiraInput } from './ask-ai-jira-provider.mjs'
import { join } from 'node:path'
import { emit, jsonLines, parseTranscript, record, reserveInvocation, waitForFile } from './chat-authorization-common.mjs'
import { authorizationTurn } from './chat-authorization-providers.mjs'
import { catalogObservation } from './chat-authorization-catalog.mjs'
import { inspectContextInput } from './ask-ai-context-provider.mjs'
import { inspectRefinementInput } from './ask-ai-refinement-provider.mjs'
import { inspectImageInput } from './chat-images-provider.mjs'

export function codexAppServer(argv) {
  let threadId
  let turnId
  let active = false
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const routingFixture = process.env.QA_SCRIBE_E2E_SPEC === 'ask-ai-conversation-routing.e2e.mjs'
  const jiraFixture = process.env.QA_SCRIBE_E2E_SPEC === 'ask-ai-jira-draft.e2e.mjs'
  const refinementFixture = process.env.QA_SCRIBE_E2E_SPEC === 'ask-ai-refinement.e2e.mjs'
  const contextFixture = process.env.QA_SCRIBE_E2E_SPEC === 'ask-ai-context.e2e.mjs'
  const images = process.env.QA_SCRIBE_E2E_CHAT_IMAGES === '1' || contextFixture || refinementFixture || jiraFixture || routingFixture
  const scope = () => ({ threadId, turnId })
  const complete = (text, emittedPrefix = 0) => {
    emit({ method: 'item/agentMessage/delta', params: { ...scope(), itemId: 'assistant', delta: text.slice(emittedPrefix) } })
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
      const imageInput = routingFixture ? inspectRoutingInput(request.params.input) : jiraFixture ? inspectJiraInput(request.params.input) : refinementFixture ? inspectRefinementInput(request.params.input) : contextFixture ? inspectContextInput(request.params.input) : images ? inspectImageInput(request.params.input) : null
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
        const prefix = (refinementFixture || jiraFixture) && chat.contract ? 24 : 0
        if (prefix) emit({ method: 'item/agentMessage/delta', params: { ...scope(), itemId: 'assistant', delta: chat.response.slice(0, prefix) } })
        await waitForFile(join(directory, `codex-exec-${index}.release`))
        if (chat.permission) {
          authorize = (accepted) => {
            record(directory, `codex-exec-${index}.permission.json`, { accepted, externalWrites: false })
            complete(chat.response, prefix)
          }
          emit({ id: 9000 + index, method: 'mcpServer/elicitation/request', params: {
            ...scope(), serverName: 'fixture-review', mode: 'form', message: 'Allow the local deterministic permission fixture',
            requestedSchema: { type: 'object', properties: {} },
            _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { operation: 'local synthetic review', externalWrites: false } },
          } })
        } else complete(chat.response, prefix)
      }
    } else if (request.result && authorize) {
      authorize(request.result?.action === 'accept', request)
    } else throw new Error(`Unsupported fixture request: ${JSON.stringify(request)}`)
  })
}
