import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const contextResponse = 'Synthetic record context received. No external tool or Jira operation was performed.'

export function inspectContextInput(input) {
  const messages = []
  let current
  for (const block of input) {
    if (block.type === 'localImage') {
      assert.equal(current?.role, 'user')
      current.images.push({ path: block.path, sha256: createHash('sha256').update(readFileSync(block.path)).digest('hex') })
      continue
    }
    assert.equal(block.type, 'text')
    const frames = [...block.text.matchAll(/(?:^|\n)MESSAGE (\S+) (User|Assistant)\n([^\n]*)(?:\nMESSAGE_CONTEXT_JSON\n([^\n]*))?/g)]
    for (const frame of frames) {
      const context = frame[4] ? JSON.parse(frame[4]) : { kind: 'session' }
      assert.ok(['session', 'finding', 'test_cases_draft'].includes(context.kind))
      if (context.kind !== 'session') {
        assert.equal(JSON.parse(context.snapshot.documentJson).schemaVersion, 1)
        assert.equal(context.snapshot.localFingerprint.length, 64)
        assert.equal(context.snapshot.storedBaseToken.length, 64)
        assert.ok(Buffer.byteLength(frame[4]) <= 32 * 1024)
      }
      current = { id: frame[1], role: frame[2].toLowerCase(), text: JSON.parse(frame[3]), context, images: [] }
      if (current.role === 'assistant') assert.equal(current.text, contextResponse)
      messages.push(current)
    }
  }
  assert.ok(messages.length > 0 && messages.length % 2 === 1)
  messages.forEach((message, index) => assert.equal(message.role, index % 2 ? 'assistant' : 'user'))
  return { messages, response: contextResponse, realVision: false, externalWrites: false }
}
