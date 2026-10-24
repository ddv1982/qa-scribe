import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import { captureRestartRoute } from '../e2e/specs/chat-restart-capture.mjs'
import { installRestartDomCapture, drainRestartDomCapture } from '../e2e/specs/chat-restart-dom-capture.mjs'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
function page(t) {
  const dom = new JSDOM('<body><button>Chat</button><button id="restart">Start new conversation</button><div class="chat-meta"><span role="status">Unsaved changes</span></div></body>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const execute = (fn, ...args) => dom.window.eval(`(${fn.toString()})`)(...args)
  const browser = new EventEmitter()
  browser.execute = async (fn, ...args) => JSON.parse(JSON.stringify(execute(fn, ...args)))
  return { window: dom.window, document: dom.window.document, execute, browser }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const chat = { sessionId: 's', draftId: 'd', revision: 4, mode: 'chat', composer: 'SECRET unsent message' }

test('actual DOM Cancel/reopen preserves dialog node identity, status changes and cached backend identity without payloads', async t => {
  const { browser, document } = page(t)
  let trace
  const result = await captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    document.querySelector('button').click()
    diagnostic.identity('before', chat)
    const restart = document.querySelector('#restart')
    restart.onclick = () => {
      const dialog = document.createElement('dialog')
      dialog.innerHTML = '<button>Cancel</button><button>Start new conversation</button>'
      document.body.append(dialog)
      dialog.setAttribute('open', '')
      dialog.querySelector('button').onclick = () => dialog.remove()
    }
    restart.click()
    await flush()
    document.querySelector('dialog button').click()
    await flush()
    diagnostic.identity('after Cancel', chat)
    restart.click()
    document.querySelector('[role=status]').textContent = 'Conversation saved'
    await flush()
    return 'original return'
  }, value => { trace = value })
  assert.equal(result, 'original return')
  assert.equal(trace.outcome.status, 'passed')
  assert.deepEqual(trace.dom.events.filter(row => row.kind === 'click').map(row => row.label), ['Chat', 'Start new conversation', 'Cancel', 'Start new conversation'])
  const dialogs = trace.dom.events.filter(row => row.kind === 'dialog')
  assert.deepEqual(dialogs.map(row => row.change), ['added', 'removed', 'added'])
  assert.equal(dialogs[0].node.nodeId, dialogs[1].node.nodeId)
  assert.notEqual(dialogs[0].node.nodeId, dialogs[2].node.nodeId)
  assert.ok(trace.dom.events.some(row => row.kind === 'attribute' && row.attribute === 'open'))
  assert.ok(trace.dom.events.some(row => row.kind === 'status' && row.status.value === 'Conversation saved'))
  assert.equal(trace.events.filter(row => row.kind === 'cached-chat').length, 2)
  assert.ok(!JSON.stringify(trace).includes('SECRET'))
  assert.deepEqual(trace.errors, [])
  assert.deepEqual(trace.dom.errors, [])
  assert.equal(trace.dom.disposed, true)
})

test('real disabled DOM click produces no event, but dispatch annotation and disabled/autosave transitions survive', async t => {
  const { browser, document } = page(t)
  let trace
  await captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    document.querySelector('button').click()
    const restart = document.querySelector('#restart')
    restart.disabled = true
    document.querySelector('[role=status]').textContent = 'Saving conversation…'
    await flush()
    diagnostic.click('dispatch', 'button=Start new conversation', 'known-wdio-id')
    restart.click()
    restart.disabled = false
    document.querySelector('[role=status]').textContent = 'Conversation saved'
    await flush()
  }, value => { trace = value })
  assert.equal(trace.dom.events.filter(row => row.kind === 'click' && row.label === 'Start new conversation').length, 0)
  assert.ok(trace.events.some(row => row.elementId === 'known-wdio-id' && row.phase === 'dispatch'))
  assert.deepEqual(trace.dom.events.filter(row => row.attribute === 'disabled').map(row => row.node.disabled), [true, false])
  assert.ok(trace.dom.events.some(row => row.status?.value === 'Saving conversation…'))
})

