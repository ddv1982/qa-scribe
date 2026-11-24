import assert from 'node:assert/strict'
import { inspectContextInput } from './ask-ai-context-provider.mjs'

export function inspectTestRunInput(input) {
  const chat = inspectContextInput(input, false)
  const contract = JSON.parse(chat.instructions.match(/\nCHAT_RESPONSE_CONTRACT_JSON\n([^\n]+)/)[1])
  assert.equal(contract.purpose.kind, 'test_run_recording')
  const report = JSON.parse(chat.instructions.match(/\nTEST_RUN_REPORT_JSON\n("[^\n]+")/)[1])
  const caseId = (position) => {
    const match = report.match(new RegExp(`\\(TC ${position} \\[([a-f0-9-]+)\\]\\)`))
    assert.ok(match, `the report includes the id for TC ${position}`)
    return match[1]
  }
  const response = JSON.stringify({
    version: contract.version,
    requestId: contract.requestId,
    markdown: 'Review the suggested results for TC 2 and TC 3.',
    testRunSuggestions: [
      { caseId: caseId(2), result: 'failed', notesMarkdown: '**HTTP 500** from the payment service.', rationale: 'The request returned a server error.' },
      { caseId: caseId(3), result: 'passed', notesMarkdown: 'The payment flow passed.', rationale: 'The tester reported a pass.' },
    ],
  })
  return { ...chat, report, contract, response }
}
