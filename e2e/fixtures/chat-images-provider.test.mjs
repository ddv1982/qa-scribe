import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once, EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import test from 'node:test'
import { imageFixture, imageResponse, inspectImageInput } from './chat-images-provider.mjs'

const bin = fileURLToPath(new URL('./bin/codex', import.meta.url))
const image = path => ({ type: 'localImage', path })
const message = (id, role, text = '') => ({ type: 'text', text: `MESSAGE ${id} ${role}\n${text}` })
const first = path => [message('user-1', 'User'), image(path)]
const replay = path => [...first(path), message('assistant-1', 'Assistant', imageResponse), message('user-2', 'User', 'Retain the screenshot.')]

test('the PNG fixture contains literal red, green, blue, and yellow RGBA pixels', () => {
  const png = readFileSync(imageFixture.path)
  assert.equal(createHash('sha256').update(png).digest('hex'), 'f6b373ee62d8abe053e1decceb83b38627e0ce3df932ce72729f10a2e6e8fc58')
  assert.equal(png.readUInt32BE(16), 2)
  assert.equal(png.readUInt32BE(20), 2)
  const idat = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  assert.deepEqual([...inflateSync(Buffer.concat(idat))],
    [0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255])
})

test('image input inspection binds exact file bytes to their original message on replay', () => {
  assert.deepEqual(inspectImageInput(replay(imageFixture.path)), {
    provider: 'codex', transport: 'app-server', realVision: false, response: imageResponse,
    messages: [
      { id: 'user-1', role: 'user', text: '', images: [{ type: 'localImage', path: imageFixture.path,
        sizeBytes: 77, sha256: 'f6b373ee62d8abe053e1decceb83b38627e0ce3df932ce72729f10a2e6e8fc58' }] },
      { id: 'assistant-1', role: 'assistant', text: imageResponse, images: [] },
      { id: 'user-2', role: 'user', text: 'Retain the screenshot.', images: [] },
    ],
  })
})

test('image input rejects filenames, omitted replay, wrong owners, duplicate images, and unbounded text', () => {
  for (const [input, error] of [
    [[message('u', 'User', 'chat-image-pixels.png')], /exactly one real image/],
    [[message('u', 'User', 'First'), message('a', 'Assistant', imageResponse), message('u2', 'User', 'Later')], /exactly one real image/],
    [[message('u', 'User', 'First'), message('a', 'Assistant', imageResponse), image(imageFixture.path)], /owning user message/],
    [[...first(imageFixture.path), image(imageFixture.path)], /exactly one real image/],
    [[message('u', 'User', 'x'.repeat(128 * 1024 + 1)), image(imageFixture.path)], /Chat budget/],
    [[message('u', 'User'), { type: 'image', url: 'filename-marker' }], /localImage content/],
  ]) assert.throws(() => inspectImageInput(input), error)
})

