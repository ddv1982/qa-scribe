import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function pendingComposerSave(theme, sessionId, artifacts, save) {
  const composer = `Controlled ${theme} unsent message`
  const failures = []
  await (await $('.chat-compose-actions .action-button--primary')).scrollIntoView()
  await browser.saveScreenshot(join(artifacts, `save-${theme}-before-edit.png`))
  await browser.execute((sessionId, composer) => {
    const sample = () => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }
      }
      const button = (label) => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)
      const review = document.querySelector('.chat-review')
      return {
        viewport: { width: innerWidth, height: innerHeight },
        review: review ? { text: review.querySelector('.chat-help').textContent,
          messages: [...review.querySelectorAll('.chat-message-text')].map(node => node.textContent),
          expanded: review.querySelector('button').getAttribute('aria-expanded') } : null,
        reason: document.querySelector('.chat-handoff [id$="-reason"]')?.textContent ?? '',
        counts: document.querySelector('.chat-counts').textContent,
        model: document.querySelector('.next-model-selection').textContent,
        composer: rect('.chat-composer textarea'), send: rect('.chat-compose-actions .action-button--primary'),
        disabled: { add: button('Add conversation to note').disabled,
          send: document.querySelector('.chat-compose-actions .action-button--primary').disabled,
          restart: button('Start new conversation').disabled },
      }
    }
    const callbacks = window.__TAURI_INTERNALS__.callbacks
    const originalGet = callbacks.get
    const originalTimeout = window.setTimeout
    let release
    const pending = new Promise(resolve => { release = resolve })
    const gate = { held: false, released: false, before: null, acknowledgment: null, sample, release,
      restore: () => { callbacks.get = originalGet; window.setTimeout = originalTimeout } }
    window.__ac4SaveGate = gate
    window.setTimeout = function (callback, delay, ...args) {
      if (delay !== 500 || typeof callback !== 'function') return originalTimeout.call(this, callback, delay, ...args)
      return originalTimeout.call(this, () => {
        if (document.querySelector('.chat-composer textarea')?.value === composer && !gate.before) gate.before = sample()
        callback(...args)
      }, delay)
    }
    callbacks.get = function (id) {
      const callback = originalGet.call(this, id)
      if (!callback) return callback
      return (saved) => {
        if (saved?.sessionId === sessionId && saved.composer === composer && saved.mode === 'chat'
          && Array.isArray(saved.messages) && !gate.held) {
          gate.held = true
          gate.acknowledgment = { sessionId: saved.sessionId, draftId: saved.draftId, revision: saved.revision, composer: saved.composer, mode: saved.mode }
          pending.then(() => { gate.released = true; callback(saved) })
        } else callback(saved)
      }
    }
  }, sessionId, composer)
  try {
    await (await $('.chat-composer textarea')).setValue(composer)
    await browser.waitUntil(() => browser.execute(() => window.__ac4SaveGate.held))
    const before = await browser.execute(() => window.__ac4SaveGate.before)
    assert.ok(before, 'Capture the edited composer before the real autosave callback runs')
    save(`save-${theme}-before`, before)
    const during = await browser.execute(() => window.__ac4SaveGate.sample())
    save(`save-${theme}-pending`, during)
    await browser.saveScreenshot(join(artifacts, `save-${theme}-pending.png`))
    await browser.execute(() => window.__ac4SaveGate.release())
    await (await $('.chat-compose-actions .action-button--primary')).waitForEnabled()
    const after = await browser.execute(() => window.__ac4SaveGate.sample())
    save(`save-${theme}-completed`, after)
    await browser.saveScreenshot(join(artifacts, `save-${theme}-completed.png`))
    for (const [stage, value] of [['pending', during], ['completed', after]]) {
      if (JSON.stringify(value.review) !== JSON.stringify(before.review)) failures.push(`${theme} ${stage}: saved review or expansion changed`)
      if (value.reason !== before.reason) failures.push(`${theme} ${stage}: unsent-message explanation changed`)
      assert.equal(value.counts, before.counts)
      assert.equal(value.model, before.model)
      assert.equal(value.disabled.add, true)
    }
    assert.deepEqual(during.disabled, { add: true, send: true, restart: true })
    assert.deepEqual(after.disabled, { add: true, send: false, restart: false })
    for (const control of ['composer', 'send']) {
      if (JSON.stringify(before[control]) !== JSON.stringify(during[control])
        || JSON.stringify(during[control]) !== JSON.stringify(after[control])) failures.push(`${theme}: ${control} moved across acknowledgment`)
    }
    if (after.send.bottom > after.viewport.height || after.send.y < 0) failures.push(`${theme}: Send is clipped after acknowledgment`)
    save(`save-${theme}-result`, { failures, gate: await browser.execute(() => ({
      released: window.__ac4SaveGate.released, acknowledgment: window.__ac4SaveGate.acknowledgment,
    })) })
    return failures
  } finally {
    await browser.execute(() => {
      window.__ac4SaveGate.release()
      window.__ac4SaveGate.restore()
      delete window.__ac4SaveGate
    })
  }
}
