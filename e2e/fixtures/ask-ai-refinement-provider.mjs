import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

export function inspectRefinementInput(input) {
  const payload = inspectContextInput(input, false)
  const text = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const match = text.match(/REFINEMENT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  if (!match) return { ...payload, response: 'Synthetic general chat remains available. No record or external system was changed.' }
  const contract = JSON.parse(match[1])
  assert.equal(contract.version, 1)
  const user = payload.messages.at(-1)
  assert.equal(contract.requestId, user.id)
  assert.equal(contract.recordKind, user.context.kind)
  const metadata = user.context.kind === 'finding' && /metadata/.test(user.text) ? { severity: 'high' } : undefined
  const refinement = { kind: user.context.kind, title: `${user.context.snapshot.title} refined`, bodyMarkdown: 'Expected result\n\nThe application shows a receipt after submission.', ...(metadata ? { metadata } : {}) }
  const response = /invalid envelope/.test(user.text) ? '```json\n{"version":1,"refinement":{"title":"Must never apply"}}\n```' : JSON.stringify({ version: 1, requestId: contract.requestId, markdown: 'Suggestion for review. This has not been verified by testing.', refinement })
  return { ...payload, contract, response, realVision: false, externalWrites: false }
}
