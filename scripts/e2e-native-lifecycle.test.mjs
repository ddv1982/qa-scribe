import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import NativeLifecycle, { measureLifecycle } from '../e2e/native-lifecycle.mjs'
import TauriService from '../frontend/node_modules/@wdio/tauri-service/dist/esm/index.js'

test('lifecycle timing retains the original result and records the real operation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pr82-lifecycle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const original = { actual: true }
  let called = 0
  assert.equal(await measureLifecycle(directory, 'controlled.success', async () => { called += 1; return original }), original)
  assert.equal(called, 1)
  const row = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8'))
  assert.equal(row.phase, 'controlled.success')
  assert.ok(row.elapsedMs >= 0)
  assert.equal(row.error, undefined)
})

test('lifecycle timing rethrows the identical original error and records it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pr82-lifecycle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const failure = new Error('controlled original operation failure')
  await assert.rejects(measureLifecycle(directory, 'controlled.failure', async () => { throw failure }), error => error === failure)
  const row = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8'))
  assert.equal(row.phase, 'controlled.failure')
  assert.match(row.error, /original operation failure/)
})

test('unavailable timing artifact cannot change an operation result or mask its error', async t => {
  const warning = t.mock.method(console, 'warn', () => {})
  const directory = mkdtempSync(join(tmpdir(), 'pr82-lifecycle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const missing = join(directory, 'missing')
  assert.equal(await measureLifecycle(missing, 'controlled.artifact-success', () => 7), 7)
  const failure = new Error('original failure survives artifact write failure')
  await assert.rejects(measureLifecycle(missing, 'controlled.artifact-failure', () => { throw failure }), error => error === failure)
  assert.equal(warning.mock.callCount(), 2)
})

test('command timing always delegates to the original service and preserves its failure', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pr82-lifecycle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const failure = new Error('original command hook failure')
  const original = t.mock.method(TauriService.prototype, 'beforeCommand', async () => { throw failure })
  const service = new NativeLifecycle({ driverProvider: 'embedded', logDir: directory }, {}, {})
  await assert.rejects(service.beforeCommand('getTitle', ['owned argument']), error => error === failure)
  assert.equal(original.mock.callCount(), 1)
  assert.deepEqual(original.mock.calls[0].arguments, ['getTitle', ['owned argument']])
  assert.equal(service.commandTimings.get('getTitle').calls, 1)
  assert.ok(service.commandTimings.get('getTitle').elapsedMs >= 0)
})
