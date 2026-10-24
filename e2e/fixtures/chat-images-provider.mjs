import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const imageFixture = Object.freeze({
  path: fileURLToPath(new URL('./chat-image-pixels.png', import.meta.url)),
  filename: 'chat-image-pixels.png',
  sha256: 'f6b373ee62d8abe053e1decceb83b38627e0ce3df932ce72729f10a2e6e8fc58',
  width: 2,
  height: 2,
  rgba: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255],
})

export const imageResponse = 'Deterministic image transport fixture completed. No model vision was exercised.'

export function inspectImageInput(input) {
  assert.ok(Array.isArray(input) && input.length <= 128, 'Image fixture requires bounded content blocks')
  const messages = []
  let current
  for (const block of input) {
    if (block.type === 'text') {
      assert.ok(typeof block.text === 'string' && Buffer.byteLength(block.text) <= 128 * 1024,
        'Image fixture text must stay within the Chat budget')
      const message = /^MESSAGE (\S+) (User|Assistant)\n([\s\S]*)$/.exec(block.text)
      if (message) {
        current = { id: message[1], role: message[2].toLowerCase(), text: message[3], images: [] }
        messages.push(current)
      }
      continue
    }
    assert.equal(block.type, 'localImage', 'Image fixture requires actual Codex localImage content')
    assert.equal(current?.role, 'user', 'Every image must follow its owning user message')
    assert.ok(typeof block.path === 'string' && isAbsolute(block.path), 'Image input requires an absolute managed path')
    const path = realpathSync(block.path)
    const file = statSync(path)
    assert.ok(file.isFile(), 'Image input must resolve to a regular managed file')
    const sizeBytes = file.size
    assert.ok(sizeBytes > 0 && sizeBytes <= 10 * 1024 * 1024, 'Image fixture file exceeds its byte budget')
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    assert.equal(sha256, imageFixture.sha256, 'Provider must receive the exact known PNG bytes')
    current.images.push({ type: 'localImage', path, sizeBytes, sha256 })
  }
  assert.ok(messages.length > 0 && messages.length % 2 === 1, 'Image Chat requires completed pairs and a user turn')
  for (const [index, message] of messages.entries()) {
    assert.equal(message.role, index % 2 ? 'assistant' : 'user')
    assert.ok(message.text.trim() || message.images.length, 'A message requires text or actual image content')
    if (message.role === 'assistant') assert.equal(message.text, imageResponse)
  }
  assert.equal(messages.flatMap(message => message.images).length, 1,
    'Initial send and later replay must each carry exactly one real image')
  assert.equal(messages[0].images.length, 1, 'Replay must retain the image on the original user message')
  return { provider: 'codex', transport: 'app-server', realVision: false, messages, response: imageResponse }
}
