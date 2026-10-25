import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

export function inspectRefinementInput(input) {
  const payload = inspectContextInput(input, false)
  const text = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const match = text.match(/(?:REFINEMENT|CHAT)_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  if (!match) return { ...payload, response: 'Synthetic general chat remains available. No record or external system was changed.' }
  const contract = JSON.parse(match[1])
  assert.ok([1, 2].includes(contract.version))
  if (contract.version === 2 && contract.purpose.kind !== 'refinement') return { ...payload, response: 'Synthetic general chat remains available. No record or external system was changed.' }
  const user = payload.messages.at(-1)
  assert.equal(contract.requestId, user.id)
  assert.equal((contract.recordKind ?? contract.purpose?.recordKind), user.context.kind)
  if (user.text === 'An unrelated free-form testing question') return { ...payload, contract, response: JSON.stringify({ version: contract.version, requestId: contract.requestId, markdown: 'Synthetic general chat remains available. No record was changed.' }) }
  const metadata = user.context.kind === 'finding' && /metadata/.test(user.text) ? { severity: 'high' } : undefined
  const refinement = { kind: user.context.kind, title: `${user.context.snapshot.title} refined`, bodyMarkdown: 'Expected result\n\nThe application shows a receipt after submission.', ...(metadata ? { metadata } : {}) }
  const response = /invalid envelope/.test(user.text) ? '```json\n{"version":1,"refinement":{"title":"Must never apply"}}\n```' : JSON.stringify({ version: contract.version, requestId: contract.requestId, markdown: 'Suggestion for review. This has not been verified by testing.', refinement })
  return { ...payload, contract, response, realVision: false, externalWrites: false }
}