test('image input reads file contents and rejects altered pixels and oversized files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-chat-image-bytes-'))
  const path = join(directory, imageFixture.filename)
  try {
    const bytes = readFileSync(imageFixture.path)
    bytes[48] ^= 1
    writeFileSync(path, bytes)
    assert.throws(() => inspectImageInput(first(path)), /exact known PNG bytes/)
    writeFileSync(path, Buffer.alloc(10 * 1024 * 1024 + 1))
    assert.throws(() => inspectImageInput(first(path)), /byte budget/)
    assert.throws(() => inspectImageInput(first(join(directory, 'absent.png'))), { code: 'ENOENT' })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

function appServer(directory) {
  const child = spawn(process.execPath, [bin, 'app-server'], {
    env: { PATH: process.env.PATH, QA_SCRIBE_E2E_FIXTURE_DIR: directory, QA_SCRIBE_E2E_CHAT_IMAGES: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const changed = new EventEmitter()
  const events = []
  let buffered = '', stderr = ''
  child.stdout.on('data', chunk => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop()
    for (const line of lines.filter(Boolean)) events.push(JSON.parse(line))
    changed.emit('change')
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('close', () => changed.emit('change'))
  return {
    child, events, stderr: () => stderr,
    send: value => child.stdin.write(`${JSON.stringify(value)}\n`),
    receive(predicate, expected = 'response') {
      return new Promise((resolve, reject) => {
        const finish = (error, event) => {
          clearTimeout(timer)
          changed.off('change', check)
          if (error) reject(error)
          else resolve(event)
        }
        const check = () => {
          const event = events.find(predicate)
          if (event) finish(null, event)
          else if (child.exitCode !== null) finish(new Error(`Fixture exited with code ${child.exitCode}`))
        }
        const timer = setTimeout(() => finish(new Error(`Fixture deadline exceeded for ${expected}; received ${events.map(event => event.method ?? event.id).join(', ')}`)), 2_000)
        changed.on('change', check)
        check()
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const closed = once(child, 'close')
      child.kill('SIGKILL')
      await closed
    },
  }
}

async function begin(running, input) {
  running.send({ id: 1, method: 'initialize', params: {} })
  await running.receive(event => event.id === 1, 'initialize')
  running.send({ id: 2, method: 'thread/start', params: { ephemeral: true } })
  const scope = (await running.receive(event => event.id === 2, 'thread/start')).result.thread.id
  running.send({ id: 3, method: 'turn/start', params: { threadId: scope, input } })
}

test('the actual Codex executable hashes sent and replayed paths before acknowledging the turn', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-chat-images-protocol-'))
  const path = join(directory, 'managed.png')
  writeFileSync(path, readFileSync(imageFixture.path))
  try {
    for (const [index, input] of [first(path), replay(path)].entries()) {
      const running = appServer(directory)
      try {
        running.send({ id: 'catalog', method: 'model/list', params: { limit: 100 } })
        assert.deepEqual((await running.receive(event => event.id === 'catalog', 'model/list')).result.data,
          [{ model: 'chat-image-fixture', displayName: 'Synthetic image transport fixture', isDefault: true, hidden: false, vision: true }])
        running.send({ id: 'config', method: 'config/read', params: {} })
        assert.deepEqual((await running.receive(event => event.id === 'config', 'config/read')).result,
          { config: { model: 'chat-image-fixture' }, layers: [] })
        await begin(running, input)
        assert.equal((await running.receive(event => event.id === 3, 'turn/start')).result.turn.status, 'inProgress')
        const receipt = JSON.parse(readFileSync(join(directory, `codex-exec-${index + 1}.chat.json`), 'utf8'))
        assert.deepEqual(receipt, inspectImageInput(input))
        assert.equal(running.events.some(event => event.method === 'turn/completed'), false)
        writeFileSync(join(directory, `codex-exec-${index + 1}.release`), 'release\n', { flag: 'wx' })
        assert.equal((await running.receive(event => event.method === 'turn/completed', 'turn/completed')).params.turn.status, 'completed')
        assert.equal(running.events.find(event => event.method === 'item/agentMessage/delta').params.delta, imageResponse)
        assert.equal(running.stderr(), '')
        assert.equal(readdirSync(directory).some(name => name.endsWith('.prompt.json')), false)
        assert.equal(JSON.stringify(receipt).includes('base64'), false)
      } finally { await running.stop() }
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('the executable fails closed on a filename-only request before creating a started receipt', { timeout: 5_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-chat-images-no-pixels-'))
  const running = appServer(directory)
  try {
    const closed = once(running.child, 'close')
    await begin(running, [message('u', 'User', imageFixture.filename)])
    assert.equal((await closed)[0], 1)
    assert.match(running.stderr(), /exactly one real image/)
    assert.deepEqual(readdirSync(directory), [])
  } finally {
    await running.stop()
    rmSync(directory, { recursive: true, force: true })
  }
})
