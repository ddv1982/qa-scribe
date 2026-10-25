import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layoutViewport, wideLayoutViewport } from '../e2e/specs/chat-layout-geometry.mjs'
const artifacts = mkdtempSync(join(tmpdir(), 'qa-scribe-viewport-contract-'))
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const globalNames = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'screen', 'requestAnimationFrame', 'browser']
const globalDescriptors = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const previous = process.env.QA_SCRIBE_E2E_ARTIFACTS
process.env.QA_SCRIBE_E2E_ARTIFACTS = artifacts
after(() => {
  if (previous === undefined) delete process.env.QA_SCRIBE_E2E_ARTIFACTS
  else process.env.QA_SCRIBE_E2E_ARTIFACTS = previous
  Object.defineProperty(process, 'platform', platformDescriptor)
  for (const [name, descriptor] of globalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  rmSync(artifacts, { recursive: true, force: true })
})
function host(height, width = 1280, delayed = false, platform = 'darwin') {
  Object.defineProperty(process, 'platform', { value: platform })
  Object.assign(globalThis, { innerWidth: width, innerHeight: height, outerWidth: width, outerHeight: height + 32,
    devicePixelRatio: 1, screen: { width, height: height + 32, availWidth: width, availHeight: height + 32, availTop: 0, availLeft: 0 },
    requestAnimationFrame: callback => queueMicrotask(callback) })
  const requests = []
  let pending
  globalThis.browser = {
    setWindowSize: async (w, h) => { requests.push({ width: w, height: h }); pending = { innerWidth: Math.min(w, width), innerHeight: Math.min(h - 32, height) }; if (!delayed) Object.assign(globalThis, pending) },
    getWindowRect: async () => ({ width: innerWidth, height: innerHeight + 32, x: 0, y: 0 }),
    pause: async () => { if (pending) Object.assign(globalThis, pending) },
    waitUntil: async callback => { for (let i = 0; i < 8; i++) if (await callback()) return; throw new Error('not settled') },
    execute: async (callback, ...args) => callback(...args),
    executeAsync: async callback => new Promise(resolve => callback(resolve)),
  }
  return requests
}
test('an available 828px native content height remains an exact 1280x828 case', async () => {
  const requests = host(828)
  assert.deepEqual(await wideLayoutViewport(), { width: 1280, height: 828 })
  assert.deepEqual(requests[0], { width: 1280, height: 860 })
})
test('a settled 645px hosted ceiling keeps strict width and minimum content height', async () => {
  host(645)
  assert.deepEqual(await wideLayoutViewport(), { width: 1280, height: 645 })
  for (const [width, height] of [[1280, 645], [640, 488], [360, 645], [320, 645]]) assert.deepEqual(await layoutViewport(width, height), { width, height })
})
test('a host below the required 645px minimum fails rather than accepting clipped geometry', async () => {
  host(640)
  await assert.rejects(wideLayoutViewport(), /between 645 and 828/)
})
test('a host unable to provide the exact 1280px width fails', async () => {
  host(645, 1200)
  await assert.rejects(wideLayoutViewport(), /exact requested width/)
})
test('a viewport still changing after settlement fails', async () => {
  host(645)
  const execute = browser.execute
  browser.execute = async (callback, ...args) => {
    if (callback.toString().includes('outerWindow')) globalThis.innerHeight -= 1
    return execute(callback, ...args)
  }
  await assert.rejects(wideLayoutViewport(), /must settle/)
})

test('resize acknowledgement settles before offset correction rather than using the preceding viewport', async () => {
  const requests = host(828, 1280, true)
  globalThis.innerHeight = 645
  assert.deepEqual(await wideLayoutViewport(), { width: 1280, height: 828 })
  assert.deepEqual(requests, [{ width: 1280, height: 860 }])
})
test('an undersized wide viewport without matching physical work-area evidence fails', async () => {
  host(645)
  globalThis.screen.availHeight = 1000
  await assert.rejects(wideLayoutViewport(), /requires a measured macOS work-area ceiling/)
})

test('Linux keeps exact wide height even when a shorter work area is reported', async () => {
  host(645, 1280, false, 'linux')
  await assert.rejects(wideLayoutViewport(), /requires a measured macOS work-area ceiling/)
})

test('a hot resize targets 640x488 content directly without visiting unsupported 640x456', async () => {
  const requests = host(828, 1280, true)
  Object.assign(globalThis, { innerWidth: 320, innerHeight: 645 })
  assert.deepEqual(await layoutViewport(640, 488), { width: 640, height: 488 })
  assert.deepEqual(requests, [{ width: 640, height: 520 }])
})

test('macOS height evidence remains valid when the native window exceeds the screen width', async () => {
  host(645)
  Object.assign(screen, { width: 1024, height: 768, availWidth: 1024, availHeight: 677, availTop: 31 })
  assert.deepEqual(await wideLayoutViewport(), { width: 1280, height: 645 })
})

test('a narrow screen cannot substitute for missing vertical work-area evidence', async () => {
  host(645)
  Object.assign(screen, { width: 1024, availWidth: 1024, availHeight: 1000 })
  await assert.rejects(wideLayoutViewport(), /requires a measured macOS work-area ceiling/)
})