test('passive transport retains underlying waiter failure without logging request/response bodies or replacing original failure', async t => {
  const { browser } = page(t)
  const original = new Error('Can\'t call $ on element with selector "dialog" because element wasn\'t found')
  let trace
  await assert.rejects(captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    browser.emit('command', { command: 'executeScript', method: 'POST', endpoint: '/session/s/execute/sync', body: { script: 'SECRET script', args: ['SECRET message'] } })
    browser.emit('result', { command: 'executeScript', method: 'POST', endpoint: '/session/s/execute/sync', body: { script: 'SECRET script' }, result: { error: new Error('Script execution timed out when running \"execute/sync\" with method \"POST\" and args {\"script\":\"SECRET script\"}') } })
    throw original
  }, value => { trace = value }), error => error === original)
  assert.equal(trace.events.at(-1).error.message, 'Script execution timed out')
  assert.equal(trace.outcome.error.message, original.message)
  assert.ok(!JSON.stringify(trace).includes('SECRET'))
  assert.equal(browser.listenerCount('command'), 0)
  assert.equal(browser.listenerCount('result'), 0)
  assert.equal(trace.dom.disposed, true)
})

test('combined storage is capped at 64, retains first/last rows, counts overflow and stops after disposal', async t => {
  const { browser, document, window } = page(t)
  let trace, retained
  await captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    document.querySelector('button').click()
    for (let i = 0; i < 100; i++) {
      browser.emit('command', { command: `command${i}`, endpoint: `/session/s/element/${i}/click` })
      document.querySelector('#restart').click()
    }
  }, value => { trace = value; retained = JSON.stringify(value) })
  assert.equal(trace.events.length + trace.dom.events.length, 64)
  assert.equal(trace.overflow, 69) // activation + 100 protocol commands
  assert.equal(trace.dom.overflow, 70) // Chat + 100 restart clicks + disposal
  assert.equal(trace.events[1].command, 'command0')
  assert.equal(trace.events.at(-1).command, 'command99')
  browser.emit('command', { command: 'after' })
  document.querySelector('#restart').click()
  await flush()
  assert.equal(JSON.stringify(trace), retained)
  assert.equal(Object.keys(window).filter(key => key.startsWith('__qaScribeRestart_')).length, 0)
})

test('drain rejection cannot mask failure and read-only listeners are detached', async t => {
  const { browser, execute } = page(t)
  const original = new Error('original assertion')
  browser.execute = async (fn, ...args) => {
    if (fn === drainRestartDomCapture) { execute(fn, ...args); throw new Error('transport disconnected') }
    return execute(fn, ...args)
  }
  let trace
  await assert.rejects(captureRestartRoute(browser, async () => { throw original }, value => { trace = value }), error => error === original)
  assert.match(trace.errors[0].message, /transport disconnected/)
  assert.equal(browser.listenerCount('command') + browser.listenerCount('result'), 0)
})

test('hung drain returns within the 250ms diagnostic budget and browser collector self-disposes if transport cannot deliver', async t => {
  const { browser, execute, document } = page(t)
  let trace, state
  browser.execute = async (fn, ...args) => {
    if (fn === drainRestartDomCapture) return new Promise(() => {})
    const result = execute(fn, args[0], 30)
    state = document.defaultView[args[0]]
    return result
  }
  const original = new Error('original missing dialog')
  const start = performance.now()
  await assert.rejects(captureRestartRoute(browser, async () => { throw original }, value => { trace = value }), error => error === original)
  assert.ok(performance.now() - start >= 250)
  assert.ok(performance.now() - start < 750)
  assert.ok(trace.errors.some(error => error.name === 'DiagnosticBudget'))
  assert.equal(state.dispose('check').disposed, true)
  assert.equal(state.dispose('check').events.at(-1).reason, 'lifetime')
  assert.equal(browser.listenerCount('command') + browser.listenerCount('result'), 0)
})

