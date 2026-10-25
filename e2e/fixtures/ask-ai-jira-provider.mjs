import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

export function inspectJiraInput(input) {
  const payload = inspectContextInput(input, false)
  const instructions = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const match = instructions.match(/CHAT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  assert.ok(match, 'A completed-response contract is required')
  const contract = JSON.parse(match[1])
  assert.equal(contract.version, 2)
  const user = payload.messages.at(-1)
  assert.equal(contract.requestId, user.id)
  const text = user.text.trim()
  let markdown = `## Jira content draft\n\n${user.context.snapshot?.title ?? 'Session conversation'}\n\nExpected result: show a receipt after submission.\n\nThis is agent-reported draft content. No Jira operation has occurred.`
  let question
  if (/wrong nonce/i.test(text)) markdown = 'The receipt requirement needs clarification. This readable explanation is retained.'
  else if (/missing tools/i.test(text)) markdown = 'Draft retained. Jira tools are unavailable. Supply the project and configured type in chat or configure your existing coding agent.'
  else if (/Draft Jira content/.test(text)) question = { prompt: 'Create a new issue or a subtask?', choices: ['New issue', 'Subtask'] }
  else if (text === 'New issue') question = { prompt: 'Which project?', choices: ['DEMO', 'OTHER'] }
  else if (text === 'Subtask') question = { prompt: 'Which parent issue?', choices: ['DEMO-184', 'DEMO-205'] }
  else if (['DEMO', 'OTHER'].includes(text)) question = { prompt: 'Which configured issue type?', choices: ['Bug', 'Customer incident'] }
  else if (/^DEMO-\d+$/.test(text)) question = { prompt: 'Which configured subtask type?', choices: user.context.kind === 'finding' ? ['Finding subtask', 'Other custom subtask'] : ['Test execution subtask', 'Other custom subtask'] }
  else if (['Bug', 'Customer incident', 'Finding subtask', 'Other custom subtask', 'Test execution subtask'].includes(text)) question = { prompt: 'Which required platform?', choices: ['Web', 'Mobile'] }
  else if (['Web', 'Mobile'].includes(text)) markdown += '\n\n## Review before action\n\nThe draft and your selected destination, project or parent, configured type, and required platform are ready for review. Prepare an editable action message when you want to request the action.'
  else markdown = 'Synthetic general chat remains available. Your message and explicitly attached images were received. No external system was changed.'
  const permission = /permission fixture/i.test(text)
  if (permission) markdown = 'Synthetic tool permission was handled through the existing approval UI. No Jira operation occurred.'
  const response = JSON.stringify({ version: 2, requestId: /wrong nonce/i.test(text) ? 'invalid-fixture-nonce' : contract.requestId, markdown, ...(question ? { question } : {}) })
  return { ...payload, contract, response, permission, externalWrites: false, realVision: false }
}
