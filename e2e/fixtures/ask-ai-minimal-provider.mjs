import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

export function inspectMinimalInput(input) {
  const payload = inspectContextInput(input, false)
  const instructions = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const contract = JSON.parse(instructions.match(/CHAT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)[1])
  const user = payload.messages.at(-1)
  assert.equal(contract.requestId, user.id)
  let markdown = 'Synthetic answer. No external system was changed.'
  let refinement
  let question
  if (user.text === 'Improve the expected result with this evidence.') {
    assert.equal(contract.purpose.kind, 'refinement')
    assert.equal(user.images.length, 1)
    refinement = { kind: user.context.kind, title: `${user.context.snapshot.title} refined`, bodyMarkdown: 'The application keeps the payment error visible after Retry.',
      ...(user.context.kind === 'finding' ? { metadata: { severity: 'high', status: 'resolved', component: 'Checkout', reference: 'DEMO-184' } } : {}) }
    markdown = 'Keep the payment error visible and explain how the user can recover.'
  } else if (user.text === 'Make the expected result clearer.') {
    refinement = { kind: user.context.kind, bodyMarkdown: 'Keep the payment error visible after Retry and explain how to recover.' }
    markdown = 'The expected result can explain how the user should recover after a declined payment.'
  } else if (user.text === 'Can you update the testcases based on this?') {
    if (!contract.localEdit) {
      return { ...payload, contract, response: "I've made it an explicit before/after case (TC06).", externalWrites: false }
    }
    markdown = 'I need one detail before proposing the update.'
    question = { prompt: 'How should I handle the existing cases?', choices: ['Preserve existing cases', 'Replace existing cases'] }
  } else if (user.text === 'Preserve existing cases') {
    assert.equal(contract.localEdit, true)
    refinement = { kind: 'test_cases_draft', bodyMarkdown: 'The application keeps the payment error visible after Retry.\n\n## TC06 Before and after\n\n- Compare matching inputs and expected results.' }
    markdown = 'Proposed a before/after comparison.'
  } else if (user.text === 'Rewrite the Note as a short checklist.') {
    assert.equal(contract.localEdit, true)
    refinement = { kind: 'note', bodyMarkdown: '## Checklist\n\n- [ ] Verify matching inputs.' }
  } else if (user.text === 'Add this to Jira.') {
    markdown = 'I can use your configured tools after the destination is clear.'
    question = { prompt: 'Which project and configured issue type?', choices: ['DEMO Bug', 'DEMO Finding subtask'] }
  } else if (user.text === 'Use DEMO Bug, with the current expected result.') {
    markdown = 'Synthetic Jira request received for DEMO Bug. No Jira operation occurred.'
  } else if (user.text === 'Give a detailed explanation.') {
    markdown = Array.from({ length: 18 }, (_, i) => `Paragraph ${i + 1}. Keep the error visible and preserve the current record until Save.`).join('\n\n')
  }
  const response = JSON.stringify({ version: contract.version, requestId: contract.requestId, markdown, ...(contract.version === 3 ? { outcome: refinement ? { kind: 'edit', patch: refinement } : question ? { kind: 'clarification', question } : { kind: 'answer' } } : { ...(refinement ? { refinement } : {}), ...(question ? { question } : {}) }) })
  return { ...payload, contract, response, permission: user.text === 'Review with tool permission.', realVision: false, externalWrites: false }
}
