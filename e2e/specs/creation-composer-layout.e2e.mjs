import assert from 'node:assert/strict'
import { readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { capture, click, create, fill, fixture, native, receipt, resize, rows, save, tab } from './composer-proof.mjs'
import { openCreationAi, returnToWrite } from './creation-helpers.mjs'
import { assertReadable, inspect } from './preflight-layout-geometry.mjs'

describe('Generate mode of a new draft at the approved native widths', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await click('button=New Session')
    await fill('[aria-label="Session title"]', 'Composer responsive AI setup')
    await fill('[aria-label="Note body"]', 'Canonical source to review before explicitly generating. Preserve cancellation and saved-result semantics.')
    await browser.waitUntil(async () => {
      const sessions = await native('list_sessions')
      const session = sessions.find(session => session.title === 'Composer responsive AI setup')
      return session && (await native('list_entries', { sessionId: session.id })).some(entry => entry.body.includes('Canonical source to review'))
    })
  })
  for (const kind of ['finding', 'testware']) {
    it(`keeps ${kind} generation choices and actions readable and reachable in both themes`, async () => {
      const before = rows()
      for (const theme of ['light', 'dark']) {
        await resize(1280)
        await click('button=Settings')
        await click(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
        await click('button=Back')
        await tab(kind === 'finding' ? 'Findings' : 'Test cases')
        await create(kind)
        await fill(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`, 'Authored draft retained when setup closes')
        for (const width of [1280, 1024, 768, 360, 320]) {
          await resize(width)
          await openCreationAi(kind)
          const geometry = await inspect('.creation-composer')
          receipt(`ai-${kind}-${theme}-${width}`, { geometry, rows: rows() })
          assertReadable(geometry)
          // The Write fields stay mounted for the round trip but render nothing, so Tab and screen readers skip them.
          assert.deepEqual(await browser.execute(() => Array.from(document.querySelectorAll('.creation-write input, .creation-write select, .creation-write [contenteditable]'),
            node => node.getClientRects().length).filter(Boolean)), [])
          for (const control of await $$('.creation-composer .record-actions button')) {
            await control.scrollIntoView()
            assert.ok(await control.isDisplayed())
          }
          await capture(`uc2-ai-${kind}-${theme}-${width}`)
          await returnToWrite()
          assert.equal(await $(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`).getValue(), 'Authored draft retained when setup closes')
        }
        await resize(1280)
        await click('button=Cancel')
        await click('button=Discard draft')
      }
      assert.deepEqual(rows(), before)
    })
  }
  it('offers no Generate without an available provider while ordinary Save remains available', async () => {
    const link = join(fixture, 'bin/codex')
    const target = readlinkSync(link)
    unlinkSync(link)
    try {
      await browser.refresh()
      await $('h1=Test cases').waitForExist()
      // The Note's Summarize explains an unavailable provider once the live status replaces any cached one.
      await tab('Note')
      await $('#note-summary-unavailable').waitForExist()
      await tab('Findings')
      await create('finding')
      await fill('[aria-label="Finding title"]', 'No provider required for ordinary Save')
      assert.equal(await $('[role="group"][aria-label="How to create"]').isExisting(), false)
      assert.equal(await (await $('.creation-composer')).$('button*=Generate').isExisting(), false)
      await capture('uc2-ai-unavailable-write-only')
      await save('finding')
      assert.equal(rows().ai_runs, 0)
      assert.equal(rows().generation_contexts, 0)
    } finally { symlinkSync(target, link) }
  })
})
