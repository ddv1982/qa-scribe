import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { click, waitForSavedConversation } from './unified-visual-proof.mjs'
const native = (command, args = {}) => browser.tauri.execute(({ core }, { command, args }) => core.invoke(command, args), { command, args })
const saved = () => browser.waitUntil(async () => await $('.chat-status').getText() === 'Conversation saved')
const composer = 'Controlled restart readiness unsent message'
const receipts = []
const retain = (stage, value) => {
  receipts.push({ stage, ...value })
  writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'restart-readiness.json'), JSON.stringify(receipts, null, 2))
}
let dispatch
before(async () => {
  await browser.overwriteCommand('click', async function (original, ...args) {
    if (dispatch && this.selector === 'button=Start new conversation') {
      const inject = dispatch
      dispatch = undefined
      return inject(() => original(...args))
    }
    return original(...args)
  }, true)
})

async function prepare() {
  const before = await native('list_sessions')
  await click('button=New Session')
  await $('[aria-label="Note body"]').waitForDisplayed()
  const session = (await native('list_sessions')).find(item => !before.some(old => old.id === item.id))
  assert.ok(session)
  await $('[aria-label="Note body"]').setValue('Canonical Note preserved by the restart readiness fixture.')
  let note
  await browser.waitUntil(async () => {
    note = (await native('open_session_note_state', { id: session.id })).noteEntry
    return note?.body.includes('Canonical Note preserved by the restart readiness fixture.')
  })
  await click('button=Ask AI')
  await $('.chat-composer textarea').setValue(composer)
  await saved()
  const chat = await native('get_chat', { sessionId: session.id })
  assert.equal(chat.composer, composer)
  if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('.ask-ai-panel:not([hidden]) button[aria-label="Close Ask AI"]')
  await browser.waitUntil(async () => (await native('get_chat', { sessionId: session.id })).mode === 'write_note')
  await browser.execute((sessionId, composer) => {
    const callbacks = window.__TAURI_INTERNALS__.callbacks, originalGet = callbacks.get, originalTimeout = window.setTimeout
    let release, callback
    const pending = new Promise(resolve => { release = resolve })
    const gate = { queued: false, held: false, ran: false, clicks: 0,
      fire: () => { if (callback && !gate.ran) { gate.ran = true; callback() } }, release,
      restore: () => { gate.fire(); release(); callbacks.get = originalGet; window.setTimeout = originalTimeout; document.removeEventListener('click', onClick, true) } }
    const onClick = event => {
      const button = event.target.closest('button')
      if (button?.textContent.trim() === 'Start new conversation' && !button.closest('dialog')) gate.clicks++
    }
    document.addEventListener('click', onClick, true)
    window.__restartReadinessGate = gate
    window.setTimeout = function (fn, delay, ...args) {
      if (delay !== 500 || typeof fn !== 'function') return originalTimeout.call(this, fn, delay, ...args)
      return originalTimeout.call(this, () => { callback = () => fn(...args); gate.queued = true }, delay)
    }
    callbacks.get = function (id) {
      const invokeCallback = originalGet.call(this, id)
      if (!invokeCallback) return invokeCallback
      return value => {
        if (!gate.held && value?.sessionId === sessionId && value.mode === 'chat' && value.composer === composer && Array.isArray(value.messages)) {
          gate.held = true
          gate.ack = { sessionId: value.sessionId, draftId: value.draftId, revision: value.revision, mode: value.mode }
          pending.then(() => invokeCallback(value))
        } else invokeCallback(value)
      }
    }
  }, session.id, composer)
  return { session, note, chat }
}
const gateState = () => browser.execute(() => ({ held: window.__restartReadinessGate.held,
  queued: window.__restartReadinessGate.queued, clicks: window.__restartReadinessGate.clicks,
  ack: window.__restartReadinessGate.ack, disabled: [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Start new conversation' && !node.closest('dialog'))?.disabled,
  status: document.querySelector('.chat-status')?.textContent.trim(), dialog: !!document.querySelector('dialog[open]') }))
async function fireSave() {
  await browser.waitUntil(() => browser.execute(() => window.__restartReadinessGate.queued))
  await browser.execute(() => window.__restartReadinessGate.fire())
  await browser.waitUntil(() => browser.execute(() => window.__restartReadinessGate.held))
}
async function releaseSave() { await browser.execute(() => window.__restartReadinessGate.release()); await saved() }
async function cleanup() {
  dispatch = undefined
  await browser.execute(() => { window.__restartReadinessGate?.restore(); delete window.__restartReadinessGate })
}
function rows() {
  const database = new DatabaseSync(join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite'), { readOnly: true })
  try { return database.prepare('SELECT * FROM chat_drafts ORDER BY id').all() } finally { database.close() }
}

it('reproduces the missing dialog when a real mode save starts between clickable check and driver dispatch', async () => {
  const { session, note, chat } = await prepare()
  try {
    await click('button=Ask AI')
    await (await $('.chat-options summary')).click()
    await click('button=Start new conversation')
    await $('dialog[open]').waitForDisplayed()
    await click('dialog button=Cancel')
    assert.equal((await native('get_chat', { sessionId: session.id })).draftId, chat.draftId)
    dispatch = async original => {
      await fireSave()
      const beforeDispatch = await gateState()
      assert.equal(beforeDispatch.disabled, true)
      assert.equal(beforeDispatch.status, 'Saving conversation…')
      const persistedBeforeDispatch = rows().find(row => row.id === beforeDispatch.ack.draftId)
      assert.equal(persistedBeforeDispatch.revision, beforeDispatch.ack.revision)
      assert.equal(persistedBeforeDispatch.mode, 'chat')
      await original() // Real WDIO elementClick -> installed embedded driver's HTMLElement.click().
      await releaseSave()
      const afterDispatch = await gateState()
      assert.equal(afterDispatch.clicks, 1)
      assert.equal(afterDispatch.disabled, false)
      assert.equal(afterDispatch.dialog, false)
      retain('disabled-at-dispatch', { beforeDispatch, persistedBeforeDispatch, afterDispatch })
      await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'restart-suppressed-then-saved.png'))
    }
    await click('button=Start new conversation')
    await assert.rejects(click('dialog button=Start new conversation'), error => {
      retain('original-missing-dialog', { name: error.name, message: error.message })
      return error.message === 'Can\'t call $ on element with selector "dialog" because element wasn\'t found'
    })
    const retained = await native('get_chat', { sessionId: session.id })
    assert.equal(retained.draftId, chat.draftId)
    assert.equal(retained.composer, composer)
    assert.deepEqual((await native('open_session_note_state', { id: session.id })).noteEntry, note)
    retain('negative-persistence', { sessionId: session.id, rows: rows() })
  } finally { await cleanup() }
})

