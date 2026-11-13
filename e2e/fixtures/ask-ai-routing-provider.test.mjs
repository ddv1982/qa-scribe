import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectRoutingInput } from './ask-ai-routing-provider.mjs'

const input = text => [{ type: 'text', text: `MESSAGE user-A User\n${JSON.stringify(text)}\nMESSAGE_CONTEXT_JSON\n{"kind":"session"}\nCHAT_RESPONSE_CONTRACT_JSON\n{"version":2,"requestId":"user-A","purpose":{"kind":"conversation"}}` }]
test('the routing fixture keeps literal owner-specific replies and permission selection', () => {
  const a = inspectRoutingInput(input('ROUTING_A'))
  const b = inspectRoutingInput(input('ROUTING_B'))
  assert.equal(a.response, 'Routing reply for ROUTING_A')
  assert.equal(b.response, 'Routing reply for ROUTING_B')
  assert.equal(a.externalWrites, false)
  assert.equal(a.permission, false)
  assert.equal(inspectRoutingInput(input('ROUTING_PERMISSION_NOTES')).permission, true)
  assert.throws(() => inspectRoutingInput([{ type: 'text', text: 'Unframed or missing contract' }]))
})
test('a record refinement outside the routing markers returns a current version 3 edit', () => {
  const context = { kind: 'finding', snapshot: { title: 'Source A', documentJson: '{"schemaVersion":1}', localFingerprint: 'a'.repeat(64), storedBaseToken: 'b'.repeat(64) } }
  const result = inspectRoutingInput([{ type: 'text', text: `MESSAGE user-A User\n${JSON.stringify('Make the expected result clearer.')}\nMESSAGE_CONTEXT_JSON\n${JSON.stringify(context)}\nCHAT_RESPONSE_CONTRACT_JSON\n{"version":3,"requestId":"user-A","purpose":{"kind":"refinement","recordKind":"finding"}}` }])
  assert.equal(JSON.parse(result.response).outcome.kind, 'edit')
  assert.equal(result.externalWrites, false)
})
