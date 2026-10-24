import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectRefinementInput } from './ask-ai-refinement-provider.mjs'

function input(kind, question = 'Refine metadata') {
  const contract = { version: 1, requestId: 'user-1', recordKind: kind }
  const context = { kind, snapshot: { sessionId: 'session-1', recordId: 'record-1', title: 'Original title', documentJson: JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [] } }), metadataJson: null, recordKind: kind === 'finding' ? 'bug' : 'testware', origin: 'saved', localFingerprint: 'a'.repeat(64), storedBaseToken: 'b'.repeat(64) } }
  return [{ type: 'text', text: `Instructions\nREFINEMENT_RESPONSE_CONTRACT_JSON\n${JSON.stringify(contract)}\nMESSAGE user-1 User\n${JSON.stringify(question)}\nMESSAGE_CONTEXT_JSON\n${JSON.stringify(context)}` }]
}

test('the configured fixture returns only a correlated record-kind-specific patch and readable Markdown', () => {
  for (const kind of ['finding', 'test_cases_draft']) {
    const result = inspectRefinementInput(input(kind))
    const envelope = JSON.parse(result.response)
    assert.equal(envelope.version, 1)
    assert.equal(envelope.requestId, 'user-1')
    assert.equal(envelope.refinement.title, 'Original title refined')
    assert.equal(envelope.refinement.kind, kind)
    assert.equal(envelope.markdown, 'Suggestion for review. This has not been verified by testing.')
    assert.equal('recordId' in envelope.refinement, false)
    assert.equal('metadata' in envelope.refinement, kind === 'finding')
    assert.equal(result.externalWrites, false)
  }
})

test('malformed-envelope and ordinary chat fixtures remain readable without an executable patch', () => {
  assert.match(inspectRefinementInput(input('finding', 'invalid envelope')).response, /^```json/)
  const plain = inspectRefinementInput([{ type: 'text', text: 'MESSAGE user-1 User\n"General question"' }])
  assert.equal(plain.response, 'Synthetic general chat remains available. No record or external system was changed.')
  assert.equal(plain.contract, undefined)
})