it('waits for the real saved-state acknowledgement before the first restart, then cancels/reopens and persists exactly once', async () => {
  const { session, note, chat } = await prepare()
  const before = rows()
  try {
    await click('button=Ask AI')
    let ready = false
    const pending = waitForSavedConversation().then(() => { ready = true })
    await fireSave()
    assert.equal(ready, false, 'Fixture readiness must wait for the real held save acknowledgement')
    assert.equal((await gateState()).disabled, true)
    await releaseSave()
    await pending
    retain('saved-before-first-restart', await gateState())
    await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'restart-ready-before-first.png'))
    await click('button=Start new conversation')
    await $('dialog[open]').waitForDisplayed()
    await click('dialog button=Cancel')
    assert.equal((await native('get_chat', { sessionId: session.id })).draftId, chat.draftId)
    await click('button=Start new conversation')
    await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'restart-ready-reopened.png'))
    await click('dialog button=Start new conversation')
    let restarted
    await browser.waitUntil(async () => { restarted = await native('get_chat', { sessionId: session.id }); return restarted.draftId !== chat.draftId })
    assert.equal(restarted.composer, '')
    assert.deepEqual((await native('open_session_note_state', { id: session.id })).noteEntry, note)
    const after = rows(), own = after.filter(row => row.session_id === session.id)
    assert.equal(own.length, 2)
    assert.equal(own.filter(row => !row.archived).length, 1)
    assert.deepEqual(after.filter(row => row.session_id !== session.id), before.filter(row => row.session_id !== session.id))
    retain('positive-persistence', { sessionId: session.id, oldDraftId: chat.draftId, newDraftId: restarted.draftId, rows: after, gate: await gateState() })
  } finally { await cleanup() }
})
