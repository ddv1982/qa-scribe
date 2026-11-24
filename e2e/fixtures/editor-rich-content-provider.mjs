import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

/** The test data table with the Note column Ask AI adds. */
export const richContentTable = [
  '| Case | Card | Amount | Result | Note |',
  '| --- | --- | --- | --- | --- |',
  '| TC01 | **4111** | 10.00 | Passed | ok |',
  '| TC02 | 5500 | 0.00 | *Failed* | retry |',
]

/**
 * The rewrite Ask AI returns: the authored draft's constructs, with the last sentence reworded and
 * a column added to the table.
 */
export const richContentReply = [
  '# Release 4.2', '',
  '## Checkout', '',
  '### TC01 Pay by card', '',
  '#### Setup', '',
  '~~Gateway declined~~', '',
  '<u>Check the receipt</u>', '',
  '```', 'GET /pay', '```', '',
  '> Payment returns a 500.', '',
  '###### Notes', '',
  'Test data', '',
  ...richContentTable, '',
  '### TC02 Refund', '',
  'Refund the whole order.',
].join('\n')

/** Answers a Test cases draft refinement with an edit; any other turn gets a plain answer. */
export function inspectEditorRichContentInput(input) {
  const payload = inspectContextInput(input, false)
  const text = input.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  const match = text.match(/CHAT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  assert.ok(match, 'every Ask AI turn carries a response contract')
  const contract = JSON.parse(match[1])
  if (contract.purpose.kind !== 'refinement') return { ...payload, contract, response: 'No record is bound to this turn.' }
  assert.equal(contract.version, 3)
  assert.equal(contract.purpose.recordKind, 'test_cases_draft')
  const response = JSON.stringify({
    version: 3,
    requestId: contract.requestId,
    markdown: 'Reworded the refund case.',
    outcome: { kind: 'edit', patch: { kind: 'test_cases_draft', bodyMarkdown: richContentReply } },
  })
  return { ...payload, contract, response, realVision: false, externalWrites: false }
}