test('installation and retention errors leave a passing route result unchanged', async t => {
  const { browser } = page(t)
  browser.execute = async () => { throw new Error('read-only collection unavailable') }
  assert.equal(await captureRestartRoute(browser, async diagnostic => { diagnostic.activate(); return 42 }, () => { throw new Error('artifact write failed') }), 42)
})

test('direct DOM disposal removes event listeners and MutationObserver on failure, including inert transitions', async t => {
  const { execute, document } = page(t)
  execute(installRestartDomCapture, 'testKey')
  document.querySelector('button').click()
  document.body.inert = true
  document.body.setAttribute('inert', '')
  await flush()
  document.body.removeAttribute('inert')
  await flush()
  const trace = execute(drainRestartDomCapture, 'testKey')
  assert.deepEqual(Array.from(trace.events.filter(row => row.attribute === 'inert'), row => row.oldValue), [null, ''])
  const before = JSON.stringify(trace)
  document.querySelector('#restart').disabled = true
  document.querySelector('#restart').click()
  await flush()
  assert.equal(JSON.stringify(trace), before)
})

test('cached before/Cancel/latest-poll identities survive transport overflow without extra backend reads', async t => {
  const { browser } = page(t)
  let trace
  await captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    diagnostic.identity('before restart', chat)
    for (let i = 0; i < 100; i++) browser.emit('command', { command: `pre${i}` })
    diagnostic.identity('after Cancel', chat)
    for (let i = 0; i < 100; i++) {
      diagnostic.identity('restart poll', { ...chat, revision: i })
      browser.emit('command', { command: `post${i}` })
    }
  }, value => { trace = value })
  assert.equal(trace.events.length, 32)
  const cached = trace.events.filter(row => row.kind === 'cached-chat')
  assert.deepEqual(cached.map(row => row.phase), ['before restart', 'after Cancel', 'restart poll'])
  assert.equal(cached.at(-1).revision, 99)
  assert.equal(trace.identitySamples['restart poll'], 100)
})

test('partial DOM installation failure disposes already registered listeners and cannot mask the route failure', async t => {
  const { browser, document, window } = page(t)
  const registered = new Set()
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => { if (['click', 'mousedown', 'pointerdown'].includes(type)) registered.add(listener); add(type, listener, options) }
  document.removeEventListener = (type, listener, options) => { registered.delete(listener); remove(type, listener, options) }
  window.MutationObserver = class { observe() { throw new Error('observer unavailable') } disconnect() {} }
  const original = new Error('original assertion')
  let trace
  await assert.rejects(captureRestartRoute(browser, async () => { throw original }, value => { trace = value }), error => error === original)
  assert.equal(registered.size, 0)
  assert.ok(trace.errors.some(error => error.message === 'observer unavailable'))
  assert.equal(trace.dom.unavailable, true)
})

test('second dispatch identity and latest underlying error survive a long implicit-wait protocol stream', async t => {
  const { browser } = page(t)
  let trace
  await captureRestartRoute(browser, async diagnostic => {
    diagnostic.activate()
    for (let i = 0; i < 100; i++) browser.emit('command', { command: `before${i}` })
    diagnostic.click('dispatch', 'button=Start new conversation', 'second-trigger-id')
    for (let i = 0; i < 100; i++) browser.emit('command', { command: `poll${i}` })
    browser.emit('result', { command: 'executeAsyncScript', result: { error: new Error('Script execution timed out') } })
  }, value => { trace = value })
  assert.ok(trace.events.some(row => row.elementId === 'second-trigger-id'))
  assert.equal(trace.events.at(-1).error.message, 'Script execution timed out')
})

test('artifact retention failure cannot replace the identical route assertion error', async t => {
  const { browser } = page(t)
  const original = new Error('original missing dialog assertion')
  await assert.rejects(captureRestartRoute(browser, async () => { throw original }, () => { throw new Error('disk write failed') }), error => error === original)
  assert.equal(browser.listenerCount('command') + browser.listenerCount('result'), 0)
})
