import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'
import { inspectRefinementInput } from './ask-ai-refinement-provider.mjs'
import { inspectJiraInput } from './ask-ai-jira-provider.mjs'

export function inspectRoutingInput(input) {
  const payload = inspectContextInput(input, false)
  const text = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const match = text.match(/CHAT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  assert.ok(match, 'Routing requires the actual completed-response contract')
  const contract = JSON.parse(match[1])
  const user = payload.messages.at(-1)
  assert.equal(contract.requestId, user.id)
  if (contract.purpose.kind === 'refinement' && !user.text.startsWith('ROUTING_')) return inspectRefinementInput(input)
  if (contract.purpose.kind === 'jira_drafting') return inspectJiraInput(input)
  return { ...payload, contract, response: `Routing reply for ${user.text}`, permission: /ROUTING_PERMISSION/.test(user.text), externalWrites: false }
}
