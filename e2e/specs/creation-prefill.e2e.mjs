import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { capture, click, create, fill, receipt, rows, tab, native } from './composer-proof.mjs'
import { nativeKeySender } from './preflight-native-keys.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))

describe('Native Prefill in the existing local creation intent', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await browser.waitUntil(() => browser.execute(() => document.querySelector('.document-status span')?.textContent === 'Autosaved'))
  })
  for (const kind of ['finding', 'testware']) {
    it(`retains new ${kind} edits after native Escape cancels a delayed Prefill result`, async () => {
      await tab(kind === 'finding' ? 'Findings' : 'Test cases')
      const before = rows()
      await create(kind)
      const title = `[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`
      const body = '[aria-label="Creation draft body"][contenteditable="true"]'
      await fill(title, 'Title before delayed confirmation')
      await fill(body, 'Body before delayed confirmation')
      const editorId = await $(body).getAttribute('id')
      await click('button=Prefill from note')
      await $('dialog[open]').waitForDisplayed()
      await browser.execute(() => {
        const callbacks = window.__TAURI_INTERNALS__.callbacks
        const originalSet = callbacks.set
        window.__prefillProbe = { nativeResult: null, released: false, delivered: false }
        function holdSourceResult(id, callback) {
          return originalSet.call(this, id, result => {
            if (!window.__prefillProbe.nativeResult && result?.entry && typeof result.revision === 'number') {
              callbacks.set = originalSet
              window.__prefillProbe.nativeResult = result
              window.__prefillProbe.release = () => { callback(result); window.__prefillProbe.delivered = true }
            } else callback(result)
          })
        }
        callbacks.set = holdSourceResult
        if (callbacks.set !== holdSourceResult) throw new Error('Native callback delay could not be installed')
      })
      await click('dialog button=Prefill and replace draft')
      await browser.waitUntil(() => browser.execute(() => Boolean(window.__prefillProbe.nativeResult)))
      const source = await browser.execute(() => window.__prefillProbe.nativeResult)
      assert.equal(await (await $('dialog[open]')).$('button=Keep editing').isEnabled(), false)
      await capture(`pending-prefill-${kind}`)
      const keyboard = { kind }
      if (process.platform === 'linux') {
        await nativeKeySender(keyboard, () => receipt(`native-escape-${kind}`, keyboard), Key)(Key.Escape)
      } else await browser.keys(Key.Escape)
      await $('dialog[open]').waitForExist({ reverse: true })
      await fill(title, 'New title after native Escape')
      await fill(body, 'New body after native Escape')
      await capture(`escaped-prefill-${kind}-new-edits`)
      await browser.execute(() => { window.__prefillProbe.released = true; window.__prefillProbe.release() })
      await browser.waitUntil(() => browser.execute(() => window.__prefillProbe.delivered))
      await capture(`released-prefill-${kind}-new-edits`)
      const actual = { title: await $(title).getValue(), body: await $(body).getText() }
      const canonical = await native('read_note_source', { sessionId: source.entry.sessionId, noteId: source.entry.id })
      receipt(`cancelled-prefill-${kind}`, { before, after: rows(), source, canonical, actual, editorId,
        currentEditorId: await $(body).getAttribute('id'), keyboard })
      const currentEditorId = await $(body).getAttribute('id')
      await $(title).scrollIntoView()
      await capture(`released-prefill-${kind}-title`)
      await click('button=Cancel')
      await click('button=Discard draft')
      assert.deepEqual(canonical, source, 'Canonical Note remains unchanged during transport delay')
      assert.deepEqual(rows(), before, 'Cancelled Prefill creates no record, ledger, context or run')
      assert.deepEqual(actual, { title: 'New title after native Escape', body: 'New body after native Escape' })
      assert.equal(currentEditorId, editorId)
    })
    it(`applies reviewed plain text to the same ${kind} editor without a durable insert or screenshot import`, async () => {
      await tab(kind === 'finding' ? 'Findings' : 'Test cases')
      const before = rows()
      await create(kind)
      await fill(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`, 'Keep this authored title')
      await fill('[aria-label="Creation draft body"][contenteditable="true"]', 'Replace this authored text only after confirmation.')
      const editorId = await $('[aria-label="Creation draft body"]').getAttribute('id')
      await click('button=Prefill from note')
      await $('dialog[open]').waitForDisplayed()
      const dialog = await $('dialog[open]')
      assert.ok((await dialog.getText()).includes('without formatting or screenshots'))
      await click('dialog button=Prefill and replace draft')
      await $('dialog[open]').waitForExist({ reverse: true })
      const body = await $('[aria-label="Creation draft body"]')
      assert.equal(await body.getAttribute('id'), editorId)
      assert.equal(await $(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`).getValue(), 'Keep this authored title')
      assert.ok((await body.getText()).includes('Changed canonical source needs new confirmation.'))
      assert.ok(!(await body.getText()).includes('Replace this authored text only after confirmation.'))
      assert.equal(await body.$$('img').then(images => images.length), 0)
      assert.deepEqual(rows(), before)
      await capture(`uc1-prefill-${kind}-same-intent`)
      await click('button=Cancel')
      await click('button=Discard draft')
      assert.deepEqual(rows(), before)
      receipt(`accepted-prefill-${kind}`, { before, after: rows(), sameEditorId: editorId, screenshotsCopied: 0 })
    })
  }
})
