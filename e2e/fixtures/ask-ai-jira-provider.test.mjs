import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectJiraInput } from './ask-ai-jira-provider.mjs'
function input(text, kind = 'finding') {
  const context = { kind, snapshot: { title: 'Original finding', documentJson: '{"schemaVersion":1}', localFingerprint: 'a'.repeat(64), storedBaseToken: 'b'.repeat(64) } }
  return [{ type: 'text', text: `CHAT_RESPONSE_CONTRACT_JSON\n${JSON.stringify({ version: 2, requestId: 'u', purpose: { kind: 'jira_drafting' } })}\nMESSAGE u User\n${JSON.stringify(text)}\nMESSAGE_CONTEXT_JSON\n${JSON.stringify(context)}` }]
}
for (const [reply, expected] of [['Draft Jira content', ['New issue', 'Subtask']], ['New issue', ['DEMO', 'OTHER']], ['Subtask', ['DEMO-184', 'DEMO-205']], ['DEMO', ['Bug', 'Customer incident']], ['DEMO-184', ['Finding subtask', 'Other custom subtask']], ['Finding subtask', ['Web', 'Mobile']]]) {
  test(`the local agent fixture reports all visible ${reply} replies without hidden values`, () => {
    const result = inspectJiraInput(input(reply))
    assert.deepEqual(JSON.parse(result.response).question.choices, expected)
    assert.equal(result.externalWrites, false)
  })
}
test('Test cases have configured type choices without assuming Finding subtask', () => {
  assert.deepEqual(JSON.parse(inspectJiraInput(input('DEMO-184', 'test_cases_draft')).response).question.choices, ['Test execution subtask', 'Other custom subtask'])
})
test('the review, absent tools, and wrong nonce are deterministic with readable Markdown', () => {
  assert.equal(JSON.parse(inspectJiraInput(input('Web')).response).question, undefined)
  assert.match(JSON.parse(inspectJiraInput(input('missing tools')).response).markdown, /Draft retained/)
  assert.equal(JSON.parse(inspectJiraInput(input('wrong nonce')).response).requestId, 'invalid-fixture-nonce')
})
