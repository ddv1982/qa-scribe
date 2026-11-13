/** The Ask AI reply the README screenshots show: a plain answer about the Finding, in the record response contract. */
export const readmeAnswer = [
  'Two details would make this easier to act on:',
  '',
  '- **How often.** Say how many of your Safari attempts hung, for example 3 of 3.',
  '- **Order state.** Add the order number and that the payment shows as captured, so the payments team can find it in their logs.',
  '',
  'The steps and the expected result read clearly as they are.',
].join('\n')

/** Answers one record conversation turn with `readmeAnswer`, echoing the request's contract version and id. */
export function inspectReadmeInput(input) {
  const text = input.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const match = text.match(/(?:REFINEMENT|CHAT)_RESPONSE_CONTRACT_JSON\n([^\n]+)/)
  if (!match) return { response: readmeAnswer }
  const contract = JSON.parse(match[1])
  const envelope = { version: contract.version, requestId: contract.requestId, markdown: readmeAnswer }
  return { response: JSON.stringify(contract.version === 3 ? { ...envelope, outcome: { kind: 'answer' } } : envelope) }
}
