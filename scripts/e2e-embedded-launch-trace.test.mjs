import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { channel } from 'node:diagnostics_channel'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { traceEmbeddedLaunch } from '../e2e/embedded-launch-trace.mjs'

const channels = ['tracing:child_process.spawn:start', 'undici:request:create', 'undici:request:headers', 'undici:request:error']
const subscribers = () => channels.map(name => channel(name).hasSubscribers)

test('observes actual Node spawn, native markers and Undici requests without consuming output or response', async t => {
  const server = createServer((_request, response) => response.end(JSON.stringify({ value: { ready: true } })))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const port = server.address().port, rows = [], before = subscribers()
  let received = ''
  const value = { original: true }
  const result = await traceEmbeddedLaunch({ appBinaryPath: process.execPath, embeddedPort: port }, async () => {
    const child = spawn(process.execPath, ['-e', `process.stderr.write('qa-scribe startup app data ready: elapsed_ms=0\\n'); process.stderr.write('qa-scribe startup backend setup complete: elapsed_ms=1\\n')`])
    child.stderr.on('data', chunk => { received += chunk })
    assert.deepEqual(await once(child, 'close'), [0, null])
    const response = await fetch(`http://127.0.0.1:${port}/status`)
    assert.deepEqual(await response.json(), { value: { ready: true } })
    await fetch(`http://127.0.0.1:${port}/not-status`)
    return value
  }, row => rows.push(row))
  assert.equal(result, value)
  assert.match(received, /app data ready/)
  assert.match(received, /backend setup complete/)
  assert.equal(rows.filter(row => row.phase === 'embedded.spawn-start').length, 1)
  assert.equal(rows.filter(row => row.phase === 'embedded.spawned').length, 1)
  assert.deepEqual(rows.filter(row => row.phase === 'embedded.native-marker').map(row => row.marker), ['app data ready', 'backend setup complete'])
  const summary = rows.at(-1)
  assert.equal(summary.phase, 'embedded.prepare-summary')
  assert.equal(summary.spawns, 1)
  assert.equal(summary.polls, 1)
  assert.equal(summary.responses, 1)
  assert.equal(summary.lastResponse.status, 200)
  assert.deepEqual(summary.diagnosticErrors, [])
  assert.deepEqual(subscribers(), before)
  const count = rows.length
  await fetch(`http://127.0.0.1:${port}/status`)
  assert.equal(rows.length, count, 'Subscriptions must be removed after the operation')
  assert.ok(rows.every((row, index) => index === 0 || row.sincePrepareMs >= rows[index - 1].sincePrepareMs))
})

test('ignores unrelated process and status endpoint and retains the original failure', async () => {
  const rows = [], before = subscribers(), failure = new Error('original prepare failed')
  await assert.rejects(traceEmbeddedLaunch({ appBinaryPath: '/not-the-owned-binary', embeddedPort: 1 }, async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await once(child, 'close')
    throw failure
  }, row => rows.push(row)), error => error === failure)
  assert.equal(rows.at(-1).spawns, 0)
  assert.equal(rows.at(-1).polls, 0)
  assert.deepEqual(subscribers(), before)
})

test('transport failure is counted without changing fetch rejection and observers are removed', async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const rows = [], before = subscribers()
  await traceEmbeddedLaunch({ appBinaryPath: '/not-the-owned-binary', embeddedPort: port }, async () => {
    await assert.rejects(fetch(`http://127.0.0.1:${port}/status`), error => error.cause?.code === 'ECONNREFUSED')
  }, row => rows.push(row))
  assert.equal(rows.at(-1).polls, 1)
  assert.equal(rows.at(-1).errors, 1)
  assert.equal(rows.find(row => row.phase === 'embedded.status-first-error').code, 'ECONNREFUSED')
  assert.deepEqual(subscribers(), before)
})

test('a failed diagnostic sink cannot replace the operation result or failure', async () => {
  const before = subscribers(), failure = new Error('original failure'), rows = []
  const report = row => { if (row.phase !== 'embedded.prepare-summary') throw new Error('sink failed'); rows.push(row) }
  const operation = async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await once(child, 'close')
    return 17
  }
  assert.equal(await traceEmbeddedLaunch({ appBinaryPath: process.execPath }, operation, report), 17)
  assert.ok(rows.at(-1).diagnosticErrors.some(error => error.includes('sink failed')))
  await assert.rejects(traceEmbeddedLaunch({}, () => { throw failure }, () => { throw new Error('sink failed') }), error => error === failure)
  assert.deepEqual(subscribers(), before)
})

test('failed prepare removes observers from the still-running owned app without closing its streams', async t => {
  let child, originalDataListeners
  const rows = [], before = subscribers(), failure = new Error('prepare failed after spawn')
  t.after(() => child?.kill())
  await assert.rejects(traceEmbeddedLaunch({ appBinaryPath: process.execPath }, async () => {
    child = spawn(process.execPath, ['-e', `process.stdin.on('data', value => process.stderr.write(value))`])
    const originalReader = () => {}
    child.stderr.on('data', originalReader)
    originalDataListeners = [originalReader]
    await once(child, 'spawn')
    assert.equal(child.stderr.listenerCount('data'), 2)
    throw failure
  }, row => rows.push(row)), error => error === failure)
  assert.deepEqual(subscribers(), before)
  assert.deepEqual(child.stderr.listeners('data'), originalDataListeners)
  const count = rows.length
  const output = once(child.stderr, 'data')
  child.stdin.write('qa-scribe startup backend setup complete: private data\n')
  assert.match(String((await output)[0]), /private data/)
  assert.equal(rows.length, count)
  const closed = once(child, 'close')
  child.kill()
  await closed
})

test('an invalid binary option remains the original operation\'s validation responsibility', async () => {
  const failure = new TypeError('original binary validation'), before = subscribers()
  await assert.rejects(traceEmbeddedLaunch({ appBinaryPath: 17 }, () => { throw failure }, () => {}), error => error === failure)
  assert.deepEqual(subscribers(), before)
})
