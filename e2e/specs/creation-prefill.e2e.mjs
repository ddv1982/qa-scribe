import assert from 'node:assert/strict'
import { capture, click, create, fill, receipt, rows, tab } from './composer-proof.mjs'

describe('Native Prefill in the existing local creation intent', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await browser.waitUntil(() => browser.execute(() => document.querySelector('.document-status span')?.textContent === 'Autosaved'))
  })
  for (const kind of ['finding', 'testware']) {
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
